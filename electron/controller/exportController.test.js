/**
 * exportController.test.js
 *
 * Pins the Export Everything bundler (Phase 4A). The most important
 * test in this file is the credential-leak regression-pin — without
 * it, a refactor of the provider stripping logic could silently start
 * including `provider.credentials` in user-shared backups, which is
 * exactly the failure mode the allowlist design exists to prevent.
 *
 * Tests:
 *   - stripProviderCredentials drops `credentials` field
 *   - stripProviderCredentials drops any unknown field (allowlist
 *     semantics, not blocklist)
 *   - safe fields (name, type, providerClass, mcpConfig, etc.) round-trip
 *   - buildBundleFiles produces the 5 expected JSON entries with
 *     correct counts in the manifest
 *   - manifest carries the schema version stamp + an ISO8601 timestamp
 *   - providers in the bundle NEVER carry credentials, even when the
 *     input array has them (credential-leak regression pin)
 *
 * Uses node:test (no jest) — same pattern as the rest of the electron/
 * tests.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  stripProviderCredentials,
  buildBundleFiles,
  SAFE_PROVIDER_FIELDS,
  BUNDLE_SCHEMA_VERSION,
} = require("./exportController");

test("stripProviderCredentials drops the credentials field", () => {
  const input = [
    {
      name: "slack-main",
      type: "slack",
      providerClass: "credential",
      credentials: { token: "xoxb-super-secret-DO-NOT-LEAK" },
    },
  ];
  const out = stripProviderCredentials(input);
  assert.strictEqual(out.length, 1);
  assert.ok(!("credentials" in out[0]), "credentials field must be stripped");
  assert.strictEqual(out[0].name, "slack-main");
  assert.strictEqual(out[0].type, "slack");
});

test("stripProviderCredentials uses allowlist semantics — unknown fields dropped", () => {
  const input = [
    {
      name: "x",
      type: "x",
      providerClass: "credential",
      // hypothetical future field that might carry secrets
      sneakySecret: "this-must-not-survive",
      hiddenToken: "neither-must-this",
    },
  ];
  const out = stripProviderCredentials(input);
  assert.ok(!("sneakySecret" in out[0]));
  assert.ok(!("hiddenToken" in out[0]));
});

test("stripProviderCredentials preserves every allowlisted field that's present", () => {
  const input = [
    {
      name: "gh",
      type: "github",
      providerClass: "credential",
      dateCreated: "2026-01-01",
      dateUpdated: "2026-02-01",
      isDefaultForType: true,
      mcpConfig: { command: "uvx", args: ["mcp-server-github"] },
      allowedTools: ["search", "read"],
      wsConfig: { url: "wss://example.com" },
      credentials: { token: "GHTOKEN" }, // must be stripped
    },
  ];
  const out = stripProviderCredentials(input);
  assert.strictEqual(out.length, 1);
  for (const field of SAFE_PROVIDER_FIELDS) {
    assert.ok(
      field in out[0],
      `allowlisted field "${field}" must survive when present in input`,
    );
  }
  assert.ok(!("credentials" in out[0]));
});

test("stripProviderCredentials handles non-array input gracefully", () => {
  assert.deepStrictEqual(stripProviderCredentials(null), []);
  assert.deepStrictEqual(stripProviderCredentials(undefined), []);
  assert.deepStrictEqual(stripProviderCredentials({}), []);
});

test("buildBundleFiles produces all 5 expected entries", () => {
  const files = buildBundleFiles({
    workspaces: [{ id: 1, name: "Test" }],
    themes: { "my-theme": { name: "My Theme" } },
    menuItems: [{ id: 1, name: "Folder" }],
    providers: [],
  });
  assert.ok("manifest.json" in files);
  assert.ok("workspaces.json" in files);
  assert.ok("themes.json" in files);
  assert.ok("menu-items.json" in files);
  assert.ok("providers.json" in files);
});

test("manifest carries schemaVersion + ISO8601 timestamp + counts", () => {
  const files = buildBundleFiles({
    workspaces: [{ id: 1 }, { id: 2 }],
    themes: { a: {}, b: {}, c: {} },
    menuItems: [{ id: 1 }],
    providers: [{ name: "p", type: "x", providerClass: "credential" }],
  });
  const manifest = JSON.parse(files["manifest.json"].toString("utf-8"));
  assert.strictEqual(manifest.schemaVersion, BUNDLE_SCHEMA_VERSION);
  assert.notStrictEqual(
    new Date(manifest.exportedAt).toString(),
    "Invalid Date",
  );
  assert.deepStrictEqual(manifest.counts, {
    workspaces: 2,
    themes: 3,
    menuItems: 1,
    providers: 1,
  });
});

test("REGRESSION PIN — bundle's providers.json never carries credentials", () => {
  // Worst-case input: every provider has credentials. If any of them
  // make it into the JSON blob written to the ZIP, the export feature
  // is a credential leak vector and this test must fail loudly.
  const files = buildBundleFiles({
    workspaces: [],
    themes: {},
    menuItems: [],
    providers: [
      {
        name: "slack-1",
        type: "slack",
        providerClass: "credential",
        credentials: { token: "xoxb-LEAK-1" },
      },
      {
        name: "gh-1",
        type: "github",
        providerClass: "credential",
        credentials: { apiKey: "GHKEY-LEAK-2" },
      },
      {
        name: "openai-1",
        type: "openai",
        providerClass: "credential",
        credentials: { secret: "sk-LEAK-3" },
      },
    ],
  });
  const providersJson = files["providers.json"].toString("utf-8");
  const parsed = JSON.parse(providersJson);

  // Structural pin: no entry should have a `credentials` field.
  for (const entry of parsed) {
    assert.ok(
      !("credentials" in entry),
      `provider ${entry.name} leaked credentials field`,
    );
  }
  // Belt-and-suspenders pin: none of the literal secret strings show
  // up anywhere in the serialized bundle, including unrelated fields.
  for (const leak of ["xoxb-LEAK-1", "GHKEY-LEAK-2", "sk-LEAK-3"]) {
    assert.ok(
      !providersJson.includes(leak),
      `secret "${leak}" leaked into providers.json`,
    );
  }
});

test("manifest counts handle empty/missing inputs cleanly", () => {
  const files = buildBundleFiles({});
  const manifest = JSON.parse(files["manifest.json"].toString("utf-8"));
  assert.deepStrictEqual(manifest.counts, {
    workspaces: 0,
    themes: 0,
    menuItems: 0,
    providers: 0,
  });
});
