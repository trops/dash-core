import { renderHook, act, waitFor } from "@testing-library/react";
import { useAllBots } from "./useAllBots";

function setup(over = {}) {
  const listeners = {};
  const on = (name) =>
    jest.fn((cb) => {
      listeners[name] = cb;
      return name;
    });
  const api = {
    list: jest.fn().mockResolvedValue([
      { id: "b1", name: "Inbox Watch", workspaceId: 7 },
      { id: "b2", name: "Digest", workspaceId: 7 },
      { id: "b3", name: "Loose", workspaceId: null },
      { id: "b4", name: "Broken", workspaceId: 9 },
    ]),
    listRunning: jest.fn().mockResolvedValue([{ id: "b2" }]),
    getPauseState: jest.fn().mockResolvedValue({ global: false, bots: ["b3"] }),
    listApprovals: jest
      .fn()
      .mockResolvedValue([{ id: "a1", request: { botId: "b1" } }]),
    listRecentRuns: jest
      .fn()
      .mockResolvedValue([{ botId: "b4", run: { status: "failed" } }]),
    approve: jest.fn().mockResolvedValue(true),
    onRunActive: on("active"),
    onApprovalPending: on("pending"),
    onListChanged: on("list"),
    onStream: on("stream"),
    removeListener: jest.fn(),
    ...over,
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useAllBots (app-navigation NAV-006)", () => {
  it("loads every bot with its status", async () => {
    const { api } = setup();
    const { result } = renderHook(() => useAllBots());
    await waitFor(() => expect(result.current.bots).toHaveLength(4));
    expect(api.listRecentRuns).toHaveBeenCalledWith(50);
    expect(result.current.statusOf("b1")).toBe("Needs approval");
    expect(result.current.statusOf("b2")).toBe("Running");
    expect(result.current.statusOf("b3")).toBe("Paused");
    expect(result.current.statusOf("b4")).toBe("Failed");
    expect(result.current.approvalsFor("b1")).toHaveLength(1);
    expect(result.current.lastRunOf("b4")).toEqual({ status: "failed" });
  });

  it("keeps running and approvals live, and reloads on bot changes", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useAllBots());
    await waitFor(() => expect(result.current.bots).toHaveLength(4));
    act(() => listeners.active({ running: ["b1"] }));
    expect(result.current.statusOf("b2")).toBe("Idle");
    act(() => listeners.pending({ id: "a2", request: { botId: "b2" } }));
    expect(result.current.statusOf("b2")).toBe("Needs approval");
    api.list.mockResolvedValue([{ id: "b9", name: "New" }]);
    await act(async () => listeners.list());
    await waitFor(() => expect(result.current.bots).toHaveLength(1));
  });

  it("approve sends the decision and drops the approval", async () => {
    const { api } = setup();
    const { result } = renderHook(() => useAllBots());
    await waitFor(() =>
      expect(result.current.approvalsFor("b1")).toHaveLength(1),
    );
    await act(async () => result.current.approve("a1", { allow: true }));
    expect(api.approve).toHaveBeenCalledWith("a1", { allow: true });
    expect(result.current.approvalsFor("b1")).toHaveLength(0);
  });

  it("is empty without the bots API", () => {
    const { result } = renderHook(() => useAllBots());
    expect(result.current.bots).toEqual([]);
    expect(result.current.statusOf("x")).toBe("Idle");
  });
});
