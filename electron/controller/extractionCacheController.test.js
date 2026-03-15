const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const extractionCacheController = require("./extractionCacheController");

describe("extractionCacheController", () => {
  beforeEach(() => {
    extractionCacheController.clear();
  });

  describe("get — cache miss", () => {
    it("calls fetcher on first access", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: ["#ff0000"] };
      };
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
      );
      assert.equal(called, 1);
      assert.deepEqual(result, { palette: ["#ff0000"] });
    });
  });

  describe("get — cache hit", () => {
    it("returns cached result without calling fetcher again", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: ["#ff0000"] };
      };
      await extractionCacheController.get("https://example.com", fetcher);
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
      );
      assert.equal(called, 1);
      assert.deepEqual(result, { palette: ["#ff0000"] });
    });
  });

  describe("URL normalization", () => {
    it("treats trailing slash and case as equivalent", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: ["#00ff00"] };
      };
      await extractionCacheController.get("https://Example.com/", fetcher);
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
      );
      assert.equal(called, 1);
      assert.deepEqual(result, { palette: ["#00ff00"] });
    });
  });

  describe("TTL expiration", () => {
    it("re-fetches after TTL expires", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: [`#${called}`] };
      };
      // Use a very short TTL (1ms)
      await extractionCacheController.get("https://example.com", fetcher, {
        ttl: 1,
      });
      // Wait for expiration
      await new Promise((r) => setTimeout(r, 5));
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
        { ttl: 1 },
      );
      assert.equal(called, 2);
    });
  });

  describe("forceRefresh", () => {
    it("bypasses cache when forceRefresh is true", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: [`#${called}`] };
      };
      await extractionCacheController.get("https://example.com", fetcher);
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
        { forceRefresh: true },
      );
      assert.equal(called, 2);
      assert.deepEqual(result, { palette: ["#2"] });
    });

    it("updates cache entry after force refresh", async () => {
      let called = 0;
      const fetcher = async () => {
        called++;
        return { palette: [`#${called}`] };
      };
      await extractionCacheController.get("https://example.com", fetcher);
      await extractionCacheController.get("https://example.com", fetcher, {
        forceRefresh: true,
      });
      // Third call should hit cache with the refreshed value
      const result = await extractionCacheController.get(
        "https://example.com",
        fetcher,
      );
      assert.equal(called, 2); // not called a third time
      assert.deepEqual(result, { palette: ["#2"] });
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entries when exceeding max size", async () => {
      const fetcher = (i) => async () => ({ palette: [`#${i}`] });
      // Fill cache to max (50) + 5 more
      for (let i = 0; i < 55; i++) {
        await extractionCacheController.get(
          `https://site-${i}.com`,
          fetcher(i),
        );
      }
      const s = extractionCacheController.stats();
      assert.equal(s.entries, 50);
      // First 5 entries should have been evicted
      assert.equal(extractionCacheController.has("https://site-0.com"), false);
      assert.equal(extractionCacheController.has("https://site-4.com"), false);
      // Entry 5 should still be present
      assert.equal(extractionCacheController.has("https://site-5.com"), true);
      // Latest entry should be present
      assert.equal(extractionCacheController.has("https://site-54.com"), true);
    });
  });

  describe("has", () => {
    it("returns false for uncached URL", () => {
      assert.equal(
        extractionCacheController.has("https://uncached.com"),
        false,
      );
    });

    it("returns true for cached URL", async () => {
      await extractionCacheController.get("https://cached.com", async () => ({
        palette: [],
      }));
      assert.equal(extractionCacheController.has("https://cached.com"), true);
    });

    it("returns false for expired URL", async () => {
      await extractionCacheController.get(
        "https://expired.com",
        async () => ({ palette: [] }),
        { ttl: 1 },
      );
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(extractionCacheController.has("https://expired.com"), false);
    });
  });

  describe("invalidate", () => {
    it("removes a specific URL from cache", async () => {
      await extractionCacheController.get("https://example.com", async () => ({
        palette: [],
      }));
      assert.equal(extractionCacheController.has("https://example.com"), true);
      extractionCacheController.invalidate("https://example.com");
      assert.equal(extractionCacheController.has("https://example.com"), false);
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      await extractionCacheController.get("https://a.com", async () => ({
        palette: [],
      }));
      await extractionCacheController.get("https://b.com", async () => ({
        palette: [],
      }));
      assert.equal(extractionCacheController.stats().entries, 2);
      extractionCacheController.clear();
      assert.equal(extractionCacheController.stats().entries, 0);
    });
  });

  describe("stats", () => {
    it("reports correct entry count and keys", async () => {
      await extractionCacheController.get("https://one.com", async () => ({
        palette: [],
      }));
      await extractionCacheController.get("https://two.com", async () => ({
        palette: [],
      }));
      const s = extractionCacheController.stats();
      assert.equal(s.entries, 2);
      assert.equal(s.maxEntries, 50);
      assert.ok(s.keys.includes("https://one.com"));
      assert.ok(s.keys.includes("https://two.com"));
    });
  });
});
