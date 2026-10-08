import { renderHook, act, waitFor } from "@testing-library/react";
import { useBotMonitor } from "./useBotMonitor";

const bots = [
  { id: "b1", name: "Inbox Watch", workspaceId: "7" },
  { id: "b2", name: "Loose", workspaceId: null },
];

function setup(over = {}) {
  const listeners = {};
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    listApprovals: jest
      .fn()
      .mockResolvedValue([{ id: "a1", request: { botId: "b1" } }]),
    listRunning: jest.fn().mockResolvedValue([]),
    listRecentRuns: jest.fn().mockResolvedValue([
      {
        botId: "b1",
        botName: "Inbox Watch",
        workspaceId: "7",
        run: { status: "completed", endedAt: "2026-10-02T10:00:00.000Z" },
      },
    ]),
    approve: jest.fn().mockResolvedValue({}),
    stop: jest.fn().mockResolvedValue(true),
    onApprovalPending: jest.fn((cb) => ((listeners.approval = cb), "l1")),
    onApprovalsChanged: jest.fn((cb) => ((listeners.approvals = cb), "l5")),
    onRunActive: jest.fn((cb) => ((listeners.active = cb), "l2")),
    onStream: jest.fn((cb) => ((listeners.stream = cb), "l3")),
    onListChanged: jest.fn((cb) => ((listeners.listChanged = cb), "l4")),
    removeListener: jest.fn(),
    ...over,
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useBotMonitor", () => {
  it("loads approvals, running and recent runs, with bot lookup", async () => {
    const { api } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.approvals).toHaveLength(1);
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.botById("b1").name).toBe("Inbox Watch");
    expect(api.listRecentRuns).toHaveBeenCalledWith(10);
  });

  it("adds approvals live and drops them once decided", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => listeners.approval({ id: "a2", request: { botId: "b2" } }));
    expect(result.current.approvals.map((a) => a.id)).toEqual(["a1", "a2"]);
    await act(async () => {
      await result.current.approve("a1", { allow: true });
    });
    expect(api.approve).toHaveBeenCalledWith("a1", { allow: true });
    expect(result.current.approvals.map((a) => a.id)).toEqual(["a2"]);
  });

  it("drops approvals answered elsewhere (the queue's full list replaces this copy)", async () => {
    const { listeners } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => listeners.approval({ id: "a2", request: { botId: "b2" } }));
    expect(result.current.approvals).toHaveLength(2);
    // Answered in a bot's conversation → the main process sends the new list.
    act(() => listeners.approvals({ approvals: [] }));
    expect(result.current.approvals).toEqual([]);
  });

  it("re-reads running bots when the running set changes", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.listRunning.mockResolvedValue([
      { id: "b1", name: "Inbox Watch", workspaceId: "7", startedAt: "x" },
    ]);
    await act(async () => {
      listeners.active({ count: 1, running: ["b1"] });
    });
    await waitFor(() => expect(result.current.running).toHaveLength(1));
    expect(result.current.running[0].startedAt).toBe("x");
  });

  it("refreshes Recent when a run finishes", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.listRecentRuns.mockResolvedValue([]);
    await act(async () => {
      listeners.stream({ botId: "b1", event: { type: "text", text: "x" } });
    });
    expect(api.listRecentRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      listeners.stream({ botId: "b1", event: { type: "done" } });
    });
    await waitFor(() => expect(result.current.recent).toHaveLength(0));
  });

  it("stop stops the bot", async () => {
    const { api } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.stop("b1");
    });
    expect(api.stop).toHaveBeenCalledWith("b1");
  });

  it("removes its listeners on unmount", async () => {
    const { api } = setup();
    const { result, unmount } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(api.removeListener).toHaveBeenCalledWith("l1");
    expect(api.removeListener).toHaveBeenCalledWith("l2");
    expect(api.removeListener).toHaveBeenCalledWith("l3");
  });
});

describe("useBotMonitor — bots changed elsewhere (TEAM-011 refresh)", () => {
  it("re-loads bot names when bots change", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useBotMonitor());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.list.mockResolvedValue([
      { id: "b1", name: "Renamed", workspaceId: "7" },
    ]);
    await act(async () => {
      listeners.listChanged({});
    });
    await waitFor(() =>
      expect(result.current.botById("b1").name).toBe("Renamed"),
    );
  });
});
