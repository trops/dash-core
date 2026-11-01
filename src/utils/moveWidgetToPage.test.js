import {
  moveWidgetToPage,
  firstFreeCell,
  pageOfWidget,
} from "./moveWidgetToPage";

const grid = (id, rows, cols, cells) => ({
  id,
  parent: 0,
  type: "grid",
  component: "LayoutGridContainer",
  grid: { rows, cols, gap: "gap-2", ...cells },
});

const player = {
  id: 2,
  parent: 1,
  type: "widget",
  component: "ai-built.player.Player",
  uuid: "u-player",
  userPrefs: { haBaseUrl: "http://10.0.0.107" },
  selectedProviders: { "home-assistant-mcp": "Home Assistant MCP" },
  listeners: { onTrack: ["u-lights[trackChanged]"] },
};

const dashboard = () => ({
  id: 9,
  name: "Smart Home",
  pages: [
    {
      id: "home",
      name: "Home",
      layout: [
        grid(1, 1, 2, {
          1.1: { component: 2, hide: false },
          1.2: { component: null, hide: false },
        }),
        {
          id: 2,
          parent: 1,
          type: "widget",
          component: "x.lights.Lights",
          uuid: "u-lights",
        },
      ],
    },
    {
      id: "music",
      name: "Music",
      layout: [grid(1, 1, 1, { 1.1: { component: 2, hide: false } }), player],
    },
  ],
});

test("moves with its uuid, settings, connection and listeners, into the first free cell", () => {
  const ws = dashboard();
  const r = moveWidgetToPage(ws, { uuid: "u-player", toPageId: "home" });
  expect(r.ok).toBe(true);
  expect(r.cell).toBe("1.2");
  const home = r.workspace.pages[0].layout;
  const moved = home.find((it) => it.uuid === "u-player");
  expect(moved).toEqual({
    ...player,
    id: 3, // the lights are 2 on Home
    parent: 1,
  });
  expect(home[0].grid["1.2"]).toEqual({ component: 3, hide: false });
  // Off Music, its cell empty.
  const music = r.workspace.pages[1].layout;
  expect(music.find((it) => it.uuid === "u-player")).toBeUndefined();
  expect(music[0].grid["1.1"]).toEqual({ component: null, hide: false });
  // Never changes what it was given.
  expect(ws.pages[1].layout).toHaveLength(2);
  expect(r.toPage.name).toBe("Home");
});

test("a full grid gets a new row at the bottom", () => {
  const ws = dashboard();
  ws.pages[0].layout[0].grid["1.2"] = { component: 2, hide: false };
  const r = moveWidgetToPage(ws, { uuid: "u-player", toPageId: "home" });
  expect(r.ok).toBe(true);
  const g = r.workspace.pages[0].layout[0].grid;
  expect(g.rows).toBe(2);
  expect(r.cell).toBe("2.1");
  expect(g["2.1"].component).toBe(3);
  expect(g["2.2"]).toEqual({ component: null, hide: false });
});

test("a hidden (merged) cell is never used", () => {
  expect(
    firstFreeCell({
      rows: 1,
      cols: 3,
      1.1: { component: 5, hide: false },
      1.2: { component: null, hide: true },
      1.3: { component: null, hide: false },
    }),
  ).toBe("1.3");
});

test("a container moves with what's inside it, ids and cells kept together", () => {
  const ws = dashboard();
  ws.pages[1].layout = [
    grid(1, 1, 1, { 1.1: { component: 2, hide: false } }),
    {
      id: 2,
      parent: 1,
      type: "grid",
      component: "LayoutGridContainer",
      uuid: "u-inner",
      grid: {
        rows: 1,
        cols: 2,
        1.1: { component: 3, hide: false },
        1.2: { component: 4, hide: false },
      },
    },
    { id: 3, parent: 2, type: "widget", component: "a.b.A", uuid: "u-a" },
    { id: 4, parent: 2, type: "widget", component: "a.b.B", uuid: "u-b" },
  ];
  const r = moveWidgetToPage(ws, { uuid: "u-inner", toPageId: "home" });
  expect(r.ok).toBe(true);
  const home = r.workspace.pages[0].layout;
  const inner = home.find((it) => it.uuid === "u-inner");
  const a = home.find((it) => it.uuid === "u-a");
  const b = home.find((it) => it.uuid === "u-b");
  expect(inner.parent).toBe(1);
  expect(a.parent).toBe(inner.id);
  expect(b.parent).toBe(inner.id);
  expect(inner.grid["1.1"].component).toBe(a.id);
  expect(inner.grid["1.2"].component).toBe(b.id);
  expect(new Set(home.map((it) => it.id)).size).toBe(home.length);
  expect(r.workspace.pages[1].layout).toHaveLength(1);
});

test("undo is the workspace before the move", () => {
  const before = dashboard();
  const r = moveWidgetToPage(before, { uuid: "u-player", toPageId: "home" });
  const back = moveWidgetToPage(r.workspace, {
    uuid: "u-player",
    toPageId: "music",
  });
  expect(back.ok).toBe(true);
  // Back on Music in its old cell, with everything it had.
  const music = back.workspace.pages[1].layout;
  const it = music.find((x) => x.uuid === "u-player");
  expect(it.userPrefs).toEqual(player.userPrefs);
  expect(music[0].grid["1.1"].component).toBe(it.id);
  // The snapshot itself is what the dashboard restores on Undo.
  expect(before.pages[1].layout[1]).toEqual(player);
});

test("says why it can't", () => {
  const ws = dashboard();
  expect(
    moveWidgetToPage(ws, { uuid: "nope", toPageId: "home" }).error,
  ).toMatch(/isn't on this dashboard/);
  expect(
    moveWidgetToPage(ws, { uuid: "u-player", toPageId: "music" }).error,
  ).toMatch(/already on that page/);
  expect(
    moveWidgetToPage(ws, { uuid: "u-player", toPageId: "x" }).error,
  ).toMatch(/page isn't on this dashboard/);
  expect(moveWidgetToPage({ id: 1 }, { uuid: "u", toPageId: "x" }).ok).toBe(
    false,
  );
});

test("which page a widget is on", () => {
  expect(pageOfWidget(dashboard(), { uuid: "u-player" }).page.id).toBe("music");
});
