import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { canonicalizeJcs } from '../outward-scanner.mjs';
import { createRootParserRegistry } from './root-api.mjs';
import { decodeDockerfile } from './dockerfile.mjs';
import { validateShell } from './posix-shell-validation.mjs';

const stop = (code = 'unresolved_execution') => { throw code; };
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && !item.includes('\0'));
const hash = (value) => `sha256:${createHash('sha256').update(canonicalizeJcs(value)).digest('hex')}`;
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const digest = /^sha256:[0-9a-f]{64}$/;

// Docker word expansion, not shell parsing: only known simple ENV references.
function words(source, env, escape, split = true, literal = false) {
  const result = [];
  let word = '', active = false, quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!literal && char === escape && quote !== "'") {
      if (++index === source.length) stop('invalid_input');
      word += source[index]; active = true;
    } else if (!literal && (char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char; active = true;
    } else if (char === '$' && quote !== "'") {
      const match = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(source.slice(index));
      if (!match || !Object.hasOwn(env, match[1] ?? match[2])) stop();
      const value = env[match[1] ?? match[2]];
      // Unquoted substitution containing whitespace needs Docker field splitting.
      // Keep the bounded resolver honest rather than changing path cardinality.
      if (split && !quote && /\s/.test(value)) stop();
      word += value; index += match[0].length - 1; active = true;
    } else if (split && !quote && /[ \t]/.test(char)) {
      if (active) result.push(word);
      word = ''; active = false;
    } else { word += char; active = true; }
  }
  if (quote) stop('invalid_input');
  if (active) result.push(word);
  return result;
}
function path(value, cwd = '/') {
  if (!value || /[\x00-\x1f\\*?\[\]]/.test(value) || value.split('/').includes('..') || /^[a-z]+:/i.test(value)) stop();
  return posix.resolve(cwd, value);
}

