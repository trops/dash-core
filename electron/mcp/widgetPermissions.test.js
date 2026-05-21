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

// ─── per-component manifest: each widget in a multi-widget package
//     resolves to its OWN declared servers, not the package union ──

test("parseManifestPermissions: prefers mcpByComponent[componentName] when present", () => {
  // A package shipping two widgets, each with its own provider. The
  // per-component breakdown lets each widget see ONLY its own
  // servers — the union-style `mcp` block is for back-compat with
  // call sites that don't pass componentName.
  const pkg = {
    name: "@ai-built/prompt-validation",
    dash: {
      permissions: {
        mcp: {
          // Package-level union — every server any widget uses.
          slack: { tools: ["slack_search_channels"] },
          github: { tools: ["list_pull_requests"] },
        },
        mcpByComponent: {
          SlackChannelBrowser: {
            servers: { slack: { tools: ["slack_search_channels"] } },
          },
          GitHubOpenPRs: {
            servers: { github: { tools: ["list_pull_requests"] } },
          },
        },
      },
    },
  };
  const slackOnly = parseManifestPermissions(pkg, "SlackChannelBrowser");
  assert.deepStrictEqual(slackOnly, {
    servers: {
      slack: {
        tools: ["slack_search_channels"],
        readPaths: [],
        writePaths: [],
      },
    },
  });
  assert.ok(
    !slackOnly.servers.github,
    "Slack widget must not see github in its per-component view",
  );

  const githubOnly = parseManifestPermissions(pkg, "GitHubOpenPRs");
  assert.deepStrictEqual(githubOnly, {
    servers: {
      github: {
        tools: ["list_pull_requests"],
        readPaths: [],
        writePaths: [],
      },
    },
  });
});

test("parseManifestPermissions: falls back to package-level mcp when mcpByComponent is absent (back-compat)", () => {
  // Older packages that haven't been re-scanned with the new
  // per-component scanner. The lookup must still return the
  // package-level union so the gate and panel keep working.
  const pkg = {
    name: "@trops/legacy",
    dash: {
      permissions: {
        mcp: { gmail: { tools: ["read_email"] } },
      },
    },
  };
  const out = parseManifestPermissions(pkg, "GmailWidget");
  assert.deepStrictEqual(out.servers.gmail.tools, ["read_email"]);
});

test("parseManifestPermissions: widget NOT listed in mcpByComponent declares nothing — no fallback to package union", () => {
  // When mcpByComponent exists, it's authoritative for every
  // widget the caller asks about. A widget that isn't listed there
  // is a widget the scanner found NO MCP usage in — it declares
  // nothing. Falling back to the package-level union would defeat
  // the whole point of per-widget isolation: every sibling's tools
  // would get re-merged into widgets that don't actually use them
  // (the exact bug the per-component breakdown was added to fix).
  const pkg = {
    name: "@ai-built/pkg",
    dash: {
      permissions: {
        mcp: { slack: { tools: ["send_message"] } },
        mcpByComponent: {
          KnownWidget: {
            servers: { slack: { tools: ["send_message"] } },
          },
        },
      },
    },
  };
  assert.strictEqual(
    parseManifestPermissions(pkg, "UnknownWidget"),
    null,
    "Unknown widget under per-component manifest must declare nothing",
  );
});

test("parseManifestPermissions: omitted componentName works the same as before (no per-component lookup)", () => {
  // Existing callers that don't pass componentName must keep
  // getting the package-level view — that's the existing contract.
  const pkg = {
    name: "@ai-built/pkg",
    dash: {
      permissions: {
        mcp: { slack: { tools: ["send_message"] } },
        mcpByComponent: {
          WidgetA: { servers: { slack: { tools: ["send_message"] } } },
        },
      },
    },
  };
  const out = parseManifestPermissions(pkg);
  assert.deepStrictEqual(out.servers.slack.tools, ["send_message"]);
});
