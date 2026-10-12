const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('release recovery rejects builds for a different tag, failed platforms and expired artifacts', async () => {
  const { verifyReleaseBuild } = await import('../scripts/verify-release-build.mjs');
  const run = { head_sha: 'release-commit', path: '.github/workflows/release.yml' };
  const jobs = ['Test release source', 'macOS arm64', 'macOS x64', 'Windows x64'].map((name) => ({ name, conclusion: 'success' }));
  const artifacts = ['easy-stock-macos-arm64', 'easy-stock-macos-x64', 'easy-stock-windows-x64'].map((name) => ({ name, size_in_bytes: 10, digest: `sha256:${'a'.repeat(64)}`, expired: false }));
  assert.doesNotThrow(() => verifyReleaseBuild('release-commit', run, jobs, artifacts));
  assert.throws(() => verifyReleaseBuild('different-commit', run, jobs, artifacts));
  assert.throws(() => verifyReleaseBuild('release-commit', { ...run, path: 'unrelated.yml' }, jobs, artifacts));
  assert.throws(() => verifyReleaseBuild('release-commit', run, jobs.slice(1), artifacts));
  assert.throws(() => verifyReleaseBuild('release-commit', run, jobs.map((job) => ({ ...job, conclusion: 'failure' })), artifacts));
  assert.throws(() => verifyReleaseBuild('release-commit', run, jobs, artifacts.map((item) => ({ ...item, expired: true }))));
});

test('DMG capacity grows with bundled runtime files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-stock-dmg-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { dmgSizeMiB } = await import('../scripts/dmg-size.mjs');
  assert.equal(dmgSizeMiB(root), 1200);
  const file = fs.openSync(path.join(root, 'large-runtime'), 'w');
  fs.ftruncateSync(file, 1500 * 1024 * 1024);
  fs.closeSync(file);
  assert.ok(dmgSizeMiB(root) > 1500 + 128);
  if (process.platform !== 'win32') {
    fs.symlinkSync(root, path.join(root, 'external-link'));
    assert.ok(dmgSizeMiB(root) < 2000, 'symlinks must not duplicate target contents');
  }
});

test('GitHub publication rejects incomplete or corrupted remote assets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-stock-publish-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('verified installer');
  fs.writeFileSync(path.join(root, 'installer.exe'), bytes);
  const asset = {
    name: 'installer.exe', state: 'uploaded', size: bytes.length,
    digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
  };
  const verify = (assets) => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/verify-github-release-assets.mjs'), root], {
    input: JSON.stringify({ assets }), encoding: 'utf8',
  });
  assert.equal(verify([asset]).status, 0);
  assert.notEqual(verify([]).status, 0);
  assert.notEqual(verify([{ ...asset, digest: 'sha256:corrupt' }]).status, 0);
  assert.notEqual(verify([{ ...asset, size: bytes.length - 1 }]).status, 0);
  assert.notEqual(verify([{ ...asset, state: 'new' }]).status, 0);
});
