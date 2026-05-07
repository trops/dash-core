/**
 * widgetPermissions.test.js
 *
 * Pin for the pure helpers that translate widget identifiers into
 * package paths and parse the `dash.permissions.mcp` block out of a
 * widget package's package.json.
 *
 * Run: `node --test electron/mcp/widgetPermissions.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// widgetPermissions.js calls require("electron") for app.getPath. We
// mock that before requiring the module so the test runs without an
// Electron host. Same pattern as electron/utils/safePath.test.js.
const Module = require("node:module");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "widget-perms-test-"));
const fakeElectron = {
  app: {
    getPath: (key) => {
      if (key === "userData") return path.join(tmpRoot, "userData");
      throw new Error("unknown path key: " + key);
    },
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_widget_perms__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_widget_perms__"] = {
  id: "__stub_electron_widget_perms__",
  filename: "__stub_electron_widget_perms__",
  loaded: true,
  exports: fakeElectron,
};

const {
  dottedComponentIdToPackageId,
  parseManifestPermissions,
} = require("./widgetPermissions");

test("dottedComponentIdToPackageId: already-npm form passes through", () => {
  assert.strictEqual(
    dottedComponentIdToPackageId("@test/jit-probe"),
    "@test/jit-probe",
  );
  assert.strictEqual(
    dottedComponentIdToPackageId("@trops/gmail"),
    "@trops/gmail",
  );
});

test("dottedComponentIdToPackageId: 3-segment scoped form drops component", () => {
  assert.strictEqual(
    dottedComponentIdToPackageId("trops.gmail.GmailCompose"),
    "@trops/gmail",
  );
});

test("dottedComponentIdToPackageId: 3-segment ai-built form drops component", () => {
  assert.strictEqual(
    dottedComponentIdToPackageId("ai-built.pipeline.ProspectWorkspace"),
    "@ai-built/pipeline",
  );
});

test("dottedComponentIdToPackageId: 2-segment bare form drops component", () => {
  // pipeline.AutomationHub: bare package "pipeline", component "AutomationHub"
  assert.strictEqual(
    dottedComponentIdToPackageId("pipeline.AutomationHub"),
    "pipeline",
  );
});

test("dottedComponentIdToPackageId: single-segment unchanged", () => {
  assert.strictEqual(
    dottedComponentIdToPackageId("legacy-bare-package"),
    "legacy-bare-package",
  );
});

test("dottedComponentIdToPackageId: bad input returns null", () => {
  assert.strictEqual(dottedComponentIdToPackageId(null), null);
  assert.strictEqual(dottedComponentIdToPackageId(undefined), null);
  assert.strictEqual(dottedComponentIdToPackageId(""), null);
  assert.strictEqual(dottedComponentIdToPackageId(42), null);
});

test("parseManifestPermissions: extracts servers + tools from valid manifest", () => {
  const pkg = {
    name: "@trops/gmail",
    dash: {
      permissions: {
        mcp: {
          gmail: {
            tools: ["read_email", "send_email"],
          },
        },
      },
    },
  };
  const out = parseManifestPermissions(pkg);
  assert.deepStrictEqual(out, {
    servers: {
      gmail: {
        tools: ["read_email", "send_email"],
        readPaths: [],
        writePaths: [],
      },
    },
  });
});

test("parseManifestPermissions: missing dash.permissions.mcp returns null", () => {
  assert.strictEqual(parseManifestPermissions({ name: "@x/y" }), null);
  assert.strictEqual(parseManifestPermissions({ dash: {} }), null);
  assert.strictEqual(parseManifestPermissions(null), null);
  assert.strictEqual(parseManifestPermissions("not-an-object"), null);
});
