/**
 * botsGuide.test.js: get_setup_guide({ topic: "bots" }) (DASH-80), the guide
 * an AI reads before building a team of bots over MCP.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { BOTS_GUIDE } = require("./botsGuide");
const defs = require("./toolDefinitions");
const { BOT_TOOLS } = require("./botTools");
const { TEAM_TOOLS } = require("./teamTools");
const { jsonSchemaToZod } = require("./jsonSchemaToZod");

const ALL_TOOLS = [...Object.values(defs).flat(), ...BOT_TOOLS, ...TEAM_TOOLS];
const TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

describe("the bots guide", () => {
  it("is a topic of get_setup_guide", () => {
    const guide = defs.guideTools.find((t) => t.name === "get_setup_guide");
    assert.ok(guide.inputSchema.properties.topic.enum.includes("bots"));
    const schema = jsonSchemaToZod(guide.inputSchema);
    assert.ok(schema.safeParse({ topic: "bots" }).success);
  });

  it("is what the handler returns for 'bots', and the overview points to it", () => {
    // toolHandlers needs Electron to load; check its wiring in the source.
    const src = fs.readFileSync(
      path.join(__dirname, "toolHandlers.js"),
      "utf8",
    );
    assert.match(src, /require\("\.\/botsGuide"\)/);
    assert.match(src, /GUIDE_CONTENT\.bots = BOTS_GUIDE;/);
    assert.match(src, /get_setup_guide\("bots"\)/);
  });

  it("create_bot and update_bot point to it", () => {
    for (const name of ["create_bot", "update_bot"]) {
      const tool = BOT_TOOLS.find((t) => t.name === name);
      assert.match(tool.description, /get_setup_guide\(\{ topic: 'bots' \}\)/);
    }
  });

  it("covers how a team fits together", () => {
    for (const part of [
      "subscriptions",
      "checks",
      "handOn false",
      "set_team_settings",
      "approvalPolicy",
      "confirm_bot",
      "$DASH_INPUT",
      "GH_TOKEN",
    ]) {
      assert.ok(BOTS_GUIDE.includes(part), `the guide mentions ${part}`);
    }
  });

  it("only names MCP tools that exist", () => {
    // Every snake_case word in the guide is a tool, except these.
    const notTools = new Set(["http_code"]); // curl's -w '%{http_code}'
    const named = new Set(
      [...BOTS_GUIDE.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]),
    );
    const unknown = [...named].filter(
      (n) => !TOOL_NAMES.has(n) && !notTools.has(n),
    );
    assert.deepEqual(unknown, [], `not MCP tools: ${unknown.join(", ")}`);
    assert.ok(named.size >= 8, "the guide names the tools it relies on");
  });
});
