import { renderHook, act, waitFor } from "@testing-library/react";
import { useTeamBots } from "./useTeamBots";

const bots = [
  { id: "lead_7", name: "Kitchen Lead", role: "lead", workspaceId: "7" },
  { id: "b1", name: "Inbox Watch", workspaceId: "7" },
  { id: "b2", name: "CRM Sync", workspaceId: 7 },
  { id: "x", name: "Other Team", workspaceId: "9" },
];

function setup(over = {}) {
  const listeners = {};
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    listRunning: jest.fn().mockResolvedValue([]),
    getPauseState: jest.fn().mockResolvedValue({ global: false, bots: [] }),
    listApprovals: jest.fn().mockResolvedValue([]),
    getRuns: jest.fn(async (id) =>
      id === "b2" ? [{ status: "failed", error: "Token expired" }] : [],
    ),
    approve: jest.fn().mockResolvedValue({ ok: true }),
    onRunActive: jest.fn((cb) => ((listeners.active = cb), "l1")),
    onApprovalPending: jest.fn((cb) => ((listeners.approval = cb), "l2")),
    onStream: jest.fn((cb) => ((listeners.stream = cb), "l3")),
    removeListener: jest.fn(),
    ...over,
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useTeamBots", () => {
  it("loads this dashboard's lead and members (not other teams)", async () => {
    setup();
    const { result } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lead.id).toBe("lead_7");
    expect(result.current.members.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("derives status per bot and the attention count", async () => {
    setup({
      listApprovals: jest
        .fn()
        .mockResolvedValue([{ id: "a1", request: { botId: "b1" } }]),
    });
    const { result } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.statusOf("b1")).toBe("Needs approval");
    expect(result.current.statusOf("b2")).toBe("Failed");
    expect(result.current.statusOf("lead_7")).toBe("Idle");
    // 1 pending approval + 1 failed last run
    expect(result.current.attention).toBe(2);
  });

  it("tracks running bots live", async () => {
    const { listeners } = setup();
    const { result } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => listeners.active({ count: 1, running: ["b1"] }));
    expect(result.current.statusOf("b1")).toBe("Running");
  });

  it("adds new approvals live; approving removes them", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() =>
      listeners.approval({ id: "a9", request: { botId: "b1", toolName: "x" } }),
    );
    expect(result.current.approvalsFor("b1")).toHaveLength(1);
    await act(async () => {
      await result.current.approve("a9", { allow: true, remember: true });
    });
    expect(api.approve).toHaveBeenCalledWith("a9", {
      allow: true,
      remember: true,
    });
    expect(result.current.approvalsFor("b1")).toHaveLength(0);
  });

  it("refreshes a bot's last run when its run ends", async () => {
    const { api, listeners } = setup();
    const { result } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.getRuns.mockResolvedValue([{ status: "completed" }]);
    await act(async () => {
      listeners.stream({ botId: "b2", event: { type: "done" } });
    });
    await waitFor(() => expect(result.current.statusOf("b2")).toBe("Idle"));
  });

  it("removes its listeners on unmount", async () => {
    const { api } = setup();
    const { result, unmount } = renderHook(() => useTeamBots("7"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(api.removeListener).toHaveBeenCalledWith("l1");
    expect(api.removeListener).toHaveBeenCalledWith("l2");
    expect(api.removeListener).toHaveBeenCalledWith("l3");
  });

  it("does nothing without a dashboard", () => {
    const { api } = setup();
    const { result } = renderHook(() => useTeamBots(null));
    expect(result.current.members).toEqual([]);
    expect(api.list).not.toHaveBeenCalled();
  });
});
