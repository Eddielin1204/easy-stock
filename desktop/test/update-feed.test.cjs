const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveUpdateFeed } = require('../update-feed.cjs');

test('uses public GitHub Releases by default without credentials', () => {
  assert.deepEqual(resolveUpdateFeed(''), { provider: 'github', owner: 'jundizhou', repo: 'easy-stock' });
  assert.deepEqual(resolveUpdateFeed('  '), resolveUpdateFeed(''));
});

test('normalizes and validates a configured HTTPS update feed', () => {
  assert.deepEqual(resolveUpdateFeed('https://updates.example.com/desktop///'), { provider: 'generic', url: 'https://updates.example.com/desktop' });
  assert.throws(() => resolveUpdateFeed('http://updates.example.com/desktop'), /HTTPS/);
});

test('allows plain HTTP only for loopback feeds used by local end-to-end tests', () => {
  assert.deepEqual(resolveUpdateFeed('http://127.0.0.1:8765/updates'), { provider: 'generic', url: 'http://127.0.0.1:8765/updates' });
  assert.deepEqual(resolveUpdateFeed('http://localhost:8765/updates///'), { provider: 'generic', url: 'http://localhost:8765/updates' });
  assert.throws(() => resolveUpdateFeed('http://192.168.1.10:8765/updates'), /HTTPS/);
});

for (const [platform, metadata, names] of [
  ['win32', 'latest.yml', ['easy-stock-v1.6.0-windows-x64-setup.exe']],
  ['darwin', 'latest-mac.yml', ['easy-stock-v1.6.0-macos-arm64.zip', 'easy-stock-v1.6.0-macos-x64.zip']],
]) {
  test(`${platform} resolves metadata, packages and blockmaps from one GitHub release tag`, async () => {
    const { createClient } = require('electron-updater/out/providerFactory');
    const prefix = '/jundizhou/easy-stock/releases';
    const requests = [];
    const responses = {
      [`${prefix}.atom`]: `<feed><entry><title>easy-stock v1.6.0</title><link href="https://github.com${prefix}/tag/v1.6.0"/><content>Release notes</content></entry></feed>`,
      [`${prefix}/latest`]: JSON.stringify({ tag_name: 'v1.6.0' }),
      [`${prefix}/download/v1.6.0/${metadata}`]: `version: 1.6.0\nfiles:\n${names.map((name) => `  - url: ${name}\n    sha512: fixture-hash\n    size: 100\n`).join('')}`,
    };
    const provider = createClient(resolveUpdateFeed(''), { allowPrerelease: false }, {
      platform,
      executor: {
        async request(options) {
          assert.equal(options.hostname, 'github.com');
          assert.equal(options.headers?.authorization, undefined);
          requests.push(options.path);
          assert.ok(Object.hasOwn(responses, options.path), `Unexpected request: ${options.path}`);
          return responses[options.path];
        },
      },
    });
    const info = await provider.getLatestVersion();
    assert.equal(info.version, '1.6.0');
    assert.equal(info.releaseNotes, 'Release notes');
    assert.deepEqual(requests, Object.keys(responses));
    const files = provider.resolveFiles(info);
    assert.deepEqual(files.map((file) => file.url.href), names.map((name) => `https://github.com${prefix}/download/v1.6.0/${name}`));
    const [oldBlockmap, newBlockmap] = provider.getBlockMapFiles(files[0].url, '1.5.2', '1.6.0');
    assert.equal(newBlockmap.href, `${files[0].url.href}.blockmap`);
    assert.equal(oldBlockmap.href, `${files[0].url.href.replaceAll('1.6.0', '1.5.2')}.blockmap`);
    assert.equal(provider.isUseMultipleRangeRequest, false, 'GitHub downloads must not request multipart ranges');
  });
}
