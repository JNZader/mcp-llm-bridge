import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = {
  node: '22.23.2',
  abi: '127',
  package: '12.8.0',
  platform: process.platform,
  arch: process.arch,
};
const require = createRequire(import.meta.url);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name} argument`);
  return resolve(process.argv[index + 1]);
}

function sha256(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    import('node:fs').then(({ createReadStream }) => {
      const stream = createReadStream(file);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolveHash(hash.digest('hex')));
    }, reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const receiptPath = argument('--receipt');
  const packageEntry = realpathSync(require.resolve('better-sqlite3'));
  const packageRoot = dirname(dirname(packageEntry));
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const nativePath = resolve(packageRoot, 'build/Release/better_sqlite3.node');
  const lockPath = resolve(dirname(fileURLToPath(import.meta.url)), 'pnpm-lock.yaml');
  assert(packageJson.version === EXPECTED.package, `better-sqlite3 ${packageJson.version} != ${EXPECTED.package}`);
  assert(process.version === `v${EXPECTED.node}`, `Node ${process.version} != v${EXPECTED.node}`);
  assert(process.versions.modules === EXPECTED.abi, `ABI ${process.versions.modules} != ${EXPECTED.abi}`);
  assert(existsSync(nativePath) && statSync(nativePath).isFile(), `Missing native binding: ${nativePath}`);
  assert(existsSync(lockPath), `Missing lockfile: ${lockPath}`);

  const bindingHash = await sha256(nativePath);
  const lockHash = await sha256(lockPath);
  const sqlite = require('better-sqlite3');
  const database = new sqlite(':memory:');
  try {
    assert(database.prepare('SELECT 1 AS ok').get().ok === 1, 'SQLite SELECT 1 failed');
  } finally {
    database.close();
  }

  const receipt = {
    schema: 1,
    node: EXPECTED.node,
    abi: EXPECTED.abi,
    platform: EXPECTED.platform,
    arch: EXPECTED.arch,
    libc: process.report?.getReport().header?.glibcVersionRuntime ? 'glibc' : 'non-glibc',
    lockSha256: lockHash,
    package: 'better-sqlite3',
    packageVersion: packageJson.version,
    nativePath,
    nativeSha256: bindingHash,
  };
  if (existsSync(receiptPath)) {
    const expected = JSON.parse(await readFile(receiptPath, 'utf8'));
    for (const key of Object.keys(receipt)) assert(expected[key] === receipt[key], `Receipt mismatch: ${key}`);
  } else {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o444 });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

main().catch((error) => {
  process.stderr.write(`native-binding-verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
