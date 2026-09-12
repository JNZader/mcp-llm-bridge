import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

/**
 * Copy SQL migration files into the build output so the bundled binary can run
 * migrations at startup. tsup does not copy non-code assets by default, and the
 * emitted chunks live flat in `dist/`, so migrate.ts resolves `dist/migrations/`.
 */
function copyMigrations(): void {
  const srcDir = join('src', 'migrations');
  const outDir = join('dist', 'migrations');
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    if (file.endsWith('.sql')) {
      copyFileSync(join(srcDir, file), join(outDir, file));
    }
  }
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'plugin-runtime-worker': 'src/mcp-builder/plugin-runtime-worker.ts',
    loader: 'src/mcp-builder/loader.ts',
    'plugin-runtime-host': 'src/mcp-builder/plugin-runtime-host.ts',
    'plugin-runtime-registry': 'src/mcp-builder/plugin-runtime-registry.ts',
  },
  // Keep the worker's internal implementation within its independently hashed entry.
  splitting: false,
  format: ['esm'],
  dts: true,
  onSuccess: async () => {
    copyMigrations();
  },
});
