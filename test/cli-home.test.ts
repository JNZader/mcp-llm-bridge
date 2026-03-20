import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { materializeProviderHome } from '../src/adapters/cli-home.js';

describe('materializeProviderHome', () => {
  it('writes files into the provider home and cleans up', () => {
    const mount = materializeProviderHome('gemini', [
      { fileName: 'settings.json', content: '{"ok":true}' },
      { fileName: 'nested/state.json', content: '{"state":1}' },
    ]);

    const settingsPath = join(mount.homeDir, '.gemini', 'settings.json');
    const statePath = join(mount.homeDir, '.gemini', 'nested', 'state.json');

    assert.equal(readFileSync(settingsPath, 'utf8'), '{"ok":true}');
    assert.equal(readFileSync(statePath, 'utf8'), '{"state":1}');

    mount.cleanup();
    assert.equal(existsSync(mount.homeDir), false);
  });

  it('rejects parent directory traversal', () => {
    assert.throws(
      () => materializeProviderHome('qwen', [{ fileName: '../oauth_creds.json', content: '{}' }]),
      /Unsafe provider file path/,
    );
  });

  it('rejects absolute paths', () => {
    assert.throws(
      () => materializeProviderHome('claude', [{ fileName: '/tmp/.credentials.json', content: '{}' }]),
      /Unsafe provider file path/,
    );
  });
});
