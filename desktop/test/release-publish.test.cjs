const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

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

test('OSS retries failed uploads and never advances manifests before public assets are verified', { skip: process.platform === 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-stock-oss-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(assets);
  fs.mkdirSync(bin);
  for (const [metadata, name] of [['latest-mac.yml', 'mac.zip'], ['latest.yml', 'win.exe']]) {
    const bytes = Buffer.from(name);
    fs.writeFileSync(path.join(assets, name), bytes);
    fs.writeFileSync(path.join(assets, `${name}.blockmap`), 'blockmap');
    fs.writeFileSync(path.join(assets, metadata), `version: 1.3.0\nfiles:\n  - url: ${name}\n    sha512: ${crypto.createHash('sha512').update(bytes).digest('base64')}\n`);
  }
  fs.writeFileSync(path.join(bin, 'ossutil'), `#!/usr/bin/env bash
while [[ "$1" != cp ]]; do shift; done
name=$(basename "$2")
echo "upload:$name" >> "$CHECK_ROOT/log"
if [[ "$name" == mac.zip && ! -f "$CHECK_ROOT/retried" ]]; then touch "$CHECK_ROOT/retried"; exit 1; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
head=0; headers=; output=; name=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --head) head=1; shift ;;
    --dump-header) headers=$2; shift 2 ;;
    --output) output=$2; shift 2 ;;
    https://*) name=\${1##*/}; shift ;;
    *) shift ;;
  esac
done
echo "verify:$name" >> "$CHECK_ROOT/log"
if [[ "$head" == 1 ]]; then
  size=$(wc -c < "$CHECK_ROOT/assets/$name" | tr -d ' ')
  [[ "\${CORRUPT_SIZE:-0}" == 1 ]] && size=0
  printf 'HTTP/1.1 200 OK\\r\\nContent-Length: %s\\r\\n\\r\\n' "$size" > "$headers"
else cp "$CHECK_ROOT/assets/$name" "$output"; fi
`, { mode: 0o755 });
  const publish = (extra = {}) => spawnSync('bash', [path.resolve(__dirname, '../scripts/publish-updater-oss.sh'), assets], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CHECK_ROOT: root, ...extra },
  });
  const success = publish();
  assert.equal(success.status, 0, success.stderr);
  const log = fs.readFileSync(path.join(root, 'log'), 'utf8').trim().split('\n');
  assert.equal(log.filter((line) => line === 'upload:mac.zip').length, 2);
  assert.ok(log.indexOf('upload:latest-mac.yml') > log.indexOf('verify:win.exe.blockmap'));
  fs.writeFileSync(path.join(root, 'log'), '');
  const failure = publish({ CORRUPT_SIZE: '1' });
  assert.notEqual(failure.status, 0);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'log'), 'utf8'), /upload:latest/);
});
