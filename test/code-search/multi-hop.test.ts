/**
 * Tests for multi-hop import resolution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractImports } from '../../src/code-search/multi-hop.js';

describe('extractImports', () => {
  it('extracts ES named imports', () => {
    const content = `
import { Router, Vault } from './core/router.js';
import { logger } from '../utils/logger.js';
`.trim();

    const imports = extractImports('/project/src/app.ts', content);

    assert.ok(imports.length >= 2, `Expected at least 2 imports, got ${imports.length}`);

    const routerImport = imports.find((i) => i.specifier === './core/router.js');
    assert.ok(routerImport, 'Should find router import');
    assert.deepEqual(routerImport.symbols, ['Router', 'Vault']);
  });

  it('extracts ES default imports', () => {
    const content = `import Express from 'express';`;
    const imports = extractImports('/project/src/app.ts', content);

    const expressImport = imports.find((i) => i.specifier === 'express');
    assert.ok(expressImport, 'Should find express import');
    assert.deepEqual(expressImport.symbols, ['Express']);
    // Bare import — no resolution
    assert.equal(expressImport.resolvedPath, null);
  });

  it('extracts ES star imports', () => {
    const content = `import * as path from 'node:path';`;
    const imports = extractImports('/project/src/app.ts', content);

    assert.ok(imports.length >= 1);
    const pathImport = imports.find((i) => i.specifier === 'node:path');
    assert.ok(pathImport, 'Should find path import');
    assert.deepEqual(pathImport.symbols, ['path']);
  });

  it('extracts CommonJS require', () => {
    const content = `
const { readFile } = require('node:fs');
const express = require('express');
`.trim();

    const imports = extractImports('/project/src/app.ts', content);
    assert.ok(imports.length >= 2, `Expected at least 2 imports, got ${imports.length}`);
  });

  it('extracts Python imports', () => {
    const content = `
from flask import Flask, request
from .utils import helper
`.trim();

    const imports = extractImports('/project/app.py', content);
    assert.ok(imports.length >= 2, `Expected at least 2 imports, got ${imports.length}`);

    const flaskImport = imports.find((i) => i.specifier === 'flask');
    assert.ok(flaskImport, 'Should find flask import');
  });

  it('deduplicates import specifiers', () => {
    const content = `
import { A } from './module.js';
import { B } from './module.js';
`.trim();

    const imports = extractImports('/project/src/app.ts', content);
    const moduleImports = imports.filter((i) => i.specifier === './module.js');
    assert.equal(moduleImports.length, 1, 'Should deduplicate same specifier');
  });

  it('handles empty content', () => {
    const imports = extractImports('/project/src/app.ts', '');
    assert.equal(imports.length, 0);
  });

  it('handles content with no imports', () => {
    const content = 'const x = 42;\nconsole.log(x);';
    const imports = extractImports('/project/src/app.ts', content);
    assert.equal(imports.length, 0);
  });
});
