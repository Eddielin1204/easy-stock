import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const codexLock = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'codex-runtime-lock.json'), 'utf8'));
export const codexExecutable = (root, platform = process.platform) => path.join(root, 'bin', platform === 'win32' ? 'codex.exe' : 'codex');

export function verifyCodexArchive(bytes, integrity) {
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== integrity) throw new Error('Codex archive integrity mismatch');
}

export async function prepareCodexRuntime({ runtimeRoot, platform = process.platform, arch = process.arch, archive = process.env.CODEX_RUNTIME_ARCHIVE } = {}) {
  if (!runtimeRoot) throw new Error('runtimeRoot is required');
  if (platform !== process.platform || arch !== process.arch) throw new Error('Codex must be packaged and verified on its target OS and architecture');
  const asset = codexLock.platforms[`${platform}-${arch}`];
  if (!asset) throw new Error(`Unsupported Codex platform: ${platform}-${arch}`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-stock-codex-package-'));
  try {
    let bytes;
    if (archive) bytes = fs.readFileSync(archive);
    else {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
      if (!response.ok) throw new Error(`Codex download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    verifyCodexArchive(bytes, asset.integrity);
    const tarball = path.join(staging, 'codex.tgz');
    fs.writeFileSync(tarball, bytes);
    const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
    if (listing.status !== 0) throw new Error('Cannot inspect Codex archive');
    for (const entry of listing.stdout.trim().split('\n')) {
      if (!entry.startsWith('package/') || entry.split('/').includes('..') || entry.includes('\\')) throw new Error('Unsafe Codex archive entry');
    }
    const extraction = spawnSync('tar', ['-xzf', tarball, '-C', staging], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`Cannot extract Codex archive: ${extraction.stderr}`);
    const vendorRoot = path.join(staging, 'package', 'vendor');
    const targets = fs.readdirSync(vendorRoot);
    if (targets.length !== 1) throw new Error('Unexpected Codex vendor layout');
    const vendor = path.join(vendorRoot, targets[0]);
    assertRegularTree(vendor);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.cpSync(vendor, runtimeRoot, { recursive: true });
    // Preserve the complete upstream helper/resource layout relative to bin/codex.
    for (const name of ['LICENSE', 'NOTICE', 'README.md']) {
      const source = path.join(staging, 'package', name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(runtimeRoot, name));
    }
    for (const name of ['LICENSE', 'NOTICE']) {
      fs.copyFileSync(path.join(desktopRoot, 'licenses', `codex-${name}`), path.join(runtimeRoot, name));
    }
    const manifest = { version: codexLock.version, platform, arch, source: asset.url, integrity: asset.integrity };
    fs.writeFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await verifyCodexRuntime(runtimeRoot);
    return manifest;
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

function assertRegularTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) assertRegularTree(path.join(root, entry.name));
    else if (!entry.isFile()) throw new Error(`Unexpected Codex archive file type: ${entry.name}`);
  }
}

export async function verifyCodexRuntime(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  const asset = codexLock.platforms[`${process.platform}-${process.arch}`];
  if (manifest.version !== codexLock.version || manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.integrity !== asset?.integrity) throw new Error('Codex runtime manifest does not match the locked target');
  const executable = codexExecutable(root);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-stock-codex-check-'));
  const env = { ...process.env, CODEX_HOME: home, HOME: home, USERPROFILE: home };
  try {
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8', env, cwd: home, timeout: 10000 });
    if (version.status !== 0 || version.stdout.trim() !== `codex-cli ${codexLock.version}`) throw new Error('Bundled Codex version verification failed');
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '', failure, initialized = false;
      const timer = setTimeout(() => { failure = new Error('Codex App Server handshake timed out'); child.kill(); }, 20000);
      child.on('error', (error) => { failure = error; });
      child.stderr.resume();
      child.stdout.on('data', (data) => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let frame; try { frame = JSON.parse(line); } catch { continue; }
          if (frame.id !== 1) continue;
          if (frame.error) failure = new Error('Codex App Server initialization failed');
          else { initialized = true; child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); }
          child.stdin.end(); child.kill();
        }
      });
      child.on('close', () => { clearTimeout(timer); failure || !initialized ? reject(failure || new Error('Codex App Server exited before initialize')) : resolve(); });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'easy_stock_check', version: '1.0' } } }) + '\n');
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  return manifest;
}
