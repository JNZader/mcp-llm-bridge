import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('WP00PTH\0', 'ascii');
const VERSION = 1;
const HEADER_SIZE = 16;
const RECORD_MODES = new Set([0o100644, 0o100755, 0o120000]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) { throw new Error(`WP00 scanner: ${message}`); }

function assertPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || path === '.' || path.includes('//')) fail('invalid path');
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('invalid path');
  return path;
}

function assertRecord(record) {
  const path = assertPath(record.path); assertScalarString(path);
  if (!RECORD_MODES.has(record.mode)) fail('unsupported mode');
  const hash = record.sha256 instanceof Uint8Array ? record.sha256 : undefined;
  if (!hash || hash.byteLength !== 32) fail('invalid SHA-256');
  const length = typeof record.length === 'bigint' ? record.length : BigInt(record.length);
  if (length < 0n || length > 0xffff_ffff_ffff_ffffn) fail('invalid byte length');
  return { path, mode: record.mode, length, sha256: hash };
}

function compareBytes(left, right) { return Buffer.compare(encoder.encode(left), encoder.encode(right)); }

export function encodePathsBin(input) {
  if (!Array.isArray(input)) fail('records must be an array');
  const records = input.map(assertRecord).sort((a, b) => compareBytes(a.path, b.path));
  if (records.some((record, index) => index > 0 && record.path === records[index - 1].path)) fail('duplicate path');
  const body = records.map((record) => {
    const path = encoder.encode(record.path); const bytes = Buffer.allocUnsafe(16 + path.byteLength + 32);
    bytes.writeUInt32BE(path.byteLength, 0); Buffer.from(path).copy(bytes, 4); bytes.writeUInt32BE(record.mode, 4 + path.byteLength);
    bytes.writeBigUInt64BE(record.length, 8 + path.byteLength); Buffer.from(record.sha256).copy(bytes, 16 + path.byteLength);
    return bytes;
  });
  const header = Buffer.alloc(HEADER_SIZE); MAGIC.copy(header); header.writeUInt16BE(VERSION, 8); header.writeUInt16BE(0, 10); header.writeUInt32BE(records.length, 12);
  return Buffer.concat([header, ...body]);
}

export function decodePathsBin(input) {
  const bytes = Buffer.from(input);
  if (bytes.byteLength < HEADER_SIZE || !bytes.subarray(0, 8).equals(MAGIC) || bytes.readUInt16BE(8) !== VERSION || bytes.readUInt16BE(10) !== 0) fail('invalid paths.bin header');
  const count = bytes.readUInt32BE(12); let offset = HEADER_SIZE; const records = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > bytes.byteLength) fail('truncated record'); const pathLength = bytes.readUInt32BE(offset); offset += 4;
    if (offset + pathLength + 44 > bytes.byteLength) fail('truncated record');
    let path; try { path = decoder.decode(bytes.subarray(offset, offset + pathLength)); } catch { fail('invalid UTF-8 path'); }
    offset += pathLength; const mode = bytes.readUInt32BE(offset); offset += 4; const length = bytes.readBigUInt64BE(offset); offset += 8; const sha256 = bytes.subarray(offset, offset + 32); offset += 32;
    records.push(assertRecord({ path, mode, length, sha256: new Uint8Array(sha256) }));
  }
  if (offset !== bytes.byteLength) fail('trailing bytes');
  for (let index = 1; index < records.length; index += 1) if (compareBytes(records[index - 1].path, records[index].path) >= 0) fail('records are not byte-sorted');
  return records;
}

function assertScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xdc00 || value.charCodeAt(index + 1) > 0xdfff) fail('unpaired surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('unpaired surrogate');
  }
}
function quote(value) {
  assertScalarString(value); let out = "\""; const short = { 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r" };
  for (const char of value) { const code = char.codePointAt(0);
    if (char === "\"" || char === "\\") out += "\\" + char;
    else if (code <= 0x1f) out += short[code] ?? "\\u" + code.toString(16).padStart(4, "0");
    else out += char;
  } return out + "\"";
}

export function canonicalizeJcs(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('non-integer number'); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('unsupported JSON value');
  return `{${Object.keys(value).sort().map((key) => `${quote(key)}:${canonicalizeJcs(value[key])}`).join(',')}}`;
}

export function parseJsonWithoutDuplicateKeys(text) {
  let offset = 0; const space = () => { while (/\s/.test(text[offset] ?? "")) offset += 1; };
  const string = () => { const start = offset++; while (offset < text.length && text[offset] !== "\"") offset += text[offset] === "\\" ? 2 : 1; if (offset >= text.length) fail("invalid JSON"); return JSON.parse(text.slice(start, ++offset)); };
  const value = () => {
    space();
    if (offset >= text.length) fail("invalid JSON");
    const character = text[offset];
    if (character === "\"") return string();
    if (character === "{") return object();
    if (character === "[") return array();

    const start = offset;
    while (offset < text.length && !/[\s,\]}/]/.test(text[offset])) {
      offset += 1;
    }
    if (offset === start) fail("invalid JSON");
    return JSON.parse(text.slice(start, offset));
  };
  const object = () => { offset += 1; const keys = new Set(); space(); if (text[offset] === "}") { offset += 1; return {}; } while (true) { space(); if (text[offset] !== "\"") fail("invalid JSON"); const key = string(); if (keys.has(key)) fail("duplicate JSON key"); keys.add(key); space(); if (text[offset++] !== ":") fail("invalid JSON"); value(); space(); if (text[offset] === "}") { offset += 1; return {}; } if (text[offset++] !== ",") fail("invalid JSON"); } };
  const array = () => { offset += 1; space(); if (text[offset] === "]") { offset += 1; return []; } while (true) { value(); space(); if (text[offset] === "]") { offset += 1; return []; } if (text[offset++] !== ",") fail("invalid JSON"); } };
  try { value(); space(); if (offset !== text.length) fail("invalid JSON"); return JSON.parse(text); } catch { fail("invalid JSON"); }
}

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function hashBytes(value) { const normalized = value.replace(/^sha256:/, ''); if (!/^[0-9a-f]{64}$/.test(normalized)) fail('invalid hash identity'); return Buffer.from(normalized, 'hex'); }

export function createArtifactHash(pathsBin, manifest) {
  const copy = { ...manifest }; delete copy.wp00ArtifactHash; delete copy.bindingHash;
  return `sha256:${sha256(Buffer.concat([Buffer.from('wp00-artifact-v1\0'), Buffer.from(pathsBin), Buffer.from(canonicalizeJcs(copy), 'utf8')]))}`;
}

export function createBindingHash(providerSubjectHash, wp00ArtifactHash) {
  if (typeof providerSubjectHash !== 'string') fail('invalid provider subject hash'); assertScalarString(providerSubjectHash);
  return `sha256:${sha256(Buffer.concat([Buffer.from('wp00-provider-binding-v1\0'), Buffer.from(providerSubjectHash, 'utf8'), hashBytes(wp00ArtifactHash)]))}`;
}

// Defer the CLI import without top-level await: inventory imports this codec,
// so awaiting its dynamic import here would deadlock an ESM dependency cycle.
let direct = false;
try { direct = !!process.argv[1] && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url; } catch { /* Library imports stay silent. */ }
if (direct) {
  import('./scanner/root-coverage-cli.mjs').then(({ runCoverageCli }) => {
    process.exitCode = runCoverageCli(process.argv.slice(2));
  }).catch(() => {
    process.stdout.write(JSON.stringify({ schema: 'wp00-root-coverage/v1', status: 'coverage_failed', admission: 'not_evaluated',
      diagnostics: [{ code: 'cli_unavailable', line: null, column: null, field: null }] }) + '\n');
    process.exitCode = 1;
  });
}
