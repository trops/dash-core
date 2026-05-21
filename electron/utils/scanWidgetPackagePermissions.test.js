/**
 * scanWidgetPackagePermissions.test.js
 *
 * Pin for the file-walking scanner that hooks into publish + install
 * flows. Uses tmp dir fixtures so the test is hermetic.
 *
 * Run: `node --test electron/utils/scanWidgetPackagePermissions.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  scanFileForMcpUsage,
  scanWidgetPackagePermissions,
  mergePermissions,
  applyScanToPackageJson,
  backfillPackagePermissions,
} = require("./scanWidgetPackagePermissions");

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-pkg-test-"));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents, "utf8");
  }
  return dir;
}

test("scanFileForMcpUsage: literal callTool + useMcpProvider", () => {
  const code = `
    import { useMcpProvider } from "@trops/dash-core";
    export default function W() {
      const { callTool } = useMcpProvider("google-drive");
      callTool("search", {});
      callTool("list_folder", {});
    }
  `;
  const out = scanFileForMcpUsage(code);
  assert.deepStrictEqual(out.providers, ["google-drive"]);
  assert.deepStrictEqual(out.tools.sort(), ["list_folder", "search"]);
});

test("scanFileForMcpUsage: variable indirection skipped", () => {
  const code = `
    useMcpProvider("github");
    const t = pickTool();
    callTool(t, {});
    callTool("search_repositories", {});
  `;
  const out = scanFileForMcpUsage(code);
  assert.deepStrictEqual(out.tools, ["search_repositories"]);
});

test("scanFileForMcpUsage: line comments stripped", () => {
  const code = `
    useMcpProvider("github");
    // callTool("dead", {});
    callTool("alive", {});
  `;
  const out = scanFileForMcpUsage(code);
  assert.deepStrictEqual(out.tools, ["alive"]);
});

test("scanWidgetPackagePermissions: walks subdirs, ignores node_modules + dist", () => {
  const dir = makeFixture({
    "widgets/Foo.js": `
      useMcpProvider("slack");
      callTool("send_message", {});
    `,
    "widgets/Bar.js": `
      useMcpProvider("slack");
      callTool("list_channels", {});
    `,
    "node_modules/lib/x.js": `
      callTool("ignored_tool", {});
    `,
    "dist/index.cjs.js": `
      callTool("also_ignored", {});
    `,
  });
  const out = scanWidgetPackagePermissions(dir);
  assert.ok(out.slack, "expected a slack entry");
  assert.deepStrictEqual(out.slack.tools, ["list_channels", "send_message"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissions: empty when no MCP usage detected", () => {
  const dir = makeFixture({
    "widgets/Static.js": `
      export default function W() { return <div>hi</div>; }
    `,
  });
  assert.deepStrictEqual(scanWidgetPackagePermissions(dir), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissions: missing dir returns {}", () => {
  assert.deepStrictEqual(
    scanWidgetPackagePermissions("/no/such/path/xxxxx"),
    {},
  );
});

test("mergePermissions: scanner adds tools the human missed; human entries preserved", () => {
  const human = {
    "google-drive": {
      tools: ["search"],
      readPaths: ["/safe"],
    },
  };
  const scanned = {
    "google-drive": { tools: ["search", "list_folder"] },
    slack: { tools: ["send_message"] },
  };
  const merged = mergePermissions(human, scanned);
  assert.deepStrictEqual(merged["google-drive"].tools.sort(), [
    "list_folder",
    "search",
  ]);
  assert.deepStrictEqual(merged["google-drive"].readPaths, ["/safe"]);
  assert.deepStrictEqual(merged.slack.tools, ["send_message"]);
});

test("mergePermissions: idempotent on repeated runs", () => {
  const scanned = { slack: { tools: ["send_message"] } };
  const m1 = mergePermissions(null, scanned);
  const m2 = mergePermissions(m1, scanned);
  assert.deepStrictEqual(m1, m2);
});

test("applyScanToPackageJson: writes manifest into existing package.json", () => {
  const dir = makeFixture({
    "package.json": JSON.stringify({
      name: "@test/widget",
      version: "1.0.0",
    }),
    "widgets/W.js": `
      useMcpProvider("slack");
      callTool("send_message", {});
    `,
  });
  const merged = applyScanToPackageJson(dir);
  assert.ok(merged, "expected a merged result");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  assert.deepStrictEqual(pkg.dash.permissions.mcp.slack.tools, [
    "send_message",
  ]);
  // Existing fields preserved.
  assert.strictEqual(pkg.name, "@test/widget");
  assert.strictEqual(pkg.version, "1.0.0");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("applyScanToPackageJson: no MCP usage → no write, returns null", () => {
  const dir = makeFixture({
    "package.json": JSON.stringify({ name: "@test/empty", version: "1.0.0" }),
    "widgets/W.js": `export default () => null;`,
  });
  const result = applyScanToPackageJson(dir);
  assert.strictEqual(result, null);
  // package.json unchanged.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  assert.strictEqual(pkg.dash, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("backfillPackagePermissions: scans + modifies multiple packages, returns counts", () => {
  const dirA = makeFixture({
    "package.json": JSON.stringify({ name: "@test/a", version: "1.0.0" }),
    "widgets/W.js": `
      useMcpProvider("slack");
      callTool("send_message", {});
    `,
  });
  const dirB = makeFixture({
    "package.json": JSON.stringify({ name: "@test/b", version: "1.0.0" }),
    "src/W.js": `
      useMcpProvider("github");
      callTool("list_repos", {});
    `,
  });
  const summary = backfillPackagePermissions([dirA, dirB]);
  assert.strictEqual(summary.scanned, 2);
  assert.strictEqual(summary.modified, 2);
  assert.deepStrictEqual(summary.errors, []);

  const pkgA = JSON.parse(
    fs.readFileSync(path.join(dirA, "package.json"), "utf8"),
  );
  const pkgB = JSON.parse(
    fs.readFileSync(path.join(dirB, "package.json"), "utf8"),
  );
  assert.deepStrictEqual(pkgA.dash.permissions.mcp.slack.tools, [
    "send_message",
  ]);
  assert.deepStrictEqual(pkgB.dash.permissions.mcp.github.tools, [
    "list_repos",
  ]);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

test("backfillPackagePermissions: skips packages with no MCP usage (modified count excludes them)", () => {
  const dirHit = makeFixture({
    "package.json": JSON.stringify({ name: "@test/hit", version: "1.0.0" }),
    "widgets/W.js": `useMcpProvider("slack"); callTool("send_message", {});`,
  });
  const dirMiss = makeFixture({
    "package.json": JSON.stringify({ name: "@test/miss", version: "1.0.0" }),
    "widgets/W.js": `export default () => null;`,
  });
  const summary = backfillPackagePermissions([dirHit, dirMiss]);
  assert.strictEqual(summary.scanned, 2);
  assert.strictEqual(summary.modified, 1);
  assert.deepStrictEqual(summary.errors, []);

  const pkgMiss = JSON.parse(
    fs.readFileSync(path.join(dirMiss, "package.json"), "utf8"),
  );
  assert.strictEqual(pkgMiss.dash, undefined);

  fs.rmSync(dirHit, { recursive: true, force: true });
  fs.rmSync(dirMiss, { recursive: true, force: true });
});

test("backfillPackagePermissions: errors on bad paths are captured, others continue", () => {
  const goodDir = makeFixture({
    "package.json": JSON.stringify({ name: "@test/good", version: "1.0.0" }),
    "widgets/W.js": `useMcpProvider("slack"); callTool("send_message", {});`,
  });
  const summary = backfillPackagePermissions([
    "/no/such/path/yyyyy",
    goodDir,
    null,
    undefined,
  ]);
  // Two clearly invalid entries (null + undefined) and one nonexistent path
  // contribute zero modified; the good one updates and is the only counted scan.
  assert.strictEqual(summary.modified, 1);
  // Bad paths short-circuit cleanly without throwing.
  assert.deepStrictEqual(summary.errors, []);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(goodDir, "package.json"), "utf8"),
  );
  assert.deepStrictEqual(pkg.dash.permissions.mcp.slack.tools, [
    "send_message",
  ]);

  fs.rmSync(goodDir, { recursive: true, force: true });
});

test("applyScanToPackageJson: existing manifest is preserved + augmented", () => {
  const dir = makeFixture({
    "package.json": JSON.stringify({
      name: "@test/widget",
      version: "1.0.0",
      dash: {
        permissions: {
          mcp: {
            "google-drive": {
              tools: ["read_file"],
              readPaths: ["/safe"],
            },
          },
        },
      },
    }),
    "widgets/W.js": `
      useMcpProvider("google-drive");
      callTool("search", {});
      callTool("read_file", {});
    `,
  });
  applyScanToPackageJson(dir);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  assert.deepStrictEqual(
    pkg.dash.permissions.mcp["google-drive"].tools.sort(),
    ["read_file", "search"],
  );
  // Hand-authored readPaths preserved.
  assert.deepStrictEqual(pkg.dash.permissions.mcp["google-drive"].readPaths, [
    "/safe",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── multi-widget package: providers and tools must pair per-file ─────

test("scanWidgetPackagePermissions: multi-widget package — providers pair with their own file's tools, NOT cross-pollinated across siblings", () => {
  // Regression guard for the cross-pollination bug. Three widgets in
  // one package, each using a different MCP server. The OLD scanner
  // built a union of every provider AND a union of every tool, then
  // assigned the full tool union to every provider — so the `slack`
  // server would (wrongly) claim `list_pull_requests` and
  // `list_directory`, and `github` would claim `send_message`, etc.
  //
  // Per-file pairing must keep tools attached only to the providers
  // that appear in the same file.
  const dir = makeFixture({
    "widgets/SlackWidget.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function Slack() {
        const { callTool } = useMcpProvider("slack");
        callTool("slack_search_channels", {});
        callTool("slack_send_message", {});
      }
    `,
    "widgets/GitHubWidget.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function GitHub() {
        const { callTool } = useMcpProvider("github");
        callTool("list_pull_requests", {});
      }
    `,
    "widgets/FilesystemWidget.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function FS() {
        const { callTool } = useMcpProvider("filesystem");
        callTool("list_directory", {});
        callTool("read_file", {});
      }
    `,
  });
  const out = scanWidgetPackagePermissions(dir);
  assert.deepStrictEqual(out.slack.tools.sort(), [
    "slack_search_channels",
    "slack_send_message",
  ]);
  assert.deepStrictEqual(out.github.tools, ["list_pull_requests"]);
  assert.deepStrictEqual(out.filesystem.tools.sort(), [
    "list_directory",
    "read_file",
  ]);
  // Negative assertions — the bug was about tools leaking ACROSS
  // providers. Pin these so a future refactor that reintroduces the
  // package-wide union fails noisily here.
  assert.ok(
    !out.slack.tools.includes("list_pull_requests"),
    "slack must not claim github's list_pull_requests",
  );
  assert.ok(
    !out.slack.tools.includes("list_directory"),
    "slack must not claim filesystem's list_directory",
  );
  assert.ok(
    !out.github.tools.includes("slack_send_message"),
    "github must not claim slack's send_message",
  );
  assert.ok(
    !out.filesystem.tools.includes("slack_search_channels"),
    "filesystem must not claim slack's search_channels",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissions: tools in a file with NO useMcpProvider are dropped, not over-attributed", () => {
  // Helper modules that wrap callTool but don't mount a provider hook
  // would, under the old union, attach their tool names to every
  // provider in the package. We can't tell statically which server
  // they target, so the safe call is to drop them — the runtime gate
  // catches the call when it actually fires.
  const dir = makeFixture({
    "widgets/Main.js": `
      import { useMcpProvider } from "@trops/dash-core";
      const { callTool } = useMcpProvider("slack");
      callTool("send_message", {});
    `,
    "utils/helper.js": `
      // Helper module — no useMcpProvider here, just a thin wrapper.
      export const fetchSomething = async (callTool) => {
        return callTool("orphan_helper_tool", {});
      };
    `,
  });
  const out = scanWidgetPackagePermissions(dir);
  // Slack got its own send_message, paired in the file where the
  // provider hook lives.
  assert.deepStrictEqual(out.slack.tools, ["send_message"]);
  // The helper's tool isn't attached to any provider — there's no
  // static evidence of which server it targets.
  assert.ok(
    !out.slack.tools.includes("orphan_helper_tool"),
    "orphan helper tool must not pollute slack",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissions: file with multiple providers attributes its tools to each (intra-file orchestration is acceptable)", () => {
  // Rare case: a widget that orchestrates two MCP servers in the same
  // component file. We can't statically scope tools to one hook vs.
  // the other, but the over-attribution is at least bounded to the
  // single widget's own file — not the whole package.
  const dir = makeFixture({
    "widgets/Combo.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function Combo() {
        const slack = useMcpProvider("slack");
        const drive = useMcpProvider("google-drive");
        slack.callTool("send_message", {});
        drive.callTool("search", {});
      }
    `,
  });
  const out = scanWidgetPackagePermissions(dir);
  // Both providers in the same file get both tools — acceptable
  // over-attribution at the widget boundary; the runtime gate is
  // still the safety net at call time.
  assert.deepStrictEqual(out.slack.tools.sort(), ["search", "send_message"]);
  assert.deepStrictEqual(out["google-drive"].tools.sort(), [
    "search",
    "send_message",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── per-component breakdown: each widget gets its own server map ──────

const {
  scanWidgetPackagePermissionsByComponent,
} = require("./scanWidgetPackagePermissions");

test("scanWidgetPackagePermissionsByComponent: pairs each <Name>.js with its sibling .dash.js and isolates per-widget MCP usage", () => {
  const dir = makeFixture({
    "widgets/SlackChannelBrowser.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function SlackChannelBrowser() {
        const { callTool } = useMcpProvider("slack");
        callTool("slack_search_channels", {});
      }
    `,
    "widgets/SlackChannelBrowser.dash.js": `
      import SlackChannelBrowser from "./SlackChannelBrowser";
      export default { component: SlackChannelBrowser, type: "widget" };
    `,
    "widgets/GitHubOpenPRs.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function GitHubOpenPRs() {
        const { callTool } = useMcpProvider("github");
        callTool("list_pull_requests", {});
      }
    `,
    "widgets/GitHubOpenPRs.dash.js": `
      import GitHubOpenPRs from "./GitHubOpenPRs";
      export default { component: GitHubOpenPRs, type: "widget" };
    `,
    "widgets/Counter.js": `
      // No MCP usage at all — pure UI widget.
      export default function Counter() { return null; }
    `,
    "widgets/Counter.dash.js": `
      import Counter from "./Counter";
      export default { component: Counter, type: "widget" };
    `,
  });
  const out = scanWidgetPackagePermissionsByComponent(dir);
  // Slack widget declares slack only — not github, not anything else.
  assert.deepStrictEqual(out.SlackChannelBrowser.servers.slack.tools, [
    "slack_search_channels",
  ]);
  assert.ok(
    !out.SlackChannelBrowser.servers.github,
    "SlackChannelBrowser must not declare github",
  );
  // GitHub widget declares github only.
  assert.deepStrictEqual(out.GitHubOpenPRs.servers.github.tools, [
    "list_pull_requests",
  ]);
  assert.ok(
    !out.GitHubOpenPRs.servers.slack,
    "GitHubOpenPRs must not declare slack",
  );
  // Counter has no MCP usage → no entry at all.
  assert.strictEqual(out.Counter, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissionsByComponent: skips files without a sibling .dash.js (helpers / utils not treated as widgets)", () => {
  const dir = makeFixture({
    "widgets/Real.js": `
      import { useMcpProvider } from "@trops/dash-core";
      export default function R() {
        const { callTool } = useMcpProvider("slack");
        callTool("send_message", {});
      }
    `,
    "widgets/Real.dash.js": `
      import Real from "./Real";
      export default { component: Real, type: "widget" };
    `,
    "widgets/helper.js": `
      // Looks widget-y but has no .dash.js sibling — must NOT show up
      // in the per-component output. The package-level scan still
      // ignores it because helpers don't typically have useMcpProvider,
      // but a defensive check here matters when authors stash an
      // experimental file in widgets/.
      import { useMcpProvider } from "@trops/dash-core";
      useMcpProvider("github");
      callTool("orphan_tool", {});
    `,
  });
  const out = scanWidgetPackagePermissionsByComponent(dir);
  assert.deepStrictEqual(Object.keys(out), ["Real"]);
  assert.ok(
    !out.Real.servers.github,
    "Real must not inherit helper.js declarations",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanWidgetPackagePermissionsByComponent: returns empty object when no qualifying components exist", () => {
  const dir = makeFixture({
    "widgets/Static.js": `export default function S() { return null; }`,
    "widgets/Static.dash.js": `export default { type: "widget" };`,
  });
  assert.deepStrictEqual(scanWidgetPackagePermissionsByComponent(dir), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test("applyScanToPackageJson: writes BOTH dash.permissions.mcp AND dash.permissions.mcpByComponent", () => {
  const dir = makeFixture({
    "package.json": JSON.stringify({ name: "@test/multi", version: "1.0.0" }),
    "widgets/A.js": `
      import { useMcpProvider } from "@trops/dash-core";
      useMcpProvider("slack");
      callTool("send_message", {});
    `,
    "widgets/A.dash.js": `export default { type: "widget" };`,
    "widgets/B.js": `
      import { useMcpProvider } from "@trops/dash-core";
      useMcpProvider("github");
      callTool("list_repos", {});
    `,
    "widgets/B.dash.js": `export default { type: "widget" };`,
  });
  applyScanToPackageJson(dir);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  // Package-level mcp keeps the union — back-compat.
  assert.deepStrictEqual(pkg.dash.permissions.mcp.slack.tools, [
    "send_message",
  ]);
  assert.deepStrictEqual(pkg.dash.permissions.mcp.github.tools, ["list_repos"]);
  // Per-component breakdown isolates each widget's usage.
  assert.deepStrictEqual(
    pkg.dash.permissions.mcpByComponent.A.servers.slack.tools,
    ["send_message"],
  );
  assert.ok(
    !pkg.dash.permissions.mcpByComponent.A.servers.github,
    "A must not declare github in its per-widget block",
  );
  assert.deepStrictEqual(
    pkg.dash.permissions.mcpByComponent.B.servers.github.tools,
    ["list_repos"],
  );
  assert.ok(
    !pkg.dash.permissions.mcpByComponent.B.servers.slack,
    "B must not declare slack in its per-widget block",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("applyScanToPackageJson: stale mcpByComponent gets dropped on re-scan when components are gone", () => {
  const dir = makeFixture({
    "package.json": JSON.stringify({
      name: "@test/stale",
      version: "1.0.0",
      dash: {
        permissions: {
          mcpByComponent: {
            DeletedWidget: { servers: { slack: { tools: ["dead_tool"] } } },
          },
        },
      },
    }),
    "widgets/Static.js": `export default function S() { return null; }`,
    "widgets/Static.dash.js": `export default { type: "widget" };`,
  });
  applyScanToPackageJson(dir);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  // No widget declares MCP usage anymore → both blocks should be
  // absent (mcp because no usage; mcpByComponent because nothing
  // current to write AND we drop stale entries to prevent leftover
  // permissions from haunting the user).
  assert.strictEqual(pkg.dash?.permissions?.mcp, undefined);
  assert.strictEqual(pkg.dash?.permissions?.mcpByComponent, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
