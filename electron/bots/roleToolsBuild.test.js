/**
 * roleToolsBuild.test.js — the Builder's and Checker's widget tools
 * (create-entry CRE-011, slice 3b-1), with fake host hooks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  roleToolsFor,
  serverForTool,
  handleRoleTool,
  ROLE_SERVER,
  ROLE_BUILD_SERVER,
} = require("./roleTools");
const { compareConfigs } = require("./configDiff");

const as = (role) => ({ botId: `b_${role}`, role });
const CONFIG = `export default { type: "widget", userConfig: { title: { type: "text", defaultValue: "Hi" } }, events: ["picked"] };`;

function deps(over = {}) {
  return {
    installedWidgets: () => [],
    searchRegistry: async () => [],
    readWidget: async () => ({ success: false }),
    providerTools: () => [],
    askRole: async () => ({ text: "", isError: false }),
    widgetGuide: async ({ providers }) => ({
      rules: "# Rules\nUse dash-react.",
      tools: Object.fromEntries(
        providers.map((p) => [
          p,
          p === "gmail"
            ? [
                {
                  name: "search_messages",
                  args: ["query"],
                  description: "Search",
                },
              ]
            : [],
        ]),
      ),
    }),
    buildWidget: async (req) =>
      req.componentCode.includes("Modal")
        ? {
            success: false,
            error:
              "The code didn't pass the widget checks; fix these and build again.",
            problems: ["line 3: <Modal> isn't allowed in a widget"],
          }
        : { success: true, widgetName: `@ai-built/${req.name.toLowerCase()}` },
    checkWidget: async ({ name }) => ({
      success: true,
      widgetName: name,
      componentName: "Hello",
      compile: { ok: true },
      problems: [],
      scorecard: { failed: [], passed: 9, notCheckable: 7 },
      configCode: CONFIG,
      previousConfigCode: null,
    }),
    compareConfigs,
    ...over,
  };
}

describe("tools and servers", () => {
  it("the Builder builds, the Checker checks; only build/place need approval", () => {
    assert.deepEqual(
      roleToolsFor("builder").map((t) => t.name),
      [
        "widget_guide",
        "build_widget",
        "draft_bot",
        "place_widget",
        "read_widget",
        "list_providers",
        "list_dashboards",
      ],
    );
    assert.deepEqual(
      roleToolsFor("checker").map((t) => t.name),
      ["check_widget", "read_widget", "list_providers"],
    );
    assert.equal(serverForTool("build_widget"), ROLE_BUILD_SERVER);
    assert.equal(serverForTool("place_widget"), ROLE_BUILD_SERVER);
    for (const t of ["widget_guide", "check_widget", "read_widget"]) {
      assert.equal(serverForTool(t), ROLE_SERVER);
    }
  });

  it("other roles can't build or check", async () => {
    const r = await handleRoleTool(deps(), as("planner"), "build_widget", {});
    assert.equal(r.isError, true);
    const c = await handleRoleTool(deps(), as("builder"), "check_widget", {
      name: "x",
    });
    assert.equal(c.isError, true);
  });

  it("without the host's hooks, the tools say building isn't available", async () => {
    const d = deps({
      widgetGuide: undefined,
      buildWidget: undefined,
      checkWidget: undefined,
    });
    for (const [role, tool] of [
      ["builder", "widget_guide"],
      ["builder", "build_widget"],
      ["checker", "check_widget"],
    ]) {
      const r = await handleRoleTool(d, as(role), tool, { name: "X" });
      assert.match(r.text, /isn't available here/);
    }
  });
});

describe("widget_guide", () => {
  it("gives the rules and each provider's tool names", async () => {
    const r = await handleRoleTool(deps(), as("builder"), "widget_guide", {
      providers: ["gmail", "notion"],
    });
    assert.match(r.text, /# Rules/);
    assert.match(
      r.text,
      /Tools for gmail:\n- search_messages\(query\) — Search/,
    );
    assert.match(r.text, /Tools for notion: none known/);
  });
});

describe("widget_guide — no rules", () => {
  it("refuses to let the Builder go on without the rules", async () => {
    const r = await handleRoleTool(
      deps({ widgetGuide: async () => ({ rules: null, tools: {} }) }),
      as("builder"),
      "widget_guide",
      {},
    );
    assert.equal(r.isError, true);
    assert.match(r.text, /don't build/);
  });
});

describe("build_widget", () => {
  it("installs and points to the Checker", async () => {
    const r = await handleRoleTool(deps(), as("builder"), "build_widget", {
      name: "Hello",
      componentCode: "export default function Hello() {}",
      configCode: CONFIG,
    });
    assert.equal(r.isError, false);
    assert.match(r.text, /Built and installed @ai-built\/hello/);
  });

  it("hands back the problems to fix", async () => {
    const r = await handleRoleTool(deps(), as("builder"), "build_widget", {
      name: "Hello",
      componentCode: "<Modal/>",
      configCode: CONFIG,
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /- line 3: <Modal> isn't allowed/);
  });

  it("passes update and provider through", async () => {
    let seen = null;
    await handleRoleTool(
      deps({
        buildWidget: async (req) => {
          seen = req;
          return { success: true, widgetName: "@ai-built/hello" };
        },
      }),
      as("builder"),
      "build_widget",
      {
        name: "Hello",
        componentCode: "c",
        configCode: "k",
        provider: "gmail",
        update: true,
      },
    );
    assert.equal(seen.update, true);
    assert.equal(seen.provider, "gmail");
  });
});

describe("check_widget", () => {
  it("all passing → VERDICT: PASSED", async () => {
    const r = await handleRoleTool(deps(), as("checker"), "check_widget", {
      name: "@ai-built/hello",
    });
    assert.match(r.text, /PASS compiles/);
    assert.match(r.text, /PASS code checks/);
    assert.match(
      r.text,
      /PASS acceptance checklist \(9 passed, 7 not checkable\)/,
    );
    assert.match(r.text, /VERDICT: PASSED/);
  });

  it("a compile error or a failed code check fails; scorecard misses are notes", async () => {
    const r = await handleRoleTool(
      deps({
        checkWidget: async ({ name }) => ({
          success: true,
          widgetName: name,
          compile: { ok: false, error: "Unexpected token" },
          problems: ["line 2: Bogus isn't a dash-react component"],
          scorecard: { failed: [{ item: "Has an empty state" }], passed: 5 },
          configCode: CONFIG,
          previousConfigCode: null,
        }),
      }),
      as("checker"),
      "check_widget",
      { name: "@ai-built/hello" },
    );
    assert.match(r.text, /FAIL doesn't compile: Unexpected token/);
    assert.match(r.text, /FAIL code checks:\n {2}- line 2: Bogus/);
    assert.match(
      r.text,
      /NOTE acceptance checklist: 5 passed, 1 to improve:\n {2}- Has an empty state/,
    );
    assert.match(r.text, /VERDICT: FAILED/);
  });

  it("a missed must-fix checklist item fails; the rest stay notes (Create build fixes 3)", async () => {
    const r = await handleRoleTool(
      deps({
        checkWidget: async ({ name }) => ({
          success: true,
          widgetName: name,
          compile: { ok: true },
          problems: [],
          scorecard: {
            failed: [
              {
                item: "Error state rendered when the provider call fails",
                mustFix: true,
              },
              { item: "Title uses SubHeading2", mustFix: false },
            ],
            passed: 7,
          },
          configCode: CONFIG,
          previousConfigCode: null,
        }),
      }),
      as("checker"),
      "check_widget",
      { name: "@ai-built/hello" },
    );
    assert.match(
      r.text,
      /FAIL acceptance checklist — must fix:\n {2}- Error state rendered/,
    );
    assert.match(
      r.text,
      /NOTE acceptance checklist: 7 passed, 1 to improve:\n {2}- Title uses SubHeading2/,
    );
    assert.doesNotMatch(r.text, /to improve:[\s\S]*Error state/);
    assert.match(r.text, /VERDICT: FAILED/);
  });

  it("a draft (the Widget Builder's unsaved code) comes with its code, so the Checker can judge it", async () => {
    const r = await handleRoleTool(
      deps({
        checkWidget: async ({ name }) => ({
          success: true,
          widgetName: name,
          componentName: "Hello",
          compile: { ok: true },
          problems: [],
          scorecard: { failed: [], passed: 9 },
          componentCode: "export default function Hello() { return null; }",
          configCode: CONFIG,
          previousConfigCode: null,
        }),
      }),
      as("checker"),
      "check_widget",
      { name: "draft:Hello" },
    );
    assert.match(r.text, /Code \(not installed yet\):/);
    assert.match(r.text, /export default function Hello\(\)/);
    // The code comes before the verdict line.
    assert.ok(
      r.text.indexOf("export default function Hello") <
        r.text.indexOf("VERDICT: PASSED"),
    );
  });

  it("an update that drops a setting or an event fails", async () => {
    const r = await handleRoleTool(
      deps({
        checkWidget: async ({ name }) => ({
          success: true,
          widgetName: name,
          compile: { ok: true },
          problems: [],
          scorecard: { failed: [], passed: 9 },
          configCode: `export default { type: "widget", userConfig: {}, events: [] };`,
          previousConfigCode: CONFIG,
        }),
      }),
      as("checker"),
      "check_widget",
      { name: "@ai-built/hello" },
    );
    assert.match(r.text, /FAIL config update would break:/);
    assert.match(r.text, /setting "title" was removed/);
    assert.match(r.text, /event "picked" is no longer published/);
    assert.match(r.text, /VERDICT: FAILED/);
  });
});
