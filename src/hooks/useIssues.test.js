import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useIssues,
  useIssueCounts,
  useWidgetIssues,
  isIssueOfWidget,
  __resetIssuesStore,
} from "./useIssues";

const widgetIssue = {
  id: "i1",
  status: "open",
  severity: "problem",
  title: "Shopping List: Notes MCP › search_notes failed",
  asset: {
    kind: "widget",
    name: "Shopping List",
    component: "acme.notes.ShoppingList",
    itemId: "7-a-3",
    workspaceId: "7",
  },
  count: 2,
  lastAt: "2026-11-11T08:02:00.000Z",
};
const botIssue = {
  id: "i2",
  status: "open",
  severity: "warning",
  title: "Morning Summary: Gmail wasn't connected",
  asset: { kind: "bot", name: "Morning Summary", botId: "b1" },
  count: 1,
  lastAt: "2026-11-11T07:36:00.000Z",
};
const resolvedIssue = {
  id: "i3",
  status: "resolved",
  severity: "problem",
  title: "Notes MCP couldn't start",
  asset: { kind: "provider", provider: "Notes MCP" },
  count: 1,
  lastAt: "2026-11-10T07:00:00.000Z",
};

function setup(initial = [widgetIssue, botIssue, resolvedIssue]) {
  let all = initial;
  const listeners = new Map();
  let n = 0;
  const api = {
    list: jest.fn(async (f = {}) =>
      all.filter(
        (i) =>
          (f.status === "all" || i.status === (f.status || "open")) &&
          (!f.kind || i.asset.kind === f.kind) &&
          (f.workspaceId == null ||
            String(i.asset.workspaceId) === String(f.workspaceId)),
      ),
    ),
    counts: jest.fn(),
  };
  window.mainApi = {
    issues: api,
    on: jest.fn((channel, fn) => {
      const id = `l${++n}`;
      listeners.set(id, { channel, fn });
      return id;
    }),
    removeListener: jest.fn((channel, id) => listeners.delete(id)),
  };
  return {
    api,
    listeners,
    set: (next) => {
      all = next;
    },
    emit: async () => {
      for (const { channel, fn } of [...listeners.values()]) {
        if (channel === "issues:changed") fn({}, { counts: {} });
      }
    },
  };
}

afterEach(() => {
  __resetIssuesStore();
  delete window.mainApi;
});

describe("useIssues (issues PRD)", () => {
  it("lists issues by filter and re-reads on issues:changed", async () => {
    const t = setup();
    const { result } = renderHook(() => useIssues({ status: "open" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.issues.map((i) => i.id)).toEqual(["i1", "i2"]);

    t.set([widgetIssue]);
    await act(async () => t.emit());
    await waitFor(() =>
      expect(result.current.issues.map((i) => i.id)).toEqual(["i1"]),
    );
  });

  it("passes kind and dashboard to the main process", async () => {
    const t = setup();
    const { result } = renderHook(() =>
      useIssues({ status: "open", kind: "widget", workspaceId: "7" }),
    );
    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(t.api.list).toHaveBeenCalledWith({
      status: "open",
      kind: "widget",
      workspaceId: "7",
    });
  });

  it("stops listening when unmounted", async () => {
    const t = setup();
    const { unmount } = renderHook(() => useIssues({}));
    await waitFor(() => expect(t.listeners.size).toBeGreaterThan(0));
    unmount();
    expect(t.listeners.size).toBe(0);
  });

  it("works without the Issues api (nothing to show)", async () => {
    window.mainApi = {};
    const { result } = renderHook(() => useIssues({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.issues).toEqual([]);
  });
});

describe("useIssueCounts", () => {
  it("counts open issues per kind and follows changes", async () => {
    const t = setup();
    const { result } = renderHook(() => useIssueCounts());
    await waitFor(() => expect(result.current.total).toBe(2));
    expect(result.current).toEqual({
      total: 2,
      widget: 1,
      bot: 1,
      provider: 0,
    });
    t.set([]);
    await act(async () => t.emit());
    await waitFor(() => expect(result.current.total).toBe(0));
  });

  it("shares one subscription between many readers", async () => {
    const t = setup();
    renderHook(() => {
      useIssueCounts();
      useWidgetIssues("acme.notes.ShoppingList", "7-a-3", "7");
      useWidgetIssues("acme.notes.Other", "1", "7");
    });
    await waitFor(() => expect(t.api.list).toHaveBeenCalled());
    expect(t.listeners.size).toBe(1);
  });
});

describe("useWidgetIssues", () => {
  it("returns the open issues of one widget copy", async () => {
    setup();
    const { result } = renderHook(() =>
      useWidgetIssues("acme.notes.ShoppingList", "7-a-3", 7),
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("i1");
  });

  it("another copy of the same widget has none", async () => {
    const t = setup();
    const { result } = renderHook(() =>
      useWidgetIssues("acme.notes.ShoppingList", "7-a-9", "7"),
    );
    await waitFor(() => expect(t.api.list).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("isIssueOfWidget matches component, copy and dashboard", () => {
    expect(
      isIssueOfWidget(widgetIssue, "acme.notes.ShoppingList", "7-a-3", "7"),
    ).toBe(true);
    expect(
      isIssueOfWidget(widgetIssue, "acme.notes.ShoppingList", null, null),
    ).toBe(true);
    expect(
      isIssueOfWidget(widgetIssue, "acme.notes.ShoppingList", "7-a-3", "8"),
    ).toBe(false);
    expect(isIssueOfWidget(botIssue, "acme.notes.ShoppingList")).toBe(false);
  });
});
