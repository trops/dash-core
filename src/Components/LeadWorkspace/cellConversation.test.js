/**
 * An empty cell's conversation (lead-workspace release 6c, frames 38, 39):
 * what it says, its plan for that cell, what changes, and the build.
 */
import { cellPlace, cellStart, makingAbout } from "./workspaceStart";
import {
  cellBuildPlan,
  fitsCell,
  planForCell,
  planLine,
  yesLabel,
} from "./workspacePlan";
import { buildChat, buildKind, buildOptions } from "./workspaceBuild";
import { planChanges } from "./planChanges";

const CELL = {
  workspaceId: 7,
  gridItemId: 3,
  cellNumber: "2.1",
  pageId: "p1",
  scope: "main",
};
const PLAN = {
  summary: "The weather",
  pieces: [
    {
      kind: "widget",
      name: "Weather",
      source: "registry",
      package: "@trops/weather",
    },
  ],
};

describe("what it says", () => {
  test("the cell's place, and its size when it spans", () => {
    expect(cellPlace(CELL)).toBe("the empty cell in row 2, column 1");
    expect(cellPlace({ ...CELL, span: { col: 2, row: 1 } })).toBe(
      "the empty cell in row 2, column 1 (2 × 1)",
    );
    expect(cellPlace({})).toBe("the empty cell");
  });

  test("For: the dashboard and the cell; the lead's greeting; the note", () => {
    const s = cellStart(CELL, {
      dashboardName: "Kitchen Sink",
      leadName: "Kitchen Sink Lead",
    });
    expect(s.label).toBe("For");
    expect(s.text).toBe("Kitchen Sink — the empty cell in row 2, column 1");
    expect(s.title).toBe("What should go in this cell?");
    expect(s.greeting).toMatch(
      /^Describe it, or pick one below\. Kitchen Sink Lead brings in the Dash team/,
    );
    expect(s.starters).toContain("The weather");
    expect(s.note).toMatch(/Plan exactly one widget for that cell/);
    expect(s.cell).toEqual({ ...CELL, dashboardName: "Kitchen Sink" });
    expect(makingAbout(s).cell).toEqual(s.cell);
  });

  test("no cell: nothing", () => {
    expect(cellStart(null)).toBeNull();
    expect(cellStart({ workspaceId: 7 })).toBeNull();
  });
});

describe("its plan", () => {
  const cell = { ...CELL, dashboardName: "Kitchen Sink" };

  test("is for that dashboard and cell; built without them", () => {
    const p = planForCell(PLAN, cell);
    expect(p.dashboard).toEqual({ id: "7", name: "Kitchen Sink" });
    expect(p.cell).toEqual({
      cellNumber: "2.1",
      gridItemId: 3,
      pageId: "p1",
      scope: "main",
    });
    expect(cellBuildPlan(p)).toEqual(PLAN);
    expect(planForCell(PLAN, null)).toBe(PLAN);
  });

  test("its words: Yes, add it; in the cell you picked", () => {
    const p = planForCell(PLAN, cell);
    expect(yesLabel(p)).toBe("Yes, add it");
    expect(planLine(p)).toBe("Plan · 1 added, in the cell you picked");
    expect(buildKind(p)).toBe("cell");
    expect(buildOptions("cell")).toEqual({ cell: true });
  });

  test("only the picked cell changes", () => {
    const ws = {
      id: 7,
      name: "Kitchen Sink",
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 3,
              component: "LayoutGridContainer",
              grid: {
                rows: 2,
                cols: 2,
                1.1: { component: 10 },
                1.2: { component: null },
                2.1: { component: null },
                2.2: { component: 11 },
              },
            },
            { id: 10, component: "trops.clock.Clock" },
            { id: 11, component: "trops.notes.Notes" },
          ],
        },
      ],
    };
    const c = planChanges(ws, planForCell(PLAN, cell));
    expect(c.cellOnly).toBe(true);
    expect(c.added).toBe(1);
    expect(c.after.flat().map((x) => `${x.key}:${x.kind}`)).toEqual([
      "1.1:keep",
      "1.2:empty",
      "2.1:add",
      "2.2:keep",
    ]);
    expect(c.rows).toEqual([
      {
        mark: "+",
        main: "Weather — in the empty cell, row 2",
        sub: "@trops/weather from the registry",
      },
    ]);
  });

  test("more than one widget, or a bot: doesn't fit — every piece listed", () => {
    const more = planForCell(
      {
        summary: "x",
        pieces: [
          { kind: "widget", name: "Calendar", source: "new" },
          { kind: "widget", name: "Weather", source: "new" },
          { kind: "bot", name: "Briefer", source: "new" },
        ],
      },
      cell,
    );
    expect(fitsCell(more)).toBe(false);
    expect(planLine(more)).toBe("Plan · doesn't fit one cell");
    const c = planChanges({ id: 7, layout: [] }, more);
    expect(c.fits).toBe(false);
    expect(c.added).toBe(0);
    expect(c.rows.map((r) => r.main)).toEqual([
      "Calendar — widget",
      "Weather — widget",
      "Briefer — bot",
    ]);
    expect(fitsCell(planForCell(PLAN, cell))).toBe(true);
  });

  test("a grid that isn't saved yet: the row, no drawing", () => {
    const c = planChanges(
      { id: 7, layout: [] },
      planForCell(PLAN, { ...cell, pageId: null }),
    );
    expect(c.added).toBe(0);
    expect(c.rows).toHaveLength(1);
  });
});