// resolveImage is installed by trusted composition. Its envelope must already
// have been admitted against an immutable image/config binding by the caller.
// Hash checks below detect inconsistent transport; they cannot establish trust.
export function createDockerfileParser({ resolveImage } = {}) {
  return createRootParserRegistry({ dockerfile(input) {
    const edges = [];
    const edge = (kind, field, target) => edges.push({ kind, field, target });
    try {
      const decoded = decodeDockerfile(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.bytes));
      if (decoded.status !== 'decoded') stop(decoded.diagnostics[0].code);
      const stages = [], aliases = new Map();
      let current = null;
      const image = (reference, platform) => {
        if (typeof resolveImage !== 'function') stop('parser_unavailable');
        const admitted = resolveImage(reference, platform ?? null);
        if (!plain(admitted) || admitted.schema !== 'wp00-docker-image-config/v1' || admitted.reference !== reference ||
          !digest.test(admitted.imageDigest) || admitted.configHash !== hash(admitted.config) ||
          admitted.bindingHash !== hash({ reference, imageDigest: admitted.imageDigest, configHash: admitted.configHash })) stop();
        if (reference.includes('@') && reference.split('@')[1] !== admitted.imageDigest) stop();
        const config = structuredClone(admitted.config);
        if (!plain(config) || Object.keys(config).sort().join(',') !== 'cmd,entrypoint,env,healthcheck,onbuild,os,platform,shell,user,workingDir' ||
          config.os !== 'linux' || typeof config.platform !== 'string' || !config.platform.startsWith('linux/') ||
          (platform && config.platform !== platform) || !plain(config.env) ||
          Object.entries(config.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) ||
          !strings(config.shell) || !strings(config.onbuild) || config.onbuild.length || config.healthcheck !== null ||
          !strings(config.entrypoint) || !strings(config.cmd) || typeof config.user !== 'string' ||
          typeof config.workingDir !== 'string' || !config.workingDir.startsWith('/')) stop();
        config.workingDir = path(config.workingDir);
        edge('image', `/images/${edges.length}`, admitted.imageDigest);
        return config;
      };
      const execution = (argv, field) => {
        if (!strings(argv) || !argv.length || !argv[0]) stop('invalid_input');
        // Quote every argv element before invoking the bounded semantic checker:
        // this is lossless literal transport, never shell expansion of JSON text.
        const checked = validateShell(argv.map(quote).join(' '));
        if (checked.status !== 'parsed') stop(checked.diagnostics[0].code);
        edge('command', field, JSON.stringify(argv));
        for (const item of checked.edges) if (item.kind !== 'command') edge(item.kind, `${field}${item.field}`, item.target);
      };
      const shell = (command) => {
        if (current.shell.length !== 2 || !['/bin/sh', '/bin/bash', 'sh', 'bash'].includes(current.shell[0]) || current.shell[1] !== '-c') stop();
        return [...current.shell, command];
      };
      const finish = () => {
        if (!current) return;
        const base = `/stages/${stages.length - 1}/config`;
        edge('working_directory', `${base}/workingDir`, current.workingDir);
        edge('environment', `${base}/user`, current.user);
        for (const [key, value] of Object.entries(current.env)) edge('environment', `${base}/env/${key}`, value);
        const argv = [...current.entrypoint, ...current.cmd];
        if (argv.length) execution(argv, `/stages/${stages.length - 1}/runtime`);
      };
      for (const [index, item] of decoded.instructions.entries()) {
        const field = `/instructions/${index}`;
        const name = item.instruction;
        if (name === 'FROM') {
          finish();
          const args = item.argument.trim().split(/\s+/);
          if (![1, 3].includes(args.length) || (args.length === 3 && args[1].toUpperCase() !== 'AS') || /[$\\]/.test(args[0])) stop();
          const alias = args[2]?.toLowerCase();
          if (alias && (!/^[a-z][a-z0-9_.-]*$/.test(alias) || aliases.has(alias))) stop('ambiguous_structure');
          const inherited = aliases.get(args[0].toLowerCase());
          if (inherited && item.flags.platform && inherited.platform !== item.flags.platform) stop();
          current = inherited ? structuredClone(inherited) : image(args[0], item.flags.platform);
          current.cmdLocal = false;
          stages.push(current);
          if (alias) aliases.set(alias, current);
          edge('image', `${field}/FROM`, inherited ? `stage:${stages.indexOf(inherited)}` : args[0]);
          continue;
        }
        if (!current) stop('invalid_input');
        edge('working_directory', `${field}/cwd`, current.workingDir);
        edge('environment', `${field}/user`, current.user);
        for (const [key, value] of Object.entries(current.env)) edge('environment', `${field}/env/${key}`, value);
        if (['RUN', 'CMD', 'ENTRYPOINT'].includes(name)) {
          const argv = item.form === 'json' ? item.argv : shell(item.argument);
          if (name === 'RUN') execution(argv, `${field}/RUN`);
          else if (name === 'CMD') { current.cmd = argv; current.cmdLocal = true; }
          else { current.entrypoint = argv; if (!current.cmdLocal) current.cmd = []; }
        } else if (name === 'ENV') {
          const entries = words(item.argument, current.env, decoded.escape);
          const legacy = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]+([\s\S]*)$/.exec(item.argument);
          const values = entries[0]?.includes('=') ? entries : legacy ? [`${legacy[1]}=${words(legacy[2], current.env, decoded.escape, false).join('')}`] : [];
          if (!values.length) stop('invalid_input');
          const changes = Object.create(null);
          for (const value of values) {
            const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(value);
            if (!match || Object.hasOwn(changes, match[1])) stop('ambiguous_structure');
            changes[match[1]] = match[2];
          }
          Object.assign(current.env, changes);
        } else if (name === 'WORKDIR' || name === 'USER') {
          const args = words(item.argument, current.env, decoded.escape, false);
          if (args.length !== 1) stop('invalid_input');
          if (name === 'WORKDIR') current.workingDir = path(args[0], current.workingDir);
          else { if (!/^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/.test(args[0])) stop(); current.user = args[0]; }
        } else {
          const args = item.form === 'json' ? item.argv.map((value) => words(value, current.env, decoded.escape, false, true).join('')) : words(item.argument, current.env, decoded.escape);
          if (args.length < 2) stop('invalid_input');
          const destination = args.at(-1);
          if (args.length > 2 && !destination.endsWith('/')) stop('invalid_input');
          let origin = 'context';
          if (item.flags.from !== undefined) {
            const ref = item.flags.from;
            const stage = /^\d+$/.test(ref) ? stages[Number(ref)] : aliases.get(ref.toLowerCase());
            if (!stage || stage === current) stop();
            origin = `stage:${stages.indexOf(stage)}`;
          }
          for (const [key, value] of Object.entries(item.flags)) {
            if (key === 'from') continue;
            if ((key === 'chmod' && !/^0?[0-7]{3}$/.test(value)) || (key === 'chown' && !/^\d+(?::\d+)?$/.test(value))) stop();
            edge('environment', `${field}/${key}`, value);
          }
          for (const [offset, source] of args.slice(0, -1).entries()) {
            edge('entry', `${field}/${name}/${origin}/${offset}`, path(source));
          }
          edge('generated_output', `${field}/${name}/destination`, path(destination, current.workingDir));
          // ADD extraction and source-file identity remain aggregate obligations.
        }
      }
      finish();
      return { status: 'parsed', edges, diagnostics: [] };
    } catch (error) {
      const code = ['parser_unavailable', 'invalid_input', 'unsupported_syntax', 'ambiguous_structure', 'unresolved_execution'].includes(error) ? error : 'unresolved_execution';
      return { status: 'rejected', edges: [], diagnostics: [{ code, line: null, column: null, field: null }] };
    }
  } });
}

export const parseDockerfile = createDockerfileParser();
