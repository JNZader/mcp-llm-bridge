import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const SOURCE_ROOT = new URL('../../../../src/mcp-builder/', import.meta.url);

function emit(sourceName: string, directory: string): void {
  const sourceUrl = new URL(sourceName, SOURCE_ROOT);
  const output = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
    // NodeNext uses the input extension to select CJS vs ESM; fixtures stay `.js` but must emit ESM.
    fileName: sourceUrl.pathname.replace(/\.ts$/, '.mts'),
  }).outputText;
  writeFileSync(join(directory, sourceName.replace(/\.ts$/, '.js')), output, 'utf8');
}

/** Emits the worker and its relative ESM protocol dependency into an isolated fixture. */
export function emitPluginRuntimeWorker(directory: string): URL {
  emit('plugin-runtime-worker.ts', directory);
  emit('plugin-runtime-protocol.ts', directory);
  return pathToFileURL(join(directory, 'plugin-runtime-worker.js'));
}
