/**
 * Test setup module to provide global require() for ESM test files
 * 
 * This module injects a require() function into the global scope so that
 * test files using CommonJS-style require() can work in ESM context.
 * 
 * @module test/setup/inject-require
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

// Create a require function that resolves from the test/logging directory
// This matches where the request-logger.test.ts file is located
const testDir = join(process.cwd(), 'test/logging');
const require = createRequire(join(testDir, 'dummy.js'));

// Define require as a global property
Object.defineProperty(globalThis, 'require', {
  value: require,
  writable: true,
  configurable: true,
  enumerable: true
});

// Also expose createRequire for advanced use cases
globalThis.createRequire = createRequire;
