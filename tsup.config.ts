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
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  onSuccess: async () => {
    copyMigrations();
  },
});
