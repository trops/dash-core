/**
 * safeFetch.test.js — the Web Fetch download rules (CAP-002 AC4/AC5/AC8):
 * HTTPS only, allowed sites, internal addresses refused (including after DNS),
 * redirects re-checked, size cap while streaming, timeout.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { safeFetch, guardedLookup, hostAllowed } = require("./safeFetch");

// A fake `open` serving canned responses keyed by URL.
function fakeOpen(routes) {
  const opened = [];
  const open = async (url) => {
    opened.push(url.href);
    const r = routes[url.href];
    if (!r) throw new Error(`no route for ${url.href}`);
    if (r.hang) return new Promise(() => {});
    const chunks =
      r.chunks || (r.body !== undefined ? [Buffer.from(r.body)] : []);
    let destroyed = false;
    return {
      statusCode: r.status || 200,
      headers: r.headers || {},
      destroy() {
        destroyed = true;
      },
      get destroyed() {
        return destroyed;
      },
      body: (async function* () {
        for (const c of chunks) yield c;
      })(),
    };
  };
  return { open, opened };
}

const OPTS = { maxBytes: 1024, timeoutMs: 2000, allowedSites: [] };

describe("safeFetch", () => {
  it("returns the body, final URL and content type", async () => {
    const { open } = fakeOpen({
      "https://cdn.test/a.png": {
        body: "IMG",
        headers: { "content-type": "image/png" },
      },
    });
    const r = await safeFetch("https://cdn.test/a.png", OPTS, { open });
    assert.equal(r.finalUrl, "https://cdn.test/a.png");
    assert.equal(r.contentType, "image/png");
    assert.equal(r.buffer.toString(), "IMG");
  });

  it("refuses http:// and other schemes", async () => {
    const { open, opened } = fakeOpen({});
    await assert.rejects(
      safeFetch("http://cdn.test/a.png", OPTS, { open }),
      /Only HTTPS/,
    );
    await assert.rejects(
      safeFetch("file:///etc/passwd", OPTS, { open }),
      /Only HTTPS/,
    );
    assert.equal(opened.length, 0);
  });

  it("refuses an internal IP literal without connecting", async () => {
    const { open, opened } = fakeOpen({});
    await assert.rejects(
      safeFetch("https://127.0.0.1/admin", OPTS, { open }),
      /private network address/,
    );
    await assert.rejects(
      safeFetch("https://[::1]/x", OPTS, { open }),
      /private network address/,
    );
    assert.equal(opened.length, 0);
  });

  it("refuses a site outside the allowed list and names it", async () => {
    const { open } = fakeOpen({});
    await assert.rejects(
      safeFetch(
        "https://evil.test/x",
        { ...OPTS, allowedSites: ["*.cdn.test"] },
        { open },
      ),
      /allowed sites: evil\.test/,
    );
  });

  it("follows a relative redirect and re-checks the target", async () => {
    const { open, opened } = fakeOpen({
      "https://a.test/start": {
        status: 302,
        headers: { location: "/final" },
      },
      "https://a.test/final": { body: "ok" },
    });
    const r = await safeFetch("https://a.test/start", OPTS, { open });
    assert.equal(r.finalUrl, "https://a.test/final");
    assert.deepEqual(opened, ["https://a.test/start", "https://a.test/final"]);
  });

  it("refuses a redirect to http or to a site outside the list", async () => {
    const { open } = fakeOpen({
      "https://a.test/down": {
        status: 301,
        headers: { location: "http://a.test/plain" },
      },
      "https://a.test/away": {
        status: 302,
        headers: { location: "https://other.test/x" },
      },
    });
    await assert.rejects(
      safeFetch("https://a.test/down", OPTS, { open }),
      /Only HTTPS/,
    );
    await assert.rejects(
      safeFetch(
        "https://a.test/away",
        { ...OPTS, allowedSites: ["a.test"] },
        { open },
      ),
      /allowed sites: other\.test/,
    );
  });

  it("stops after 5 redirects", async () => {
    const routes = {};
    for (let i = 0; i < 7; i++) {
      routes[`https://a.test/${i}`] = {
        status: 302,
        headers: { location: `https://a.test/${i + 1}` },
      };
    }
    const { open } = fakeOpen(routes);
    await assert.rejects(
      safeFetch("https://a.test/0", OPTS, { open }),
      /Too many redirects/,
    );
  });

  it("refuses a declared size over the limit before reading", async () => {
    const { open } = fakeOpen({
      "https://a.test/big": {
        headers: { "content-length": "5000" },
        body: "x",
      },
    });
    await assert.rejects(
      safeFetch("https://a.test/big", OPTS, { open }),
      /Too large/,
    );
  });

  it("stops reading once the body passes the limit", async () => {
    const { open } = fakeOpen({
      "https://a.test/stream": {
        chunks: [Buffer.alloc(600), Buffer.alloc(600), Buffer.alloc(600)],
      },
    });
    await assert.rejects(
      safeFetch("https://a.test/stream", OPTS, { open }),
      /Too large/,
    );
  });

  it("reports an HTTP error status", async () => {
    const { open } = fakeOpen({ "https://a.test/missing": { status: 404 } });
    await assert.rejects(
      safeFetch("https://a.test/missing", OPTS, { open }),
      /HTTP 404/,
    );
  });

  it("times out", async () => {
    const { open } = fakeOpen({ "https://a.test/slow": { hang: true } });
    await assert.rejects(
      safeFetch("https://a.test/slow", { ...OPTS, timeoutMs: 50 }, { open }),
      /Timed out/,
    );
  });
});

describe("guardedLookup", () => {
  const lookupWith =
    (address, family = 4) =>
    (host, opts, cb) =>
      opts && opts.all
        ? cb(
            null,
            [].concat(address).map((a) => ({ address: a, family })),
          )
        : cb(null, [].concat(address)[0], family);

  it("passes a public address through", (t, done) => {
    guardedLookup(lookupWith("93.184.216.34"))("a.test", {}, (err, addr) => {
      assert.equal(err, null);
      assert.equal(addr, "93.184.216.34");
      done();
    });
  });

  it("refuses a hostname that resolves to a private address", (t, done) => {
    guardedLookup(lookupWith("10.0.0.7"))("intranet.test", {}, (err) => {
      assert.match(err.message, /private network address/);
      done();
    });
  });

  it("refuses when any of several addresses is private (all: true)", (t, done) => {
    guardedLookup(lookupWith(["93.184.216.34", "127.0.0.1"]))(
      "mixed.test",
      { all: true },
      (err) => {
        assert.match(err.message, /private network address/);
        done();
      },
    );
  });
});

describe("hostAllowed", () => {
  it("empty list allows any host", () => {
    assert.equal(hostAllowed("x.test", []), true);
  });
  it("exact names and *.subdomain patterns", () => {
    const list = ["cdn.test", "*.images.test"];
    assert.equal(hostAllowed("cdn.test", list), true);
    assert.equal(hostAllowed("a.images.test", list), true);
    assert.equal(hostAllowed("images.test", list), false);
    assert.equal(hostAllowed("evilcdn.test", list), false);
  });
  it("tolerates pasted URLs and case", () => {
    assert.equal(hostAllowed("CDN.test", ["https://cdn.test/path"]), true);
  });
});
