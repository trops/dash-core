/**
 * webFetch.test.js — the built-in Web Fetch provider (bot-capabilities
 * CAP-002): settings, fetch_image and fetch_url, driven through a real MCP
 * client over an in-memory link (the same path mcpController uses).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const {
  readSettings,
  createWebFetchServer,
  MODEL_IMAGE_MAX_BYTES,
} = require("./webFetch");
const { WebFetchError } = require("./safeFetch");

function pngBytes(w = 4, h = 3, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

async function connect(credentials, deps) {
  const server = createWebFetchServer(credentials, {
    serverName: "Web Fetch",
    ...deps,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

// A fake safeFetch serving canned responses by URL.
function fetchFrom(routes, seen = []) {
  return async (url, opts) => {
    seen.push({ url, opts });
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (!r) throw new WebFetchError(`HTTP 404 from ${new URL(url).host}`);
    return {
      finalUrl: url,
      contentType: r.contentType || "",
      buffer: Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body || ""),
    };
  };
}

describe("readSettings", () => {
  it("uses the defaults when nothing is set", () => {
    assert.deepEqual(readSettings({}), {
      maxBytes: 10 * 1024 * 1024,
      maxDownloadMb: 10,
      timeoutMs: 20000,
      maxImages: 5,
      allowedSites: [],
      shrinkLargeImages: true,
    });
  });

  it("parses saved strings and clamps to the fixed ranges", () => {
    const s = readSettings({
      maxDownloadMb: "500",
      timeoutSeconds: "1",
      maxImages: "8",
      allowedSites: " cdn.test, *.img.test ,,",
      shrinkLargeImages: "false",
    });
    assert.equal(s.maxDownloadMb, 50);
    assert.equal(s.maxBytes, 50 * 1024 * 1024);
    assert.equal(s.timeoutMs, 5000);
    assert.equal(s.maxImages, 8);
    assert.deepEqual(s.allowedSites, ["cdn.test", "*.img.test"]);
    assert.equal(s.shrinkLargeImages, false);
  });

  it("falls back to the default for junk values", () => {
    const s = readSettings({ maxDownloadMb: "lots", maxImages: "" });
    assert.equal(s.maxDownloadMb, 10);
    assert.equal(s.maxImages, 5);
  });
});

describe("Web Fetch tools", () => {
  it("lists fetch_image and fetch_url", async () => {
    const client = await connect({}, { fetch: fetchFrom({}) });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "fetch_image",
      "fetch_url",
    ]);
  });

  it("fetch_image returns the image plus a summary line", async () => {
    const seen = [];
    const client = await connect(
      { maxDownloadMb: "2", allowedSites: "cdn.test" },
      {
        fetch: fetchFrom(
          {
            "https://cdn.test/shoe.png": {
              contentType: "application/octet-stream",
              body: pngBytes(640, 480),
            },
          },
          seen,
        ),
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { url: "https://cdn.test/shoe.png" },
    });
    assert.equal(r.isError, undefined);
    assert.equal(r.content[0].type, "text");
    assert.match(r.content[0].text, /https:\/\/cdn\.test\/shoe\.png/);
    assert.match(r.content[0].text, /image\/png, 640×480/);
    assert.equal(r.content[1].type, "image");
    assert.equal(r.content[1].mimeType, "image/png");
    // The provider's settings reach the download.
    assert.equal(seen[0].opts.maxBytes, 2 * 1024 * 1024);
    assert.deepEqual(seen[0].opts.allowedSites, ["cdn.test"]);
  });

  it("fetch_image refuses something that isn't an image, whatever the header says", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/x.png": {
            contentType: "image/png",
            body: "<!doctype html><html></html>",
          },
        }),
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { url: "https://a.test/x.png" },
    });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Not an image/);
  });

  it("names the setting when a download is too large", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/big.png": new WebFetchError(
            "Too large: 14 MB; limit 10 MB",
            "TOO_LARGE",
          ),
        }),
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { url: "https://a.test/big.png" },
    });
    assert.equal(r.isError, true);
    assert.match(
      r.content[0].text,
      /Too large: 14 MB; this provider's limit is 10 MB/,
    );
    assert.match(r.content[0].text, /Settings › Providers › Web Fetch/);
  });

  it("shrinks an image over the model's limit when the setting is on", async () => {
    const big = pngBytes(9000, 9000, MODEL_IMAGE_MAX_BYTES);
    let shrunk = 0;
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/huge.png": { contentType: "image/png", body: big },
        }),
        shrink: (buffer, mimeType) => {
          shrunk++;
          return {
            buffer: pngBytes(1568, 1568),
            mimeType,
            width: 1568,
            height: 1568,
          };
        },
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { url: "https://a.test/huge.png" },
    });
    assert.equal(shrunk, 1);
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /shrunk from 9000×9000/);
    assert.equal(r.content[1].type, "image");
  });

  it("refuses an image over the model's limit when shrinking is off", async () => {
    const big = pngBytes(100, 100, MODEL_IMAGE_MAX_BYTES);
    const client = await connect(
      { shrinkLargeImages: false },
      {
        fetch: fetchFrom({
          "https://a.test/huge.png": { contentType: "image/png", body: big },
        }),
        shrink: () => {
          throw new Error("should not shrink");
        },
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { url: "https://a.test/huge.png" },
    });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /too large for the model/i);
    assert.match(r.content[0].text, /Shrink large images/);
  });

  it("fetch_image with several urls stops at the max images setting", async () => {
    const routes = {};
    const urls = [];
    for (let i = 0; i < 4; i++) {
      const u = `https://a.test/${i}.png`;
      urls.push(u);
      routes[u] = { contentType: "image/png", body: pngBytes() };
    }
    const seen = [];
    const client = await connect(
      { maxImages: "2" },
      { fetch: fetchFrom(routes, seen) },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { urls },
    });
    assert.equal(seen.length, 2);
    assert.equal(r.content.filter((c) => c.type === "image").length, 2);
    assert.match(r.content[0].text, /2 more URLs skipped/);
  });

  it("fetch_image with several urls reports failures but keeps the successes", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/ok.png": {
            contentType: "image/png",
            body: pngBytes(),
          },
        }),
      },
    );
    const r = await client.callTool({
      name: "fetch_image",
      arguments: { urls: ["https://a.test/ok.png", "https://a.test/gone.png"] },
    });
    assert.equal(r.isError, undefined);
    assert.equal(r.content.filter((c) => c.type === "image").length, 1);
    assert.match(r.content[0].text, /gone\.png: HTTP 404/);
  });

  it("fetch_image needs a url", async () => {
    const client = await connect({}, { fetch: fetchFrom({}) });
    const r = await client.callTool({ name: "fetch_image", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /url/);
  });

  it("fetch_url returns readable text for HTML", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/page": {
            contentType: "text/html; charset=utf-8",
            body: "<html><body><h1>Hello</h1><p>World</p></body></html>",
          },
        }),
      },
    );
    const r = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://a.test/page" },
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /^URL: https:\/\/a\.test\/page/);
    assert.match(r.content[0].text, /# Hello\n\nWorld/);
  });

  it("fetch_url passes JSON and plain text through", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/data": {
            contentType: "application/json",
            body: '{"a":1}',
          },
        }),
      },
    );
    const r = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://a.test/data" },
    });
    assert.match(r.content[0].text, /\{"a":1\}/);
  });

  it("fetch_url points images to fetch_image and refuses other binaries", async () => {
    const client = await connect(
      {},
      {
        fetch: fetchFrom({
          "https://a.test/p.png": {
            contentType: "image/png",
            body: pngBytes(),
          },
          "https://a.test/f.pdf": {
            contentType: "application/pdf",
            body: "%PDF-1.7",
          },
        }),
      },
    );
    const img = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://a.test/p.png" },
    });
    assert.equal(img.isError, true);
    assert.match(img.content[0].text, /fetch_image/);
    const pdf = await client.callTool({
      name: "fetch_url",
      arguments: { url: "https://a.test/f.pdf" },
    });
    assert.equal(pdf.isError, true);
    assert.match(pdf.content[0].text, /application\/pdf/);
  });
});
