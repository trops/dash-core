/**
 * fingerprint.test.js — what a dashboard, theme, bot or team is as
 * published: the same unless something that would be published changes.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { publishFingerprint, changedSince } = require("./fingerprint");

const dash = (extra = {}) => ({
  id: 1,
  name: "Home",
  menuId: 2,
  themeKey: "Ocean",
  updatedAt: "2026-10-27T00:00:00Z",
  layout: [
    {
      id: 3,
      uuid: "u3",
      component: "trops.ha.Lights",
      userPrefs: { room: "Kitchen" },
      selectedProviders: { ha: "Home" },
    },
  ],
  ...extra,
});

describe("publishFingerprint — dashboards", () => {
  it("ignores where it is here and the user's own settings", () => {
    const a = publishFingerprint("dashboard", dash());
    const b = publishFingerprint(
      "dashboard",
      dash({
        id: 99,
        name: "Renamed",
        menuId: 5,
        themeKey: "Other",
        updatedAt: "2026-11-01T00:00:00Z",
        registryRef: { package: "@trops/home" },
        _dashboardConfig: { shareable: false },
        remixedFrom: { package: "@alice/home" },
        layout: [
          {
            id: 3,
            uuid: "u3",
            component: "trops.ha.Lights",
            userPrefs: { room: "Office" },
            selectedProviders: { ha: "Work" },
          },
        ],
      }),
    );
    assert.equal(a, b);
  });

  it("changes when the layout changes", () => {
    const moved = dash({
      layout: [{ id: 3, uuid: "u3", component: "trops.ha.Switches" }],
    });
    assert.notEqual(
      publishFingerprint("dashboard", dash()),
      publishFingerprint("dashboard", moved),
    );
  });
});

describe("publishFingerprint — themes, bots, teams", () => {
  it("a theme's colours, not its publish record or version", () => {
    const t = { name: "Ocean", primary: "blue" };
    assert.equal(
      publishFingerprint("theme", t),
      publishFingerprint("theme", {
        ...t,
        version: "2.0.0",
        _registryMeta: { packageName: "trops/ocean" },
        registryRef: { package: "@trops/ocean" },
      }),
    );
    assert.notEqual(
      publishFingerprint("theme", t),
      publishFingerprint("theme", { ...t, primary: "teal" }),
    );
  });

  it("a bot's instructions and schedule, not how it runs here", () => {
    const b = { name: "Brief", instructions: "Summarize", schedules: [] };
    assert.equal(
      publishFingerprint("bot", b),
      publishFingerprint("bot", {
        ...b,
        id: "bot_x",
        mcpServers: ["Home"],
        allowedTools: ["x"],
        session: { id: 1 },
      }),
    );
    assert.notEqual(
      publishFingerprint("bot", b),
      publishFingerprint("bot", { ...b, instructions: "Summarize daily" }),
    );
  });

  it("a bot's wiring and approval policy count", () => {
    const b = {
      name: "B",
      instructions: "x",
      approvalPolicy: "ask",
      subscriptions: [],
    };
    const fp = publishFingerprint("bot", b);
    assert.notEqual(
      fp,
      publishFingerprint("bot", { ...b, approvalPolicy: "auto" }),
    );
    assert.notEqual(
      fp,
      publishFingerprint("bot", {
        ...b,
        subscriptions: [{ source: { event: "done" } }],
      }),
    );
  });

  it("a team's bots in any order", () => {
    const a = { name: "A", instructions: "a" };
    const c = { name: "C", instructions: "c" };
    assert.equal(
      publishFingerprint("bot-team", [a, c]),
      publishFingerprint("bot-team", [c, a]),
    );
  });
});

describe("changedSince", () => {
  it("compares with the fingerprint recorded then; null without one", () => {
    const ref = { contentHash: publishFingerprint("dashboard", dash()) };
    assert.equal(changedSince("dashboard", dash({ name: "X" }), ref), false);
    assert.equal(changedSince("dashboard", dash({ layout: [] }), ref), true);
    assert.equal(changedSince("dashboard", dash(), { package: "@a/b" }), null);
    assert.equal(changedSince("dashboard", dash(), null), null);
  });
});
