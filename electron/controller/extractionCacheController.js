/**
 * extractionCacheController.js
 *
 * LRU cache with TTL for theme-from-URL extraction results.
 * Caches palette results keyed by URL to avoid re-scanning recently visited sites.
 *
 * - Default TTL: 24 hours
 * - Max entries: 50 (LRU eviction)
 * - In-memory only — cleared on app restart
 * - Supports force refresh to bypass cache
 */

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 50;

// Map preserves insertion order — we use this for LRU tracking
const cache = new Map(); // url → { data, timestamp, ttl }

/**
 * Get a cached result for the given URL, or run the fetcher and cache the result.
 * @param {string} url - The URL key
 * @param {Function} fetcher - Async function that produces the extraction result
 * @param {Object} [options]
 * @param {number} [options.ttl=86400000] - Time-to-live in milliseconds
 * @param {boolean} [options.forceRefresh=false] - Bypass cache and re-extract
 * @returns {Promise<any>} The extraction result
 */
async function get(url, fetcher, options = {}) {
  const { ttl = DEFAULT_TTL, forceRefresh = false } = options;
  const key = url.toLowerCase().replace(/\/+$/, ""); // normalize

  if (!forceRefresh && cache.has(key)) {
    const entry = cache.get(key);
    if (Date.now() - entry.timestamp < entry.ttl) {
      // Move to end (most recently used)
      cache.delete(key);
      cache.set(key, entry);
      console.log(`[extractionCache] HIT ${key}`);
      return entry.data;
    }
    // Expired
    cache.delete(key);
  }

  console.log(`[extractionCache] ${forceRefresh ? "REFRESH" : "MISS"} ${key}`);
  const data = await fetcher();

  // Store result
  cache.set(key, { data, timestamp: Date.now(), ttl });

  // LRU eviction — remove oldest entries if over limit
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    console.log(`[extractionCache] EVICT ${oldestKey}`);
  }

  return data;
}

/**
 * Check if a URL has a valid (non-expired) cache entry.
 * @param {string} url
 * @returns {boolean}
 */
function has(url) {
  const key = url.toLowerCase().replace(/\/+$/, "");
  if (!cache.has(key)) return false;
  const entry = cache.get(key);
  if (Date.now() - entry.timestamp >= entry.ttl) {
    cache.delete(key);
    return false;
  }
  return true;
}

/** Clear all cached entries. */
function clear() {
  cache.clear();
  console.log("[extractionCache] CLEARED");
}

/**
 * Remove a single URL from the cache.
 * @param {string} url
 */
function invalidate(url) {
  const key = url.toLowerCase().replace(/\/+$/, "");
  cache.delete(key);
}

/** Get cache statistics. */
function stats() {
  return {
    entries: cache.size,
    maxEntries: MAX_ENTRIES,
    keys: [...cache.keys()],
  };
}

const extractionCacheController = { get, has, clear, invalidate, stats };

module.exports = extractionCacheController;
