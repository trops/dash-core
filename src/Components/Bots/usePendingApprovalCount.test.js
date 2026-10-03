import { renderHook, act, waitFor } from "@testing-library/react";
import { usePendingApprovalCount } from "./usePendingApprovalCount";

function setup(initial = []) {
  const listeners = {};
  let id = 0;
  const on = (name) =>
    jest.fn((cb) => {
      listeners[name] = cb;
      return `l${++id}`;
    });
  const api = {
    listApprovals: jest.fn().mockResolvedValue(initial),
    onApprovalPending: on("pending"),
    onRunActive: on("active"),
    onListChanged: on("list"),
    onStream: on("stream"),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("usePendingApprovalCount (app-navigation NAV-001 AC3)", () => {
  it("counts approvals waiting across all bots", async () => {
    setup([{ id: "a1" }, { id: "a2" }]);
    const { result } = renderHook(() => usePendingApprovalCount());
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("re-reads when an approval arrives, a run changes or a stream ends", async () => {
    const { api, listeners } = setup([]);
    const { result } = renderHook(() => usePendingApprovalCount());
    await waitFor(() => expect(api.listApprovals).toHaveBeenCalledTimes(1));

    api.listApprovals.mockResolvedValue([{ id: "a1" }]);
    await act(async () => listeners.pending({ id: "a1" }));
    await waitFor(() => expect(result.current).toBe(1));

    // Approved elsewhere: the run resumes → re-read drops it.
    api.listApprovals.mockResolvedValue([]);
    await act(async () => listeners.active({ botId: "b1" }));
    await waitFor(() => expect(result.current).toBe(0));

    api.listApprovals.mockClear();
    await act(async () => listeners.stream({ event: { type: "text" } }));
    expect(api.listApprovals).not.toHaveBeenCalled();
    await act(async () => listeners.stream({ event: { type: "done" } }));
    expect(api.listApprovals).toHaveBeenCalled();
  });

  it("is 0 without the bots API and cleans up its listeners", async () => {
    const { api } = setup([]);
    const { unmount } = renderHook(() => usePendingApprovalCount());
    unmount();
    expect(api.removeListener).toHaveBeenCalledTimes(4);
    delete window.mainApi;
    const { result } = renderHook(() => usePendingApprovalCount());
    expect(result.current).toBe(0);
  });
});
