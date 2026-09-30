import fs from 'node:fs';
import path from 'node:path';

export function dmgSizeMiB(appPath) {
  let bytes = 0;
  function walk(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      bytes += 16384; // Allow space for filesystem entries and extended attributes.
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) bytes += fs.statSync(file).size;
    }
  }
  walk(appPath);
  return Math.max(1200, Math.ceil(bytes / 1024 / 1024 * 1.2) + 128);
}
