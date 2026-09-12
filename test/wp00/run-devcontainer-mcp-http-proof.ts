import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const WORKSPACE = resolve(new URL('../..', import.meta.url).pathname);
const LABEL_KEY = 'wp00.devcontainer-mcp-http-proof';

export function parseArguments(argv: readonly string[]): { run: boolean } {
  return { run: argv.includes('--run') };
}

export function buildLifecycleCommands(workspace: string, nonce: string): {
  up: { command: string; args: string[] };
  exec: { command: string; args: string[] };
  userDataFolder: string;
  label: string;
} {
  const userDataFolder = `/tmp/wp00-devcontainer-user-data-${nonce}`;
  const label = `${LABEL_KEY}=${nonce}`;
  return {
    up: {
      command: 'devcontainer',
      args: ['up', '--workspace-folder', workspace, '--user-data-folder', userDataFolder, '--id-label', label],
    },
    exec: {
      command: 'devcontainer',
      args: [
        'exec', '--workspace-folder', workspace, '--user-data-folder', userDataFolder,
        '--id-label', label,
        'node', '--import', 'tsx', 'test/wp00/devcontainer-mcp-http-proof.ts',
      ],
    },
    userDataFolder,
    label,
  };
}

export async function runHostProof(workspace = WORKSPACE): Promise<string> {
  const nonce = `${Date.now()}-${randomBytes(6).toString('hex')}`;
  const commands = buildLifecycleCommands(workspace, nonce);
  await execFileAsync(commands.up.command, commands.up.args, { cwd: workspace, maxBuffer: 1024 * 1024 });
  const result = await execFileAsync(commands.exec.command, commands.exec.args, {
    cwd: workspace,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}

if (process.argv[1]?.endsWith('run-devcontainer-mcp-http-proof.ts')) {
  if (!parseArguments(process.argv.slice(2)).run) {
    process.stderr.write('Refusing to run the Dev Container proof without --run.\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(await runHostProof());
  }
}
