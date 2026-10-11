import { describeEditChanges } from "./editChanges";

/**
 * What Cancel will discard (create-entry phase 1e, CRE-006 AC7): the
 * editor's staged dashboard compared with the copy taken on entering edit
 * mode, plus staged bot edits.
 */

const grid = (rows, cols, cells) => ({
  id: 1,
  parent: 0,
  component: "LayoutGridContainer",
  grid: { rows, cols, ...cells },
});
const widget = (id, component, extra = {}) => ({
  id,
  uuid: `u-${id}`,
  component,
  parent: 1,
  userPrefs: {},
  ...extra,
});

const original = {
  id: "ws1",
  name: "Inbox",
  themeKey: "dark",
  menuId: 1,
  layout: [
    grid(1, 2, { 1.1: { component: 2 }, 1.2: { component: 3 } }),
    widget(2, "Emails"),
    widget(3, "Clock"),
  ],
};
const nameOf = (w) => w.component;

function describe2(current, extra = {}) {
  return describeEditChanges({ original, current, nameOf, ...extra });
}

describe("describeEditChanges", () => {
  test("nothing changed", () => {
    expect(describe2(JSON.parse(JSON.stringify(original)))).toEqual({
      discarded: [],
      kept: [],
    });
  });

  test("dashboard name, theme and folder", () => {
    const r = describe2({
      ...original,
      name: "Inbox triage",
      themeKey: "light",
      menuId: 2,
    });
    expect(r.discarded).toEqual([
      'Renamed the dashboard to "Inbox triage"',
      "Changed the theme",
      "Moved it to another folder",
    ]);
  });

  test("added, removed and moved widgets; installs are kept", () => {
    const r = describe2({
      ...original,
      layout: [
        grid(2, 2, {
          1.1: { component: 3 },
          1.2: { component: null },
          2.1: { component: 4 },
        }),
        widget(3, "Clock"),
        widget(4, "Weather"),
      ],
    });
    expect(r.discarded).toEqual([
      "Added a row",
      "Added Weather",
      "Removed Emails",
      "Moved Clock",
    ]);
    expect(r.kept).toEqual([
      "Widgets you installed stay installed — only their place on this dashboard is undone.",
    ]);
  });

  test("a widget's settings", () => {
    const r = describe2({
      ...original,
      layout: [
        original.layout[0],
        widget(2, "Emails", { userPrefs: { title: "Mail" } }),
        original.layout[2],
      ],
    });
    expect(r.discarded).toEqual(["Changed Emails's settings"]);
  });

  test("staged bot edits", () => {
    const r = describe2(original, {
      pendingBotEdits: { b1: { id: "b1", name: "Triage" } },
    });
    expect(r.discarded).toEqual(['Changes to the bot "Triage"']);
  });

  test("paged dashboards compare pages, not the top-level mirror", () => {
    const paged = {
      ...original,
      layout: original.layout,
      pages: [{ id: "p1", name: "Main", layout: original.layout }],
    };
    const r = describeEditChanges({
      original: paged,
      current: {
        ...paged,
        layout: [],
        pages: [paged.pages[0], { id: "p2", name: "Reports", layout: [] }],
      },
      nameOf,
    });
    expect(r.discarded).toEqual(['Added page "Reports"']);
  });

  test("anything else is summed up rather than missed", () => {
    const r = describe2({
      ...original,
      layout: [
        { ...original.layout[0], scrollable: true },
        ...original.layout.slice(1),
      ],
    });
    expect(r.discarded).toEqual(["Other layout changes"]);
  });

  test("long lists end with a count", () => {
    const many = Array.from({ length: 12 }, (_, i) => widget(10 + i, `W${i}`));
    const r = describe2({
      ...original,
      layout: [...original.layout, ...many],
    });
    expect(r.discarded).toHaveLength(9);
    expect(r.discarded[8]).toBe("…and 4 more");
  });
});
