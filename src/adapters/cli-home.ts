import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

function assertSafeFileName(fileName: string): string {
  const normalized = normalize(fileName).replace(/\\/g, '/');

  if (!fileName || isAbsolute(fileName) || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Unsafe provider file path: ${fileName}`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Unsafe provider file path: ${fileName}`);
  }

  return normalized;
}

export function materializeProviderHome(
  providerDir: string,
  files: Array<{ fileName: string; content: string }>,
): { homeDir: string; cleanup: () => void } {
  const safeProvider = providerDir.replace(/^\.+/, '');
  const homeDir = `/tmp/${safeProvider}-auth-${process.pid}-${Date.now()}`;
  const targetDir = join(homeDir, `.${safeProvider}`);

  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  for (const file of files) {
    const safeFileName = assertSafeFileName(file.fileName);
    const targetPath = join(targetDir, safeFileName);
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    writeFileSync(targetPath, file.content, { mode: 0o600 });
  }

  return {
    homeDir,
    cleanup: () => {
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
