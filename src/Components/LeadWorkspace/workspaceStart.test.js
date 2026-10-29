/**
 * workspaceStart (lead-workspace release 6c, frames 41, 42): what a page's
 * New says, and the registry's dashboards as Start from lists them.
 */
import {
  makingStart,
  makingAbout,
  registryDashboards,
  registrySeed,
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
    expect(makingStart({ kind: "theme" })).toBeNull();
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
