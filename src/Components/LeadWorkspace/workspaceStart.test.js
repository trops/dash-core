/**
 * workspaceStart (lead-workspace release 6c, frames 41, 42): what a page's
 * New says, and the registry's dashboards as Start from lists them.
 */
import {
  makingStart,
  makingAbout,
  registryDashboards,
  registrySeed,
  waysFor,
  widgetStart,
  widgetWire,
  wireSamples,
} from "./workspaceStart";
import { seedConversation } from "./workspacePlan";

describe("makingStart", () => {
  test.each([
    ["widget", "widgets", "a widget — from the Widgets page"],
    ["bot", "bots", "a bot — from the Bots page"],
    ["dashboard", "dashboards", "a dashboard — from the Dashboards page"],
  ])("%s from %s", (kind, from, text) => {
    const s = makingStart({ kind, from });
    expect(s.label).toBe("Making");
    expect(s.text).toBe(text);
    expect(s.starters).toHaveLength(4);
  });

  test("without a page it just says what", () => {
    expect(makingStart({ kind: "bot" }).text).toBe("a bot");
  });

  test("anything else: nothing", () => {
    expect(makingStart(null)).toBeNull();
    expect(makingStart({ kind: "font" })).toBeNull();
  });

  test("the Themes page's Describe it: a theme (theme round, frame 44)", () => {
    const m = makingStart({ kind: "theme", from: "themes" });
    expect(m.text).toBe("a theme — from the Themes page");
    expect(m.note).toBe("(The user wants to make a theme — plan a theme.)");
    expect(m.starters).toContain("Warm autumn colors, dark");
  });

  test("saved as the conversation's about: its line and note", () => {
    expect(makingAbout(makingStart({ kind: "widget" }))).toEqual({
      label: "Making",
      text: "a widget",
      note: "(The user wants to make a widget — plan a widget.)",
    });
    expect(makingAbout(null)).toBeNull();
  });
});

describe("registryDashboards", () => {
  test("public dashboards only, with what they make and need", () => {
    const list = registryDashboards({
      packages: [
        {
          type: "dashboard",
          scope: "trops",
          name: "aws-costs",
          widgets: [{}, {}],
          team: { members: [{}] },
          providerTypes: ["aws"],
        },
        { type: "dashboard", scope: "trops", name: "plain" },
        { type: "dashboard", name: "mine", visibility: "private" },
        { type: "widget", name: "clock" },
      ],
    });
    expect(list.map((d) => d.packageName)).toEqual(["aws-costs", "plain"]);
    expect(list[0].sub).toMatch(/^trops · 2 widgets · 1 bot · needs /);
    expect(list[1].sub).toBe("trops");
  });

  test("an array index works too; nothing is nothing", () => {
    expect(registryDashboards([{ type: "dashboard", name: "a" }])).toHaveLength(
      1,
    );
    expect(registryDashboards(null)).toEqual([]);
  });
});

describe("registrySeed", () => {
  test("becomes a conversation: what you picked, read from the registry, the lead asks", () => {
    const seed = registrySeed(
      { name: "Home", packageName: "home" },
      {
        name: "Home",
        workspace: { layout: [{ id: 1, component: "trops.clock.Clock" }] },
        widgets: [{ scope: "trops", packageName: "clock" }],
      },
    );
    const msgs = seedConversation(seed);
    expect(msgs.map((m) => m.who)).toEqual(["you", "step", "role"]);
    expect(msgs[1]).toMatchObject({ bot: "the registry", label: "Read Home" });
    expect(msgs[1].plan.pieces[0]).toMatchObject({
      kind: "widget",
      package: "@trops/clock",
    });
    expect(msgs[2].text).toMatch(/Want me to set it up\?/);
  });

  test("Open as a plan keeps its own words", () => {
    const msgs = seedConversation({ plan: { summary: "A plan", pieces: [] } });
    expect(msgs[0]).toMatchObject({ bot: "the Planner" });
    expect(msgs[1].text).toMatch(/your chat with the Planner/);
  });
});

