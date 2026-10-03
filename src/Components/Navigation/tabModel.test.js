import { closeTab, openPageTab, restoreTabs } from "./tabModel";

const ws = (id, name) => ({ id, name });
const dashTab = (w) => ({ id: w.id, name: w.name, workspace: w });

describe("tabModel (app-navigation NAV-002)", () => {
  describe("openPageTab", () => {
    it("adds a page tab after the open tabs and makes it active", () => {
      const tabs = [dashTab(ws(1, "Kitchen Sink"))];
      const r = openPageTab(tabs, "bots");
      expect(r.tabs.map((t) => t.id)).toEqual([1, "page:bots"]);
      expect(r.activeTabId).toBe("page:bots");
      expect(r.tabs[1].workspace).toBeUndefined();
    });

    it("one tab per page: an open page is only switched to", () => {
      const tabs = [
        dashTab(ws(1, "A")),
        { id: "page:bots", kind: "page", pageKey: "bots", name: "Bots" },
      ];
      const r = openPageTab(tabs, "bots");
      expect(r.tabs).toBe(tabs);
      expect(r.activeTabId).toBe("page:bots");
    });

    it("ignores unknown pages", () => {
      const tabs = [dashTab(ws(1, "A"))];
      const r = openPageTab(tabs, "nope");
      expect(r.tabs).toBe(tabs);
      expect(r.activeTabId).toBeNull();
    });
  });

  describe("closeTab", () => {
    const tabs = [
      dashTab(ws(1, "A")),
      { id: "page:bots", kind: "page", pageKey: "bots", name: "Bots" },
      dashTab(ws(2, "B")),
    ];

    it("closing the active tab activates the last remaining one", () => {
      const r = closeTab(tabs, "page:bots", "page:bots");
      expect(r.tabs.map((t) => t.id)).toEqual([1, 2]);
      expect(r.activeTabId).toBe(2);
    });

    it("closing a background tab keeps the active one", () => {
      const r = closeTab(tabs, 1, "page:bots");
      expect(r.activeTabId).toBe("page:bots");
    });

    it("closing the last tab leaves nothing active", () => {
      const r = closeTab([tabs[1]], "page:bots", "page:bots");
      expect(r.tabs).toEqual([]);
      expect(r.activeTabId).toBeNull();
    });
  });

  describe("restoreTabs", () => {
    const workspaces = [ws(1, "Kitchen Sink"), ws(2, "Sales")];

    it("restores dashboards and pages in saved order; drops unknown ids", () => {
      const r = restoreTabs(
        [2, "page:providers", 99, "page:nope", 1],
        workspaces,
      );
      expect(r.map((t) => t.id)).toEqual([2, "page:providers", 1]);
      expect(r[0].workspace).toBe(workspaces[1]);
      expect(r[1]).toEqual({
        id: "page:providers",
        kind: "page",
        pageKey: "providers",
        name: "Providers",
      });
    });

    it("tolerates a missing list", () => {
      expect(restoreTabs(undefined, workspaces)).toEqual([]);
    });
  });
});
