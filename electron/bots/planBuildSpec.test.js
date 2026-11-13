/**
 * planBuildSpec.test.js — what the user reviewed (Review & build) is what
 * the Builder builds and the Checker checks: what it shows, its empty
 * words, the tools it reads and may change with, how often it reads again.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRequest,
  checkRequest,
  eventsToSend,
  planSteps,
  specLines,
  wiringLines,
} = require("./planBuild");

const piece = (over = {}) => ({
  kind: "widget",
  name: "Shopping List",
  source: "new",
  providers: ["home-assistant-mcp"],
  provider: { "home-assistant-mcp": "Home Assistant MCP" },
  settings: { todoEntityId: "todo.shopping_list", maxItems: 3 },
  shows: "The first 3 open items on your shopping list",
  whenEmpty: "Nothing on the list",
  reads: ["ha_get_todo"],
  changes: [],
  refresh: "every 5 minutes",
  ...over,
});
const planOf = (p) => ({ summary: "A shopping list", pieces: [p] });

describe("the reviewed parts reach the Builder and the Checker", () => {
  it("each part the plan says, as a line", () => {
    assert.deepEqual(specLines(piece()), [
      "It shows: The first 3 open items on your shopping list",
      'When there\'s nothing to show, it says: "Nothing on the list"',
      "It reads with these tools: ha_get_todo",
      "It only reads: never call a tool that changes anything",
      "It reads again: every 5 minutes",
      "Dash itself sends readComplete, renderComplete, readFailed for every widget — don't publish or list those",
    ]);
  });
  it("tools it may change with are the only ones, each asking first", () => {
    const lines = specLines(piece({ changes: ["ha_add_todo_item"] }));
    assert.ok(
      lines.includes(
        "It may change things only with: ha_add_todo_item — each behind a button that asks the user before it first changes anything",
      ),
    );
  });
  it("a plan from before the fields adds nothing (no 'only reads' it didn't say)", () => {
    const old = {
      kind: "widget",
      name: "Clock",
      source: "new",
      notes: "Shows the time",
    };
    assert.deepEqual(specLines(old), []);
  });
  it("the Builder's request carries them, after the settings", () => {
    const p = piece();
    const req = buildRequest(planOf(p), p, null, { cell: true });
    const at = (s) => req.indexOf(s);
    assert.ok(at("Settings — declare each one") > -1);
    assert.ok(at("It shows: The first 3 open items") > at("- maxItems: 3"));
    assert.match(req, /It only reads: never call a tool that changes anything/);
    assert.match(req, /It reads with these tools: ha_get_todo/);
  });
  it("the Checker checks the widget does each", () => {
    const p = piece();
    const text = checkRequest(planOf(p), p, { draft: "draft:ShoppingList" });
    assert.match(text, /What the user approved — check the widget does each:/);
    assert.match(text, /- It reads again: every 5 minutes/);
    assert.match(text, /- It only reads: never call a tool/);
  });
});

describe("Talks to: what it sends and listens for reaches the build", () => {
  it("each event it sends, with when and what it carries; never Dash's own", () => {
    const lines = specLines(
      piece({
        events: ["itemClicked", "readComplete"],
        sends: [
          {
            event: "itemClicked",
            when: "When you click an item",
            carries: "the item's name",
          },
        ],
      }),
    );
    assert.ok(
      lines.includes(
        "It sends itemClicked when you click an item, carrying the item's name",
      ),
    );
    assert.ok(!lines.some((l) => /It sends readComplete/.test(l)));
  });
  it("the Builder is never asked to publish Dash's own events", () => {
    const p = piece({ events: ["itemClicked", "renderComplete"] });
    assert.deepEqual(eventsToSend(planOf(p), p), ["itemClicked"]);
    assert.doesNotMatch(wiringLines(planOf(p), p).join("\n"), /renderComplete/);
  });
  it("a widget shows what a bot already on the dashboard sends: wired by its id", () => {
    const p = piece({
      listens: [
        {
          bot: "Recipe Bot",
          botId: "bot_recipe",
          result: "meal",
          handler: "showRecipeBotMeal",
        },
        // Not in the plan and no id: nothing to wire.
        { bot: "Ghost", result: "r", handler: "h" },
      ],
    });
    const plan = { ...planOf(p), dashboard: { id: "7", name: "Home" } };
    const steps = planSteps(plan, { dashboardName: "Home" });
    const listens = steps.filter((s) => s.kind === "listen");
    assert.equal(listens.length, 1);
    assert.equal(listens[0].botId, "bot_recipe");
    assert.equal(listens[0].handler, "showRecipeBotMeal");
    assert.ok(!listens[0].needs.some((n) => n.startsWith("bot:")));
    assert.match(listens[0].label, /Recipe Bot's meal/);
  });
});

describe("Dash's own events are always a widget's", () => {
  const { widgetWiring } = require("./planBuild");
  it("a widget's wiring lists them, whatever its .dash.js says", () => {
    const w = widgetWiring(
      'export default { name: "Clock", events: ["tick"], eventHandlers: [] };',
    );
    assert.ok(w);
    assert.deepEqual(w.events, [
      "tick",
      "readComplete",
      "renderComplete",
      "readFailed",
    ]);
  });
});

describe("Looks: the look the user picked reaches the Builder", () => {
  it("which look, its options, the fields in order, its empty words", () => {
    const lines = specLines(
      piece({
        look: {
          id: "next",
          options: {
            spacing: "Compact",
            header: "Title only",
            markFirst: "On",
            timeAt: "Under the title",
            fields: ["summary", "start"],
            empty: "Nothing today",
          },
        },
      }),
    );
    assert.ok(
      lines.includes(
        "It looks like this (the user picked it from previews of their data): Next up — the first one large; the rest below; built from dash-react's PanelHeader, StatusBadge, list rows; compact spacing; header: title only; the next (first) one marked; time under the title",
      ),
    );
    assert.ok(
      lines.includes("For each one it shows: summary, start, in that order"),
    );
    // The empty words are the widget's whenEmpty — said once.
    assert.ok(!lines.some((l) => /Nothing today/.test(l)));
  });
  it("no look picked, or one it doesn't know: nothing said", () => {
    assert.ok(!specLines(piece()).some((l) => /It looks like this/.test(l)));
    assert.ok(
      !specLines(piece({ look: { id: "spiral" } })).some((l) =>
        /It looks like this/.test(l),
      ),
    );
  });
});
