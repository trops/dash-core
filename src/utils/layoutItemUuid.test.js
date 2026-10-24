/**
 * A widget added in edit mode gets the uuid a reload gives it (QA
 * 2026-10-24): before, it was "<component>-<component>" until the dashboard
 * was saved and reloaded, so what it saved first went to a file never read
 * again, and two of the same widget shared one file.
 */
const fs = require("fs");
const path = require("path");
import { layoutItemUuid } from "./layoutItemUuid";

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("layoutItemUuid", () => {
  test("dashboard id, component, item id", () => {
    expect(layoutItemUuid(1792, "trops.dash-samples.NotepadWidget", 2)).toBe(
      "1792-trops.dash-samples.NotepadWidget-2",
    );
  });

  test("no dashboard id: component and item id", () => {
    expect(layoutItemUuid(undefined, "a.b.C", 3)).toBe("a.b.C-3");
    expect(layoutItemUuid(null, "a.b.C", 3)).toBe("a.b.C-3");
  });
});

describe("every way a widget is added uses it, after its id is set", () => {
  test("LayoutModel (a load) and addItemToItemLayout (an add)", () => {
    expect(read("../Models/LayoutModel.js")).toMatch(
      /layout\.uuid = layoutItemUuid\(dashboardId, layout\["component"\], layout\.id\);/,
    );
    const layout = read("layout.js");
    expect(layout).toMatch(
      /newItem\["id"\] = nextId;[\s\S]{0,400}newItem\["uuid"\] = layoutItemUuid\(dashboardId, newItem\["component"\], nextId\);/,
    );
  });

  test("DashboardModel's two add paths", () => {
    const src = read("../Models/DashboardModel.js");
    const hits =
      src.match(
        /childComponent\["id"\] = nextId;\s*childComponent\["uuid"\] = layoutItemUuid\(\s*this\.id,/g,
      ) || [];
    expect(hits).toHaveLength(2);
  });

  test("LayoutBuilder passes the dashboard id on each add", () => {
    const src = read("../Components/Layout/Builder/LayoutBuilder.js");
    const calls = src.match(/addItemToItemLayout\([\s\S]*?\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call).toMatch(/addToDashboardId\(\)/);
  });
});
