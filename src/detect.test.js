import { test, describe } from 'node:test';
import assert from 'node:assert';
import { detectProviders } from './detect.js';

describe('detectProviders', () => {
  test('returns an array', async () => {
    const providers = await detectProviders();
    assert.ok(Array.isArray(providers));
  });

  test('each provider has name and command', async () => {
    const providers = await detectProviders();
    for (const p of providers) {
      assert.ok(p.name, 'provider should have a name');
      assert.ok(p.command, 'provider should have a command');
    }
  });
});
