import { renderHook, act, waitFor } from "@testing-library/react";
import { useApprovalsByDashboard } from "./useApprovalsByDashboard";

function setup({ bots, approvals }) {
  const listeners = {};
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    listApprovals: jest.fn().mockResolvedValue(approvals),
    onApprovalPending: jest.fn((cb) => ((listeners.pending = cb), "l1")),
    onRunActive: jest.fn((cb) => ((listeners.active = cb), "l2")),
    onListChanged: jest.fn((cb) => ((listeners.list = cb), "l3")),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useApprovalsByDashboard (app-navigation NAV-005 AC1)", () => {
  it("counts approvals waiting per dashboard (ids compared as strings)", async () => {
    setup({
      bots: [
        { id: "b1", workspaceId: 7 },
        { id: "b2", workspaceId: "7" },
        { id: "b3", workspaceId: 9 },
        { id: "b4", workspaceId: null },
      ],
      approvals: [
        { id: "a1", request: { botId: "b1" } },
        { id: "a2", request: { botId: "b2" } },
        { id: "a3", request: { botId: "b3" } },
        { id: "a4", request: { botId: "b4" } },
      ],
    });
    const { result } = renderHook(() => useApprovalsByDashboard());
    await waitFor(() => expect(result.current("7")).toBe(2));
    expect(result.current(7)).toBe(2);
    expect(result.current(9)).toBe(1);
    expect(result.current(1)).toBe(0);
  });

  it("re-reads when an approval arrives or runs change", async () => {
    const { api, listeners } = setup({
      bots: [{ id: "b1", workspaceId: 7 }],
      approvals: [],
    });
    const { result } = renderHook(() => useApprovalsByDashboard());
    await waitFor(() => expect(api.listApprovals).toHaveBeenCalled());
    api.listApprovals.mockResolvedValue([
      { id: "a1", request: { botId: "b1" } },
    ]);
    await act(async () => listeners.pending({}));
    await waitFor(() => expect(result.current(7)).toBe(1));
    api.listApprovals.mockResolvedValue([]);
    await act(async () => listeners.active({}));
    await waitFor(() => expect(result.current(7)).toBe(0));
  });

  it("is 0 everywhere without the bots API", () => {
    const { result } = renderHook(() => useApprovalsByDashboard());
    expect(result.current(7)).toBe(0);
  });
});
