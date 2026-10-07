/**
 * providerDiscovery.test.js — find_providers (bot-capabilities CAP-003):
 * tiers in order (installed → built-in → vetted → community), keyword matching,
 * registry rows de-duplicated to the latest version, install info, outages.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  findProviders,
  keywordsOf,
  normalizeRegistryServers,
} = require("./providerDiscovery");

const CATALOG = [
  {
    id: "web-fetch",
    name: "Web Fetch",
    description: "Download images and web pages from HTTPS sites.",
    tags: ["web", "images", "built-in"],
    mcpConfig: { transport: "in_process", builtin: "web-fetch" },
    credentialSchema: {},
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read and send Slack messages.",
    tags: ["chat"],
    mcpConfig: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "slack-mcp-server"],
    },
    credentialSchema: {
      xoxbToken: { displayName: "Bot Token", secret: true },
    },
  },
];
const VETTED = [
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Browser automation and screenshots of web pages.",
    tags: ["browser", "images"],
    sourceUrl: "https://github.com/modelcontextprotocol/servers",
    mcpConfig: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    },
    credentialSchema: {},
  },
];

function registryRow(name, opts = {}) {
  return {
    server: {
      name,
      description: opts.description || `${name} server for image search`,
      version: opts.version || "1.0.0",
      repository: opts.repo ? { url: opts.repo, source: "github" } : undefined,
      packages: opts.packages,
      remotes: opts.remotes,
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        isLatest: opts.isLatest !== false,
        updatedAt: opts.updatedAt || "2026-09-01T00:00:00Z",
      },
    },
  };
}

function deps(over = {}) {
  return {
    listInstalled: () => [],
    getCatalog: () => CATALOG,
    getKnownExternal: () => VETTED,
    searchRegistry: async () => ({ servers: [] }),
    ...over,
  };
}

describe("keywordsOf", () => {
  it("keeps meaningful words and drops filler", () => {
    assert.deepEqual(keywordsOf("Download an image from a URL"), [
      "download",
      "image",
      "url",
    ]);
  });
});

describe("findProviders", () => {
  it("returns tiers in order with stable ids", async () => {
    const r = await findProviders(
      "download images from web pages",
      deps({
        searchRegistry: async () => ({
          servers: [
            registryRow("io.github.acme/images", {
              packages: [
                { registryType: "npm", identifier: "@acme/images-mcp" },
              ],
            }),
          ],
        }),
      }),
    );
    assert.deepEqual(
      r.results.map((e) => [e.tier, e.id]),
      [
        ["built-in", "builtin:web-fetch"],
        ["vetted", "vetted:puppeteer"],
        ["community", "community:io.github.acme/images"],
      ],
    );
    assert.equal(r.results[0].runs, "Built into Dash");
    assert.equal(
      r.results[1].sourceUrl,
      "https://github.com/modelcontextprotocol/servers",
    );
  });

  it("an installed provider comes first and hides its catalog entry", async () => {
    const r = await findProviders(
      "fetch images",
      deps({
        listInstalled: () => [
          {
            name: "Web Fetch — CDN",
            type: "web-fetch",
            tools: ["fetch_image", "fetch_url"],
          },
        ],
      }),
    );
    assert.equal(r.results[0].id, "installed:Web Fetch — CDN");
    assert.equal(r.results[0].tier, "installed");
    assert.equal(
      r.results.some((e) => e.id === "builtin:web-fetch"),
      false,
    );
  });

  it("lists the credentials an entry needs", async () => {
    const r = await findProviders("send slack messages", deps());
    const slack = r.results.find((e) => e.id === "builtin:slack");
    assert.deepEqual(slack.credentials, ["Bot Token"]);
    assert.equal(slack.runs, "npx -y slack-mcp-server");
  });

  it("extra words in a longer request don't hide a good match", async () => {
    const r = await findProviders(
      "Download an image from a URL to a local file",
      deps(),
    );
    assert.ok(r.results.some((e) => e.id === "builtin:web-fetch"));
  });

  it("common words alone don't match (send SMS isn't Slack)", async () => {
    const r = await findProviders("send SMS text messages", deps());
    assert.equal(
      r.results.some((e) => e.id === "builtin:slack"),
      false,
    );
  });

  it("an installed provider matching only a common word isn't suggested", async () => {
    const r = await findProviders(
      "search stock photos",
      deps({
        listInstalled: () => [
          { name: "Algolia", type: "algolia", tools: ["search"] },
        ],
      }),
    );
    assert.equal(
      r.results.some((e) => e.tier === "installed"),
      false,
    );
  });

  it("searches the registry with the specific words only", async () => {
    const asked = [];
    await findProviders(
      "search stock photos",
      deps({
        searchRegistry: async (q) => {
          asked.push(q);
          return { servers: [] };
        },
      }),
    );
    assert.deepEqual(asked, ["stock", "photos"]);
  });

  it("keeps the community results from searches that worked", async () => {
    const r = await findProviders(
      "stock photos",
      deps({
        searchRegistry: async (q) => {
          if (q === "stock") throw new Error("timeout");
          return {
            servers: [
              registryRow("io.x/photos", {
                description: "Free photos",
                packages: [{ registryType: "npm", identifier: "x-photos" }],
              }),
            ],
          };
        },
      }),
    );
    assert.ok(r.results.some((e) => e.id === "community:io.x/photos"));
    assert.match(r.notes.join(" "), /incomplete/);
  });

  it("still answers from the local tiers when the registry is down", async () => {
    const r = await findProviders(
      "web pages",
      deps({
        searchRegistry: async () => {
          throw new Error("ECONNRESET");
        },
      }),
    );
    assert.ok(r.results.some((e) => e.id === "builtin:web-fetch"));
    assert.match(r.notes.join(" "), /community search .*unavailable/i);
  });

  it("says so when nothing matches", async () => {
    const r = await findProviders("quantum teleportation", deps());
    assert.deepEqual(r.results, []);
  });

  it("needs a capability", async () => {
    await assert.rejects(findProviders("  ", deps()), /capability/);
  });
});

describe("normalizeRegistryServers", () => {
  it("keeps one row per server, preferring the latest version", () => {
    const out = normalizeRegistryServers(
      {
        servers: [
          registryRow("io.x/a", {
            version: "1.0.0",
            isLatest: false,
            updatedAt: "2026-01-01T00:00:00Z",
          }),
          registryRow("io.x/a", {
            version: "2.0.0",
            isLatest: true,
            updatedAt: "2026-02-01T00:00:00Z",
          }),
        ],
      },
      ["image"],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].version, "2.0.0");
  });

  it("turns npm and PyPI packages into commands, with their env vars", () => {
    const [npm, pypi] = normalizeRegistryServers(
      {
        servers: [
          registryRow("io.x/npm", {
            packages: [
              {
                registryType: "npm",
                identifier: "@x/mcp",
                environmentVariables: [
                  {
                    name: "X_API_KEY",
                    description: "API key",
                    isRequired: true,
                    isSecret: true,
                  },
                ],
              },
            ],
          }),
          registryRow("io.x/py", {
            packages: [{ registryType: "pypi", identifier: "x-mcp" }],
          }),
        ],
      },
      ["image"],
    );
    assert.deepEqual(npm.install.mcpConfig, {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@x/mcp"],
      envMapping: { X_API_KEY: "X_API_KEY" },
    });
    assert.equal(npm.runs, "npx -y @x/mcp");
    assert.deepEqual(npm.credentials, ["X_API_KEY"]);
    assert.equal(npm.install.credentialSchema.X_API_KEY.secret, true);
    assert.equal(pypi.runs, "uvx x-mcp");
  });

  it("turns a streamable-http remote into an HTTP config", () => {
    const [remote] = normalizeRegistryServers(
      {
        servers: [
          registryRow("io.x/remote", {
            remotes: [
              { type: "streamable-http", url: "https://mcp.x.test/mcp" },
            ],
          }),
        ],
      },
      ["image"],
    );
    assert.deepEqual(remote.install.mcpConfig, {
      transport: "streamable_http",
      url: "https://mcp.x.test/mcp",
    });
    assert.equal(remote.runs, "https://mcp.x.test/mcp");
  });

  it("marks entries Dash can't install", () => {
    const [none] = normalizeRegistryServers(
      {
        servers: [
          registryRow("io.x/docker", {
            packages: [{ registryType: "oci", identifier: "x/mcp" }],
          }),
        ],
      },
      ["image"],
    );
    assert.equal(none.installable, false);
    assert.match(none.runs, /no install info/i);
  });
});