describe("making a bot or a dashboard: one way to start at a time", () => {
  test("a bot: Ask AI, then the registry, a copy, a blank form, a file", () => {
    const w = waysFor("bot");
    expect(w.title).toBe("How do you want to make the bot?");
    expect(w.ai.title).toBe("Ask AI");
    expect(w.from.map((s) => [s.way, s.title])).toEqual([
      ["registry", "A bot from the registry"],
      ["copy", "Copy one of your bots"],
      ["blank", "A blank bot"],
      ["file", "A bot file"],
    ]);
  });
  test("a dashboard: the same ways", () => {
    const w = waysFor("dashboard");
    expect(w.title).toBe("How do you want to make the dashboard?");
    expect(w.from.map((s) => s.way)).toEqual([
      "registry",
      "copy",
      "blank",
      "file",
    ]);
  });
  test("anything else starts in the box", () => {
    expect(waysFor("widget")).toBeNull();
    expect(waysFor("theme")).toBeNull();
  });
});

describe("a bot's dashboard in the conversation", () => {
  test("from a dashboard's Add bot: set, never asked", () => {
    const m = makingStart({
      kind: "bot",
      from: "dashboard",
      target: { id: "7", name: "Life HQ" },
    });
    expect(m.text).toBe("a bot — for the Life HQ dashboard");
    expect(m.note).toBe(
      '(The user wants to make a bot for their "Life HQ" dashboard — plan one bot with "dashboard": {"id": "7", "name": "Life HQ"}; don\'t ask which dashboard.)',
    );
  });
  test("on no dashboard", () => {
    const m = makingStart({
      kind: "bot",
      from: "bots",
      target: { none: true },
    });
    expect(m.text).toBe("a bot — on no dashboard");
    expect(m.note).toBe(
      "(The user wants to make a bot on no dashboard — plan one bot and leave dashboard out; don't ask which dashboard.)",
    );
  });
  test("not said yet: the Planner asks — one of theirs or none, never new", () => {
    const m = makingStart({ kind: "bot", from: "bots" });
    expect(m.text).toBe("a bot — from the Bots page");
    expect(m.note).toBe(
      "(The user wants to make a bot — plan a bot. Ask which of their dashboards it goes on, or no dashboard; a bot never makes a new dashboard.)",
    );
  });
});

describe("a widget that shows what a bot sends (TD-009)", () => {
  const wire = {
    botId: "bot_shop",
    botName: "Shopping Helper",
    ref: "local/shopping-helper",
    event: "completed",
    eventLabel: "Completed",
    handlerName: "showShoppingHelperAnswer",
    ask: "Show each item with its picture.",
  };
  const target = {
    component: "ai-built.shoppinglist.ShoppingList",
    componentName: "ShoppingList",
    displayName: "Shopping List",
    package: "@ai-built/shoppinglist",
    config: { userConfig: { title: { type: "text" } } },
  };
  const door = {
    component: target.component,
    itemId: "11",
    workspaceId: "7",
    wire,
  };

  test("widgetWire keeps a whole wire, else null", () => {
    expect(widgetWire(wire)).toEqual(wire);
    expect(widgetWire({ ...wire, handlerName: "" })).toBeNull();
    expect(widgetWire(null)).toBeNull();
  });
  test("the conversation is about showing the bot, with no starters", () => {
    const s = widgetStart(door, {
      target,
      mode: "update",
      dashboardName: "Life HQ",
    });
    expect(s.text).toBe(
      "Shopping List on Life HQ — to show what Shopping Helper sends",
    );
    expect(s.title).toBe(
      "What should Shopping List show from Shopping Helper?",
    );
    expect(s.starters).toEqual([]);
    expect(s.widget.wire).toEqual(wire);
  });
  test("the lead's note: real answers, the listener's name, never a settings change or an id check", () => {
    const { note } = widgetStart(door, {
      target,
      mode: "update",
      dashboardName: "Life HQ",
    });
    expect(note).toMatch(/bot_answers/);
    expect(note).toMatch(/listener named showShoppingHelperAnswer/);
    expect(note).toMatch(
      /don't look it up, check its id or ask the user about it/,
    );
    expect(note).toMatch(/not a settings change/);
    expect(note).not.toMatch(/source "settings"/);
  });
  test("not on a dashboard: an ordinary change", () => {
    const s = widgetStart(
      { ...door, itemId: null },
      { target, mode: "update" },
    );
    expect(s.widget.wire).toBeUndefined();
    expect(s.title).toBe("What should change in Shopping List?");
  });
  test("where the samples are, by event", () => {
    expect(wireSamples(wire)).toMatch(/bot_answers/);
    expect(wireSamples({ ...wire, event: "result.list" })).toMatch(
      /bot_results/,
    );
    expect(wireSamples({ ...wire, event: "failed" })).toMatch(/message\.error/);
    expect(wireSamples({ ...wire, event: "tool.notes.write" })).toMatch(
      /message\.result/,
    );
  });
});
