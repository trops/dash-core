/**
 * profileSetup.test.js — the v3 profile: packing the setup, reading a
 * profile (it may be crafted), what a bot carries, and what counts as the
 * same record.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");

const {
  packSetup,
  unpackSetup,
  setupHash,
  portableSetupBot,
  buildManifestV3,
  parseProfileV3,
  jsonSchemaVersion,
} = require("./profileSetup");

const setup = () => ({
  dashboards: [
    {
      id: 1,
      name: "Home",
      menuId: 2,
      layout: [{ id: 1, component: "Lights" }],
    },
  ],
  themes: { Ocean: { name: "Ocean", primary: "blue" } },
  folders: [{ id: 2, name: "House", icon: "home" }],
  bots: [
    {
      id: "b1",
      name: "Brief",
      instructions: "summarize",
      mcpServers: ["Slack"],
      session: { engine: "cli", state: "secret-ish" },
      allowedTools: ["slack.post"],
      approvalPolicy: "never",
      ref: "local/brief",
    },
  ],
});

const profile = { id: "mac-mini", name: "Mac Mini" };
const raw = (extra = {}) => ({
  ...buildManifestV3({
    profile,
    owner: "trops",
    widgets: { "@trops/home": "1.2.0" },
    ...setup(),
    providers: [{ name: "Slack", type: "slack" }],
    appSettings: { theme: "Ocean" },
    secretsToEnter: [
      { dashboardId: 1, dashboard: "Home", item: "layout/1", field: "apiKey" },
    ],
    revision: 4,
    createdOn: "laptop",
  }),
  ...extra,
});
const bytes = (m) => Buffer.from(JSON.stringify(m));

describe("the setup", () => {
  it("packs and unpacks", () => {
    const packed = packSetup(setup());
    assert.equal(typeof packed, "string");
    assert.deepEqual(unpackSetup(packed), setup());
  });

  it("refuses a damaged setup, or one that unpacks to too much", () => {
    assert.throws(() => unpackSetup(""), /missing/);
    assert.throws(() => unpackSetup("not-gzip"), /damaged/);
    const bomb = zlib
      .gzipSync(Buffer.alloc(21 * 1024 * 1024, 32))
      .toString("base64");
    assert.throws(() => unpackSetup(bomb), /too big/);
  });

  it("a bot carries what it does, never this computer's approvals or conversation", () => {
    const b = portableSetupBot(setup().bots[0]);
    assert.equal(b.instructions, "summarize");
    assert.deepEqual(b.mcpServers, ["Slack"]);
    for (const f of ["session", "allowedTools", "approvalPolicy", "ref"]) {
      assert.equal(f in b, false, f);
    }
  });

  it("the same record, whatever changes by itself", () => {
    const ws = setup().dashboards[0];
    assert.equal(
      setupHash("dashboards", ws),
      setupHash("dashboards", { ...ws, lastOpened: 5, updatedAt: "x" }),
    );
    assert.notEqual(
      setupHash("dashboards", ws),
      setupHash("dashboards", { ...ws, name: "Den" }),
    );
    const bot = setup().bots[0];
    assert.equal(
      setupHash("bots", bot),
      setupHash("bots", { ...bot, updatedAt: "y", session: null }),
    );
    assert.equal(
      setupHash("folders", { id: 2, name: "House" }),
      setupHash("folders", { id: 9, name: "House", extra: 1 }),
    );
  });
});

describe("reading a v3 profile", () => {
  it("reads one, with its setup unpacked and checked", () => {
    const { manifest, error } = parseProfileV3(bytes(raw()));
    assert.equal(error, undefined);
    assert.equal(manifest.name, "Mac Mini");
    assert.deepEqual({ ...manifest.widgets }, { "@trops/home": "1.2.0" });
    assert.equal(manifest.setup.dashboards[0].name, "Home");
    assert.equal(manifest.setup.bots[0].allowedTools, undefined);
    assert.equal(manifest.secretsToEnter[0].dashboardId, "1");
    assert.deepEqual(manifest.settings.app, { theme: "Ocean" });
    // An object works too (an account copy).
    assert.equal(parseProfileV3(raw()).manifest.name, "Mac Mini");
  });

  it("refuses anything else, or anything malformed", () => {
    assert.match(parseProfileV3(Buffer.from("nope")).error, /isn't a Dash/);
    assert.match(
      parseProfileV3(bytes(raw({ schemaVersion: 4 }))).error,
      /newer Dash/,
    );
    assert.match(parseProfileV3(bytes(raw({ name: "" }))).error, /no name/);
    assert.match(
      parseProfileV3(bytes(raw({ widgets: { "../x": "1.0.0" } }))).error,
      /isn't a package name/,
    );
    assert.match(
      parseProfileV3(bytes(raw({ widgets: { "@trops/x": "^1.0.0" } }))).error,
      /no exact version/,
    );
    assert.match(
      parseProfileV3(bytes(raw({ setup: "garbage" }))).error,
      /damaged/,
    );
  });

  it("drops what isn't well formed, never writes it", () => {
    const m = parseProfileV3(
      bytes(
        raw({
          setup: packSetup({
            dashboards: [{ id: 1, name: "Ok" }, { name: "no id" }, "junk"],
            themes: { constructor: { a: 1 }, Fine: { name: "Fine" }, Bad: 5 },
            folders: [{ id: 3, name: { x: 1 }, icon: ["a"] }],
            bots: [
              { id: "t", system: "dash-team", name: "Dash team" },
              { id: "b", name: "Bot", session: "x" },
              { id: "c", name: { evil: 1 } },
            ],
          }),
          providers: [
            { name: { x: 1 }, type: "slack" },
            { name: "Ok", type: "x" },
          ],
        }),
      ),
    ).manifest;
    assert.deepEqual(
      m.setup.dashboards.map((d) => d.name),
      ["Ok"],
    );
    assert.deepEqual(Object.keys(m.setup.themes), ["Fine"]);
    assert.deepEqual(m.setup.folders, [{ id: 3, name: "Folder" }]);
    assert.deepEqual(
      m.setup.bots.map((b) => [b.id, b.session]),
      [["b", undefined]],
    );
    assert.deepEqual(
      m.providers.map((p) => p.name),
      ["Ok"],
    );
  });

  it("each id once: a repeated record is dropped", () => {
    const m = parseProfileV3(
      bytes(
        raw({
          setup: packSetup({
            dashboards: [
              { id: 5, name: "First" },
              { id: "5", name: "Again" },
            ],
            folders: [
              { id: 2, name: "A" },
              { id: 2, name: "B" },
            ],
            bots: [],
            themes: {},
          }),
        }),
      ),
    ).manifest;
    assert.deepEqual(
      m.setup.dashboards.map((d) => d.name),
      ["First"],
    );
    assert.deepEqual(
      m.setup.folders.map((f) => f.name),
      ["A"],
    );
  });

  it("tells a v3, a v2 and a v1 file apart", () => {
    assert.equal(jsonSchemaVersion(bytes(raw())), 3);
    assert.equal(
      jsonSchemaVersion(bytes({ kind: "dash-profile", schemaVersion: 2 })),
      2,
    );
    assert.equal(jsonSchemaVersion(Buffer.from("PK\x03\x04")), null);
    assert.equal(jsonSchemaVersion(Buffer.from("  {broken")), 0);
  });
});
