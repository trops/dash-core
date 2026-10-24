import { closeTab, openPageTab, restoreTabs, syncTabs } from "./tabModel";

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

describe("syncTabs — tabs follow the dashboards (QA 2026-10-22)", () => {
  const pageTab = {
    id: "page:bots",
    kind: "page",
    pageKey: "bots",
    name: "Bots",
  };

  it("a deleted dashboard's tab closes; the active one moves to the last tab", () => {
    const tabs = [dashTab(ws(1, "Inbox")), pageTab, dashTab(ws(2, "Sales"))];
    const out = syncTabs(tabs, [ws(1, "Inbox")], 2);
    expect(out.tabs.map((t) => t.id)).toEqual([1, "page:bots"]);
    expect(out.activeTabId).toBe("page:bots");
  });

  it("open tabs take the fresh data and keep the active tab", () => {
    const out = syncTabs([dashTab(ws(1, "Inbox"))], [ws("1", "Mail")], 1);
    expect(out.tabs[0].name).toBe("Mail");
    expect(out.tabs[0].workspace).toEqual(ws("1", "Mail"));
    expect(out.activeTabId).toBe(1);
  });

  it("a dashboard that was never saved (loaded from a file) keeps its tab", () => {
    const out = syncTabs([dashTab(ws(5, "From file"))], [], 5, [5]);
    expect(out.tabs.map((t) => t.id)).toEqual([5]);
    expect(out.activeTabId).toBe(5);
  });

  it("closing the only tab leaves none active", () => {
    expect(syncTabs([dashTab(ws(3, "Old"))], [], 3)).toEqual({
      tabs: [],
      activeTabId: null,
    });
  });
});
