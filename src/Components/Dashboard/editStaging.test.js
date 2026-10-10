import { syncLayoutRefs } from "./editStaging";

/**
 * Edit-mode staging (create-entry CRE-006 AC6): while a dashboard is being
 * edited, every change waits for Save. Save reads each page's layout and the
 * pinned sidebar's layout from refs, so a staged change must reach those refs
 * too — otherwise Save writes the stale layout and the change is lost.
 */
describe("syncLayoutRefs", () => {
  const refs = () => ({
    pageRefsMap: { current: {} },
    sidebarWorkspaceRef: { current: null },
  });

  test("mirrors every page's layout into its page ref", () => {
    const r = refs();
    r.pageRefsMap.current.p1 = { current: { layout: ["old"], extra: 1 } };
    syncLayoutRefs(
      {
        pages: [
          { id: "p1", layout: ["a"] },
          { id: "p2", layout: ["b"] },
        ],
      },
      r,
    );
    expect(r.pageRefsMap.current.p1.current).toEqual({
      layout: ["a"],
      extra: 1,
    });
    expect(r.pageRefsMap.current.p2.current).toEqual({ layout: ["b"] });
  });

  test("keeps the same ref object a LayoutBuilder already holds", () => {
    const r = refs();
    const held = { current: { layout: ["old"] } };
    r.pageRefsMap.current.p1 = held;
    syncLayoutRefs({ pages: [{ id: "p1", layout: ["a"] }] }, r);
    expect(r.pageRefsMap.current.p1).toBe(held);
    expect(held.current.layout).toEqual(["a"]);
  });

  test("mirrors the pinned sidebar's layout", () => {
    const r = refs();
    r.sidebarWorkspaceRef.current = { layout: ["old"], width: 300 };
    syncLayoutRefs({ sidebarLayout: ["s"] }, r);
    expect(r.sidebarWorkspaceRef.current).toEqual({
      layout: ["s"],
      width: 300,
    });
  });

  test("ignores pages without an id or layout, and missing input", () => {
    const r = refs();
    syncLayoutRefs({ pages: [null, { id: "x" }, { layout: [] }] }, r);
    expect(r.pageRefsMap.current).toEqual({});
    expect(() => syncLayoutRefs(null, r)).not.toThrow();
    expect(r.sidebarWorkspaceRef.current).toBeNull();
  });
});