describe("its build", () => {
  const done = {
    status: "done",
    steps: [
      { kind: "install", label: "Install Weather", status: "done" },
      { kind: "preview", label: "Preview Weather", status: "done" },
    ],
  };
  const chat = (placed) =>
    buildChat(done, {
      kind: "cell",
      cell: { dashboardName: "Kitchen Sink", placed, canPlace: true },
    });

  test("in the cell: save the dashboard to keep it", () => {
    const c = chat(true);
    expect(c.reply).toBe(
      "Weather is in the cell you picked. Save Kitchen Sink to keep it.",
    );
    expect(c.card.sub).toBe("Widget · in the cell you picked");
  });

  test("being put in", () => {
    expect(chat("placing").reply).toMatch(/putting it in the cell/);
    expect(chat("placing").choices).toBeNull();
  });

  test("in the cell: Put it in again, for edits that were cancelled", () => {
    expect(chat(true).choices).toBe("place-again");
  });

  test("not being edited any more: says so, Put it in the cell", () => {
    const c = chat("preview");
    expect(c.reply).toMatch(/Kitchen Sink isn't being edited any more/);
    expect(c.choices).toBe("place");
  });

  test("no editor answered: open it on the page with that cell", () => {
    expect(chat("no-answer").reply).toMatch(/on the page with that cell/);
    expect(chat("no-answer").choices).toBe("place");
  });

  test("the cell was taken or is gone: says so; no Put it in", () => {
    expect(chat("taken").reply).toMatch(/isn't empty any more/);
    expect(chat("taken").choices).toBeNull();
    expect(chat("gone").reply).toMatch(/isn't there any more/);
    expect(chat("gone").choices).toBeNull();
  });

  test("not ready yet, or it went wrong: try again", () => {
    expect(chat("unknown-widget").choices).toBe("place");
    expect(chat("failed").reply).toMatch(/Try again/);
  });

  test("reopened, not known: Put it in the cell", () => {
    expect(chat(undefined).choices).toBe("place");
    expect(chat(undefined).reply).toMatch(
      /If it isn't in the cell you picked yet/,
    );
  });

  test("nothing to put in (no cell, or no widget made): no button", () => {
    const c = buildChat(done, {
      kind: "cell",
      cell: { dashboardName: "Kitchen Sink", canPlace: false },
    });
    expect(c.choices).toBeNull();
  });

  test("its preview says where it goes", () => {
    const c = buildChat(
      {
        status: "waiting-for-you",
        steps: [
          { kind: "preview", label: "Preview Weather", status: "needs-you" },
        ],
      },
      { kind: "cell" },
    );
    expect(c.reply).toMatch(/before it goes in the cell you picked\.$/);
  });
});

describe("a build nothing runs any more (saved before a restart, or from Create)", () => {
  const problems = {
    status: "finished-with-problems",
    dashboard: { id: "7", name: "Home" },
    steps: [
      {
        id: "install:0",
        kind: "install",
        label: "Install Clock",
        status: "failed",
        error: "it didn't install",
        canRetry: true,
      },
    ],
  };
  test("failed: Carry on building, not Try again", () => {
    const live = buildChat(problems, {});
    expect(live.choices).toBe("failed");
    const restored = buildChat(problems, { restored: true });
    expect(restored.choices).toBe("continue");
    expect(restored.continueLabel).toBe("Carry on building");
    expect(restored.reply).not.toMatch(/Try it again, or leave it off/);
    expect(restored.reply).toMatch(/saved before Dash last closed/);
  });
  test("waiting for a look at its preview: Carry on building too", () => {
    const ready = {
      status: "waiting-for-you",
      steps: [{ kind: "preview", label: "Preview Clock", status: "needs-you" }],
    };
    expect(buildChat(ready, { restored: true }).choices).toBe("continue");
  });
  test("done: nothing to carry on", () => {
    const done = {
      status: "done",
      dashboard: { id: "7", name: "Home" },
      steps: [],
    };
    expect(buildChat(done, { restored: true }).choices).toBe("open");
  });
});
