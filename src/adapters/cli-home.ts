import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

type ProviderFile = { fileName: string; content: string };

type ProviderHomeMount = { homeDir: string; targetDir: string; cleanup: () => void };

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

/**
 * Compute a simple hash of file contents for change detection.
 */
function computeFilesHash(files: Array<{ fileName: string; content: string }>): string {
  const content = files.map((f) => `${f.fileName}:${f.content}`).join('|');
  // Simple hash using built-in approach - sufficient for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

function writeProviderFiles(targetDir: string, files: ProviderFile[]): void {
  for (const file of files) {
    const safeFileName = assertSafeFileName(file.fileName);
    const targetPath = join(targetDir, safeFileName);
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    writeFileSync(targetPath, file.content, { mode: 0o600 });
  }
}

/**
 * Cache for provider home directories to avoid recreating temp dirs on every request.
 * Key: `${provider}:${project || '_global'}`
 * Value: { homeDir, targetDir, filesHash }
 */
const homeDirCache = new Map<string, { homeDir: string; targetDir: string; filesHash: string }>();

/**
 * Materialize provider home directory with caching.
 * 
 * Creates a persistent temp directory per provider/project that is reused
 * across requests when file contents haven't changed. This avoids the
 * overhead of creating directories and writing files on every request.
 * 
 * @param providerDir - Provider identifier (e.g., 'claude', 'gemini')
 * @param files - Files to materialize in the provider home
 * @param project - Optional project scope for multi-tenancy
 * @returns Object with homeDir, targetDir, and cleanup function
 */
export function materializeProviderHome(
  providerDir: string,
  files: ProviderFile[],
  project?: string,
): ProviderHomeMount {
  const safeProvider = providerDir.replace(/^\.+/, '').replace(/[^a-zA-Z0-9-_]/g, '-');
  const cacheKey = `${safeProvider}:${project ?? '_global'}`;
  const newHash = computeFilesHash(files);

  // Check if we have a valid cached entry
  const cached = homeDirCache.get(cacheKey);
  if (cached && cached.filesHash === newHash) {
    // Files haven't changed, reuse the cached directory
    return {
      homeDir: cached.homeDir,
      targetDir: cached.targetDir,
      cleanup: () => {
        // Don't clean up - keep cached for future requests
      },
    };
  }

  // Clean up old entry if exists
  if (cached) {
    try {
      rmSync(cached.homeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  // Create new directory with hash in path for uniqueness
  const hashSuffix = newHash.substring(0, 8);
  const homeDir = `/tmp/llm-gw/${safeProvider}-${hashSuffix}`;
  const targetDir = join(homeDir, `.${safeProvider}`);

  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  writeProviderFiles(targetDir, files);

  // Cache the result
  homeDirCache.set(cacheKey, { homeDir, targetDir, filesHash: newHash });

  return {
    homeDir,
    targetDir,
    cleanup: () => {
      // Remove from cache and delete directory
      homeDirCache.delete(cacheKey);
      try {
        rmSync(homeDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Materialize a provider home that belongs to exactly one request.
 *
 * Unlike the cached provider home, each call creates a distinct temporary
 * directory and its cleanup removes only that directory. This keeps one
 * request's credential mount independent from overlapping requests.
 */
export function materializeRequestProviderHome(
  providerDir: string,
  files: ProviderFile[],
  _project?: string,
): ProviderHomeMount {
  const safeProvider = providerDir.replace(/^\.+/, '').replace(/[^a-zA-Z0-9-_]/g, '-');
  const providerRoot = '/tmp/llm-gw';

  mkdirSync(providerRoot, { recursive: true, mode: 0o700 });
  const homeDir = mkdtempSync(join(providerRoot, `${safeProvider}-request-`));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort and affects only this request-owned directory.
    }
  };

  try {
    chmodSync(homeDir, 0o700);
    const targetDir = join(homeDir, `.${safeProvider}`);
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    chmodSync(targetDir, 0o700);
    writeProviderFiles(targetDir, files);
    return { homeDir, targetDir, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Clean up all cached provider home directories.
 * Call this during graceful shutdown.
 */
export function cleanupAllProviderHomes(): void {
  for (const cached of homeDirCache.values()) {
    try {
      rmSync(cached.homeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  homeDirCache.clear();
}
