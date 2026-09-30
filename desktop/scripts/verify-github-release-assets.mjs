import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const assetRoot = path.resolve(process.argv[2] || '');
const { assets } = JSON.parse(fs.readFileSync(0, 'utf8'));
const names = fs.readdirSync(assetRoot).filter((name) => fs.statSync(path.join(assetRoot, name)).isFile());
if (!names.length || !Array.isArray(assets) || assets.length !== names.length) {
  throw new Error('GitHub Release asset count does not match the local build');
}
for (const name of names) {
  const bytes = fs.readFileSync(path.join(assetRoot, name));
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const remote = assets.find((asset) => asset.name === name);
  if (!remote || remote.state !== 'uploaded' || remote.size !== bytes.length || remote.digest !== digest) {
    throw new Error(`GitHub Release asset failed size/SHA-256 verification: ${name}`);
  }
}
console.log(`Verified ${names.length} GitHub Release assets against the local build`);
