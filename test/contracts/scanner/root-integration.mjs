import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { encodePathsBin } from '../outward-scanner.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const identity = ({ path, mode, length, sha256 }) => ({ path, mode, length, sha256 });
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
const fail = () => { throw new Error('invalid_inventory'); };
const scriptExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const passiveExtensions = /\.(?:md|txt|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|map|sql)$/i;
const isGenerated = (path) => /^(?:dist|dist-old|docs\/assets)\//.test(path) ||
  ['docs/index.html', 'docs/favicon.svg', 'docs/icons.svg'].includes(path);

function interpreter(bytes) {
  if (bytes[0] !== 35 || bytes[1] !== 33) return null;
  const newline = bytes.indexOf(10);
  const line = decoder.decode(bytes.subarray(2, newline < 0 ? bytes.length : newline)).trim();
  if (/^(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|dash)$/.test(line) || /^\/usr\/bin\/env (?:sh|bash|dash)$/.test(line)) return 'posix_shell';
  if (/^(?:\/usr\/bin\/|\/usr\/local\/bin\/)?node$/.test(line) || /^\/usr\/bin\/env node$/.test(line)) return 'javascript';
  return 'unknown';
}

function classify(record) {
  const name = posix.basename(record.path);
  const generated = isGenerated(record.path);
  const obligations = generated ? ['generated_provenance'] : [];
  const shebang = interpreter(record.bytes);
  let format = 'unknown', disposition = 'unresolved', execution = true;
  if (scriptExtensions.test(record.path)) { format = 'typescript_javascript'; disposition = 'awaiting_ast'; }
  else if (name === 'package.json') { format = 'package_json'; disposition = 'parser_required'; }
  else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(record.path)) { format = 'github_actions'; disposition = 'parser_required'; }
  else if (/^Dockerfile(?:\..+)?$/.test(name) || /\.Dockerfile$/.test(name)) { format = 'dockerfile'; disposition = 'parser_required'; }
  else if (/^(?:docker-)?compose(?:[.-].+)?\.ya?ml$/.test(name)) { format = 'compose'; disposition = 'parser_required'; }
  else if (name === 'devcontainer.json' && /(?:^|\/)\.devcontainer\//.test(record.path)) { format = 'devcontainer'; disposition = 'awaiting_config'; }
  else if (/^(?:tsconfig(?:\..+)?\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(name)) { format = 'configuration'; disposition = 'awaiting_config'; }
  else if (/\.(?:html?|svg)$/i.test(name)) { format = 'active_document'; disposition = 'awaiting_config'; }
  else if (/\.sh$/.test(name) || shebang === 'posix_shell') {
    format = 'posix_shell';
    if (shebang && shebang !== 'posix_shell') obligations.push('interpreter_conflict');
    else disposition = 'parser_required';
  } else if (shebang === 'javascript') { format = 'typescript_javascript'; disposition = 'awaiting_ast'; }
  else if (shebang || record.mode === 0o100755 || posix.extname(name) === '') obligations.push('unknown_executable');
  else if (generated || /\.(?:json|ya?ml|toml|ini|conf|config|css)$/i.test(name)) { format = 'configuration'; disposition = 'awaiting_config'; }
  else if (passiveExtensions.test(name)) { format = 'passive'; disposition = 'passive'; execution = false; }
  else obligations.push('unknown_format');
  if (shebang && ['package_json', 'github_actions', 'dockerfile', 'compose', 'devcontainer', 'configuration', 'active_document'].includes(format)) {
    disposition = 'unresolved'; obligations.push('interpreter_conflict');
  }
  return { ...identity(record), execution, format, disposition, generated, obligations, target: null };
}

// Total classification of observed inventory only. No parser, artifact hash,
// binding admission, filesystem lookup or execution occurs here. Every record
// has exactly one descriptor; even passive/unknown/generated records remain.
export function classifyExecutionRoots(observedRecords) {
  try {
    if (!Array.isArray(observedRecords)) fail();
    const records = observedRecords.map((record) => {
      if (!record || !(record.bytes instanceof Uint8Array) || typeof record.length !== 'bigint' ||
        typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail();
      const bytes = Buffer.from(record.bytes);
      if (BigInt(bytes.length) !== record.length || createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail();
      if (record.mode !== 0o120000 && record.targetPath !== undefined) fail();
      return { ...identity(record), bytes, targetPath: record.targetPath };
    });
    encodePathsBin(records.map((record) => ({ ...identity(record), sha256: Buffer.from(record.sha256, 'hex') })));
    records.sort(byteOrder);
    const byPath = new Map(records.map((record) => [record.path, record]));
    const descriptors = new Map(records.filter((record) => record.mode !== 0o120000).map((record) => [record.path, classify(record)]));
    for (const record of records) {
      if (record.mode !== 0o120000) continue;
      let current = record;
      const visited = new Set();
      while (current.mode === 0o120000) {
        if (visited.has(current.path)) fail();
        visited.add(current.path);
        const link = decoder.decode(current.bytes);
        if (!link || link.startsWith('/') || /[\x00\\]/.test(link)) fail();
        const targetPath = posix.normalize(posix.join(posix.dirname(current.path), link));
        if (targetPath === '..' || targetPath.startsWith('../') || !byPath.has(targetPath)) fail();
        current = byPath.get(targetPath);
      }
      if (record.targetPath !== current.path) fail();
      const target = descriptors.get(current.path);
      descriptors.set(record.path, { ...identity(record), execution: true, format: 'symlink', disposition: 'awaiting_link',
        generated: isGenerated(record.path),
        obligations: [...(isGenerated(record.path) ? ['generated_provenance'] : []), 'symlink_resolution', 'target_dispatch'],
        target: { ...identity(current), format: target.format } });
    }
    const roots = records.map((record) => descriptors.get(record.path));
    const executionCount = roots.filter((root) => root.execution).length;
    return { status: 'classified', roots, coverage: { observed: roots.length, execution: executionCount, passive: roots.length - executionCount } };
  } catch {
    return { status: 'rejected', roots: [], diagnostics: [{ code: 'invalid_inventory', line: null, column: null, field: null }] };
  }
}
