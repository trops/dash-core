/**
 * modelUsage.test.js — finding saved choices of a retired model, and the
 * saved changes that move them all.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  savedChoices,
  retiredUsage,
  moveTarget,
  planMove,
  widgetsOf,
} = require("./modelUsage");

const RETIRED = "claude-sonnet-4-20250514";

// Odd ids: a Model of the "model" type; even: an older list of versions.
const chat = (id, model) => ({
  id,
  uuid: `u-${id}`,
  component: "trops.chat.ChatClaudeCodeWidget",
  userPrefs: { model, title: "Chat" },
  widgetConfig: {
    userConfig: { model: { type: id % 2 ? "model" : "select" } },
  },
});

function input() {
  const paged = {
    id: 1,
    name: "Kitchen Sink",
    // The top-level layout mirrors the active page.
    layout: [chat(1, RETIRED), chat(2, RETIRED)],
    pages: [
      { id: "p1", layout: [chat(1, RETIRED), chat(2, RETIRED)] },
      { id: "p2", layout: [chat(3, RETIRED), { id: 9, component: "Clock" }] },
    ],
  };
  const flat = {
    id: 2,
    name: "Workshop Command Center",
    layout: [
      chat(4, RETIRED),
      chat(5, "latest:sonnet"),
      chat(6, "claude-haiku-5-5"),
    ],
  };
  return {
    settings: {
      ai: {
        defaults: {
          bots: { model: "claude-haiku-5-5" },
          planner: { model: RETIRED },
        },
      },
      dashTeam: { models: { "claude-code": { builder: RETIRED } } },
    },
    bots: [
      { id: "b1", name: "Recipe Bot", model: RETIRED },
      { id: "b2", name: "Agenda", model: null },
    ],
    workspaces: [paged, flat],
  };
}

describe("modelUsage", () => {
  it("counts a paged dashboard's widgets once", () => {
    assert.equal(widgetsOf(input().workspaces[0]).length, 4);
  });

  it("finds every saved choice", () => {
    const kinds = savedChoices(input()).map((c) => c.kind);
    assert.deepEqual(
      kinds.sort(),
      [
        "bot",
        "default",
        "default",
        "teamPick",
        "widget",
        "widget",
        "widget",
        "widget",
        "widget",
        "widget",
      ].sort(),
    );
  });

  it("a retired model moves to the newest of its family", () => {
    assert.equal(moveTarget(RETIRED), "latest:sonnet");
    assert.equal(moveTarget("claude-haiku-5-5"), null);
    assert.equal(moveTarget("claude-gone-entirely"), null);
  });

  it("groups what's still on a retired model", () => {
    const [u] = retiredUsage(input());
    assert.equal(u.model, RETIRED);
    assert.equal(u.to, "latest:sonnet");
    assert.equal(u.count, 7);
    assert.deepEqual(u.kinds, { default: 1, bot: 1, teamPick: 1, widget: 4 });
    // u-2 and u-4 list versions: they'll get the exact model.
    assert.equal(u.exactWidgets, 2);
    assert.deepEqual(
      u.dashboards.map((d) => [d.name, d.count]),
      [
        ["Kitchen Sink", 3],
        ["Workshop Command Center", 1],
      ],
    );
  });

  it("plans the saved changes, both copies of a paged dashboard included", () => {
    const plan = planMove(input(), RETIRED, "latest:sonnet");
    assert.equal(plan.count, 7);
    assert.deepEqual(plan.aiDefaults, { planner: { model: "latest:sonnet" } });
    assert.deepEqual(plan.bots, [{ id: "b1", model: "latest:sonnet" }]);
    assert.equal(plan.teamPicks["claude-code"].builder, "latest:sonnet");
    const [paged, flat] = plan.workspaces;
    // A Model that lists versions gets the exact model, so it still shows.
    assert.deepEqual(
      paged.layout.map((i) => i.userPrefs.model),
      ["latest:sonnet", "claude-sonnet-5-5"],
    );
    assert.deepEqual(
      paged.pages[0].layout.map((i) => i.userPrefs.model),
      ["latest:sonnet", "claude-sonnet-5-5"],
    );
    assert.equal(paged.pages[1].layout[0].userPrefs.model, "latest:sonnet");
    assert.equal(paged.pages[1].layout[1].component, "Clock");
    assert.deepEqual(
      flat.layout.map((i) => i.userPrefs.model),
      ["claude-sonnet-5-5", "latest:sonnet", "claude-haiku-5-5"],
    );
    // Other settings on a widget stay.
    assert.equal(flat.layout[0].userPrefs.title, "Chat");
  });

  it("leaves widgets with no id alone", () => {
    const ws = {
      id: 3,
      name: "No ids",
      layout: [
        { component: "Chat", userPrefs: { model: RETIRED } },
        { component: "Chat", userPrefs: { model: RETIRED } },
      ],
    };
    const plan = planMove(
      { settings: {}, bots: [], workspaces: [ws] },
      RETIRED,
      "latest:sonnet",
    );
    assert.equal(plan.count, 0);
    assert.deepEqual(plan.workspaces, []);
  });

  it("marks dashboards the open profile doesn't show", () => {
    const [u] = retiredUsage({ ...input(), activeIds: new Set(["2"]) });
    assert.deepEqual(
      u.dashboards.map((d) => [d.name, d.otherProfile]),
      [
        ["Kitchen Sink", true],
        ["Workshop Command Center", false],
      ],
    );
  });

  it("Latest for all: widgets that list versions get it too", () => {
    const plan = planMove(input(), RETIRED, "latest:sonnet", { forAll: true });
    assert.equal(plan.exact, 0);
    const models = plan.workspaces.flatMap((w) =>
      [w.layout, ...(w.pages || []).map((p) => p.layout)]
        .flat()
        .filter((i) => i.userPrefs)
        .map((i) => i.userPrefs.model),
    );
    assert.ok(!models.includes("claude-sonnet-5-5"));
    // Without it, the two that list versions get the exact model.
    assert.equal(planMove(input(), RETIRED, "latest:sonnet").exact, 2);
  });
});
