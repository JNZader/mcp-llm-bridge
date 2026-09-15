import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { encodePathsBin } from '../outward-scanner.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fail = (code) => { throw new Error(`WP00 inventory: ${code}`); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function nulRecords(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('INVALID_GIT_OUTPUT');
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('INVALID_GIT_OUTPUT');
  return decoder.decode(bytes).slice(0, -1).split('\0');
}

// Decode byte-preserving -z output, never Git's quoted display paths. Validate all
// paths with the existing binary codec before using any one of them for IO.
export function decodeGitInventory(pathBytes, stageBytes) {
  try {
    const paths = nulRecords(pathBytes);
    const tracked = new Map();
    for (const entry of nulRecords(stageBytes)) {
      const match = /^(100644|100755|120000) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t([\s\S]+)$/.exec(entry);
      if (!match || tracked.has(match[3])) fail('INVALID_INDEX');
      tracked.set(match[3], Number.parseInt(match[1], 8));
    }
    encodePathsBin(paths.map((path) => ({ path, mode: tracked.get(path) ?? 0o100644, length: 0n, sha256: Buffer.alloc(32) })));
    if ([...tracked.keys()].some((path) => !paths.includes(path))) fail('INCONSISTENT_INDEX');
    return paths.sort(byteOrder).map((path) => ({ path, trackedMode: tracked.get(path) ?? null }));
  } catch {
    fail('INVALID_GIT_INVENTORY');
  }
}

function executable(path, mode, bytes) {
  return mode === 0o100755 || posix.extname(path) === '' ||
    /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|sh)$/.test(path) ||
    (bytes[0] === 35 && bytes[1] === 33);
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

// Linux descriptor-relative traversal keeps every parent anchored to the opened
// root, even if renamed. No parent symlink or final regular-file symlink is followed.
function readRecord(rootFd, entry) {
  const owned = [];
  let parentFd = rootFd;
  try {
    const parts = entry.path.split('/');
    for (const part of parts.slice(0, -1)) {
      parentFd = openSync(`/proc/self/fd/${parentFd}/${part}`, directoryFlags);
      owned.push(parentFd);
    }
    const path = `/proc/self/fd/${parentFd}/${parts.at(-1)}`;
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() && !before.isSymbolicLink()) fail('SPECIAL_FILE');
    const mode = before.isSymbolicLink() ? 0o120000 : (before.mode & 0o111n) !== 0n ? 0o100755 : 0o100644;
    if (entry.trackedMode !== null && entry.trackedMode !== mode) fail('MODE_MISMATCH');
    let bytes;
    if (before.isSymbolicLink()) {
      bytes = readlinkSync(path, { encoding: 'buffer' });
    } else {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      owned.push(fd);
      if (!sameFile(before, fstatSync(fd, { bigint: true }))) fail('FILE_CHANGED');
      bytes = readFileSync(fd);
      if (!sameFile(before, fstatSync(fd, { bigint: true }))) fail('FILE_CHANGED');
    }
    if (!sameFile(before, lstatSync(path, { bigint: true }))) fail('FILE_CHANGED');
    return { path: entry.path, mode, length: BigInt(bytes.length), sha256: hash(bytes), bytes,
      executable: mode !== 0o120000 && executable(entry.path, mode, bytes) };
  } finally {
    for (const fd of owned.reverse()) closeSync(fd);
  }
}

