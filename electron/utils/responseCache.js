/**
 * responseCache.js
 *
 * TTL-based API response cache with in-flight deduplication.
 * Renderer-driven: widget developer includes { cache: true } or { cache: { ttl: N } }
 * in IPC messages to opt-in to caching per call.
 *
 * Usage:
 *   // Wrap a handler:
 *   ipcMain.handle("my-channel", responseCache.cachedHandler("my-channel", handler));
 *
 *   // Widget-side (renderer):
 *   window.mainApi.myService.getData({ ...pc, cache: true });              // 30s default
 *   window.mainApi.myService.getData({ ...pc, cache: 60000 });             // 60s
 *   window.mainApi.myService.getData({ ...pc, cache: { ttl: 120000 } });   // 120s
 *   window.mainApi.myService.getData({ ...pc, cache: true, forceRefresh: true }); // bypass
 */

const cache = new Map(); // key → { data, timestamp, ttl }
const inflight = new Map(); // key → Promise

function stableHash(obj) {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

const responseCache = {
  async get(key, fetcher, options = {}) {
    const { ttl = 30000, forceRefresh = false } = options;

    if (!forceRefresh && cache.has(key)) {
      const entry = cache.get(key);
      if (Date.now() - entry.timestamp < entry.ttl) {
        console.log(`[responseCache] HIT ${key}`);
        return entry.data;
      }
      cache.delete(key);
    }

    if (!forceRefresh && inflight.has(key)) {
      console.log(`[responseCache] DEDUP ${key}`);
      return inflight.get(key);
    }

    console.log(`[responseCache] MISS ${key}`);
    const promise = fetcher();
    inflight.set(key, promise);
    try {
      const data = await promise;
      if (data && !data.error) {
        cache.set(key, { data, timestamp: Date.now(), ttl });
      }
      return data;
    } finally {
      inflight.delete(key);
    }
  },

  /**
   * Wrap an ipcMain.handle handler with renderer-driven caching.
   * If the incoming message has a `cache` property, the response is cached.
   * If the message has `forceRefresh: true`, the cache is bypassed.
   *
   * The `cache` and `forceRefresh` properties are stripped from the message
   * before passing to the handler, so handlers receive clean params.
   *
   * Cache parameter forms:
   *   cache: true         → 30s default TTL
   *   cache: 60000        → 60s (number shorthand)
   *   cache: { ttl: N }   → explicit TTL in ms
   */
  cachedHandler(channelName, handler) {
    return async (e, msg) => {
      const { cache: cacheOpt, forceRefresh, ...params } = msg || {};
      if (cacheOpt) {
        const ttl =
          typeof cacheOpt === "number" ? cacheOpt : cacheOpt?.ttl || 30000;
        const key = `${channelName}:${stableHash(params)}`;
        return this.get(key, () => handler(e, params), {
          ttl,
          forceRefresh,
        });
      }
      return handler(e, msg);
    };
  },

  invalidate(key) {
    cache.delete(key);
  },

  invalidatePrefix(prefix) {
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  },

  clear() {
    cache.clear();
    inflight.clear();
  },

  stats() {
    return {
      entries: cache.size,
      inflight: inflight.size,
      keys: [...cache.keys()],
    };
  },
};

module.exports = responseCache;
