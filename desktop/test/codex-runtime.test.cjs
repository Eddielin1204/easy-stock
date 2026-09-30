const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');

test('Codex artifacts are pinned for the current desktop release targets', async () => {
  const { codexLock, codexExecutable } = await import('../scripts/codex-runtime.mjs');
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    const asset = codexLock.platforms[target];
    assert.equal(asset.version, `${codexLock.version}-${target}`);
    assert.match(asset.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
    assert.equal(new URL(asset.url).hostname, 'registry.npmjs.org');
  }
  assert.match(codexExecutable('/runtime', 'win32'), /bin[\\/]codex.exe$/);
});

test('Codex archive verification refuses corrupted or substituted downloads', async () => {
  const { verifyCodexArchive } = await import('../scripts/codex-runtime.mjs');
  const bytes = Buffer.from('locked artifact');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  verifyCodexArchive(bytes, integrity);
  assert.throws(() => verifyCodexArchive(Buffer.from('different artifact'), integrity), /integrity mismatch/);
});
