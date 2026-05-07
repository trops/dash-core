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
