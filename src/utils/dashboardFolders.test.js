import {
  ALL_DASHBOARDS,
  NOT_IN_A_FOLDER,
  dashboardsIn,
  folderIcon,
  folderOf,
  newestFirst,
  sameId,
  sortedFolders,
  withFolder,
} from "./dashboardFolders";

const folders = [
  { id: 1771967356638, name: "test" },
  { id: 1772547938413, name: "Comms", icon: "envelope" },
  { id: 1777165825716, name: "Sink Testing", icon: "folder" },
];
const dashboards = [
  { id: 1, name: "Kitchen Sink", menuId: "1777165825716" },
  { id: 2, name: "Slack test", menuId: 1772547938413 },
  { id: 3, name: "Smart Home", menuId: 1 },
  { id: 4, name: "SE Index Audit", menuId: "1771967356638" },
  { id: 5, name: "Loose", menuId: null },
];

describe("dashboardFolders", () => {
  test("ids saved as text match folders saved as numbers", () => {
    expect(sameId(1777165825716, "1777165825716")).toBe(true);
    expect(sameId(null, null)).toBe(false);
    expect(folderOf(dashboards[0], folders).name).toBe("Sink Testing");
    expect(folderOf(dashboards[3], folders).name).toBe("test");
  });

  test("a folder that's gone, or none, is not in a folder", () => {
    expect(folderOf(dashboards[2], folders)).toBeNull();
    expect(folderOf(dashboards[4], folders)).toBeNull();
    expect(
      dashboardsIn(NOT_IN_A_FOLDER, dashboards, folders).map((d) => d.name),
    ).toEqual(["Smart Home", "Loose"]);
  });

  test("all, and one folder by either kind of id", () => {
    expect(dashboardsIn(ALL_DASHBOARDS, dashboards, folders)).toHaveLength(5);
    expect(
      dashboardsIn("1772547938413", dashboards, folders).map((d) => d.name),
    ).toEqual(["Slack test"]);
    expect(
      dashboardsIn(1777165825716, dashboards, folders).map((d) => d.name),
    ).toEqual(["Kitchen Sink"]);
  });

  test("folders A–Z, icon fallback", () => {
    expect(sortedFolders(folders).map((f) => f.name)).toEqual([
      "Comms",
      "Sink Testing",
      "test",
    ]);
    expect(folderIcon(folders[0])).toBe("folder");
    expect(folderIcon(folders[1])).toBe("envelope");
    expect(folderIcon({ folder: "star" })).toBe("star");
  });

  test("newest first from numbers or dates; undated keep their order", () => {
    const list = [
      { name: "a" },
      { name: "b", updatedAt: "2026-11-13T13:36:41.017Z" },
      { name: "c", updatedAt: Date.parse("2026-11-14T12:50:07.953Z") },
      { name: "d" },
    ];
    expect(newestFirst(list).map((x) => x.name)).toEqual(["c", "b", "a", "d"]);
  });

  test("older dashboards sort by the save time kept in version", () => {
    const list = [
      { name: "old", version: 1774375282121 },
      { name: "v1", version: 1 },
      { name: "new", updatedAt: "2026-11-14T12:50:07.953Z" },
    ];
    expect(newestFirst(list).map((x) => x.name)).toEqual(["new", "old", "v1"]);
  });

  test("moving keeps the folder's own id; null takes it out", () => {
    expect(withFolder(dashboards[2], folders[1]).menuId).toBe(1772547938413);
    expect(withFolder(dashboards[1], null).menuId).toBeNull();
  });
});