function resolveLinks(records, rootFd) {
  const byPath = new Map(records.map((record) => [record.path, record]));
  for (const record of records) {
    if (record.mode !== 0o120000) continue;
    const visited = new Set([record.path]);
    let current = record;
    while (current.mode === 0o120000) {
      const target = decoder.decode(current.bytes);
      if (!target || target.includes('\0') || target.includes('\\') || posix.isAbsolute(target)) fail('INVALID_SYMLINK');
      // Check intermediate directories before normalization: missing/../file
      // must not be accepted as file. No intermediate symlinks are followed.
      const segments = posix.dirname(current.path) === '.' ? [] : posix.dirname(current.path).split('/');
      for (const part of target.split('/').slice(0, -1)) {
        if (part === '..') {
          if (segments.length === 0) fail('INVALID_SYMLINK');
          segments.pop();
        } else if (part && part !== '.') {
          segments.push(part);
          const fd = openSync(`/proc/self/fd/${rootFd}/${segments.join('/')}`, directoryFlags);
          closeSync(fd);
        }
      }
      const resolved = posix.normalize(posix.join(posix.dirname(current.path), target));
      if (resolved === '..' || resolved.startsWith('../') || !byPath.has(resolved) || visited.has(resolved)) fail('INVALID_SYMLINK');
      visited.add(resolved);
      current = byPath.get(resolved);
    }
    record.targetPath = current.path;
    record.executable = current.executable || executable(record.path, 0o100644, current.bytes);
  }
}

// Git omits untracked FIFOs/sockets/devices. Inspect directory entry types too,
// pruning Git-ignored paths, without reading special files or following symlinks.
function rejectSpecialFiles(fd, prefix, runGit) {
  const entries = readdirSync(`/proc/self/fd/${fd}`, { withFileTypes: true, encoding: 'buffer' })
    .map((entry) => ({ entry, name: decoder.decode(entry.name) }))
    .filter(({ name }) => prefix !== '' || name !== '.git');
  if (entries.length === 0) return;
  const paths = entries.map(({ entry, name }) => prefix + name + (entry.isDirectory() ? '/' : ''));
  let ignoredBytes;
  try {
    ignoredBytes = runGit(['check-ignore', '-z', '--stdin'], Buffer.from(paths.join('\0') + '\0'));
  } catch (error) {
    if (error.status !== 1) throw error;
    ignoredBytes = error.stdout;
  }
  const ignored = new Set(nulRecords(ignoredBytes));
  for (const [index, { entry, name }] of entries.entries()) {
    if (ignored.has(paths[index])) continue;
    if (entry.isDirectory()) {
      const child = openSync(`/proc/self/fd/${fd}/${name}`, directoryFlags);
      try { rejectSpecialFiles(child, prefix + name + '/', runGit); } finally { closeSync(child); }
    } else if (!entry.isFile() && !entry.isSymbolicLink()) {
      fail('SPECIAL_FILE');
    }
  }
}

// This captures an inventory, not admitted authority. The caller must supply an
// immutable candidate for multi-file coherence, then bind paths.bin and the manifest.
// Git output is bounded; oversize, malformed, changed, missing and special files fail.
export function collectRootInventory(root) {
  let rootFd;
  try {
    if (process.platform !== 'linux') fail('UNSUPPORTED_PLATFORM');
    const cwd = realpathSync(root);
    rootFd = openSync(cwd, directoryFlags);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const runGit = (args, input) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      cwd, env, input, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const git = (...args) => runGit(args);
    const top = decoder.decode(git('rev-parse', '--show-toplevel')).replace(/\n$/, '');
    if (realpathSync(top) !== cwd) fail('NOT_WORKTREE_ROOT');
    const paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard');
    const stages = git('ls-files', '--stage', '-z');
    const entries = decodeGitInventory(paths, stages);
    rejectSpecialFiles(rootFd, '', runGit);
    const records = entries.map((entry) => readRecord(rootFd, entry));
    resolveLinks(records, rootFd);
    if (!paths.equals(git('ls-files', '-z', '--cached', '--others', '--exclude-standard')) ||
      !stages.equals(git('ls-files', '--stage', '-z'))) fail('INVENTORY_CHANGED');
    const pathsBin = encodePathsBin(records.map((record) => ({ ...record, sha256: Buffer.from(record.sha256, 'hex') })));
    return { schema: 'wp00-root-inventory/v1', records, pathsBin };
  } catch {
    // IO/Git errors can include filenames, link targets or environment values.
    fail('REJECTED');
  } finally {
    if (rootFd !== undefined) closeSync(rootFd);
  }
}
