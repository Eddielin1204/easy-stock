const DEFAULT_UPDATE_FEED = Object.freeze({ provider: 'github', owner: 'jundizhou', repo: 'easy-stock' });

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function resolveUpdateFeed(configuredURL = process.env.A_STOCK_UPDATE_FEED_URL) {
  const value = String(configuredURL || '').trim().replace(/\/+$/, '');
  if (!value) return { ...DEFAULT_UPDATE_FEED };
  const parsed = new URL(value);
  const isLoopback = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('Desktop update feed must use HTTPS');
  }
  return { provider: 'generic', url: parsed.toString().replace(/\/$/, '') };
}

module.exports = { DEFAULT_UPDATE_FEED, resolveUpdateFeed };
