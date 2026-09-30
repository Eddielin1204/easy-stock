import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCodexRuntime, verifyCodexRuntime } from './codex-runtime.mjs';
const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources/codex-runtime');
try { await verifyCodexRuntime(runtimeRoot); }
catch { await prepareCodexRuntime({ runtimeRoot }); }
console.log('Codex runtime ready');
