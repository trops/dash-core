/**
 * useBotContacts — the Bots dock's data (bot-teams TEAM-015): the monitor
 * plus each bot's latest run and who's paused, kept current.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBotContacts } from "./useBotContacts";

function setup() {
  const listeners = { stream: [], list: [] };
  const api = {
    list: jest.fn().mockResolvedValue([{ id: "b1", name: "Inbox Sorter" }]),
    listApprovals: jest.fn().mockResolvedValue([]),
    listRunning: jest.fn().mockResolvedValue([]),
    listRecentRuns: jest.fn().mockResolvedValue([]),
    lastRuns: jest.fn().mockResolvedValue({
      b1: { at: "2026-10-14T08:00:00Z", text: "Sorted" },
    }),
    getPauseState: jest.fn().mockResolvedValue({ global: false, bots: ["b1"] }),
    pauseBot: jest.fn().mockResolvedValue({}),
    resumeBot: jest.fn().mockResolvedValue({}),
    onStream: jest.fn((cb) => (listeners.stream.push(cb), "s")),
    onListChanged: jest.fn((cb) => (listeners.list.push(cb), "l")),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  return { api, listeners };
}

afterEach(() => {
  delete window.mainApi;
});

test("loads bots, latest runs and who's paused", async () => {
  setup();
  const { result } = renderHook(() => useBotContacts());
  await waitFor(() => expect(result.current.bots).toHaveLength(1));
  await waitFor(() => expect(result.current.lastRuns.b1.text).toBe("Sorted"));
  expect(result.current.paused.has("b1")).toBe(true);
});

test("a finished run refreshes latest runs; Resume refreshes pause state", async () => {
  const { api, listeners } = setup();
  const { result } = renderHook(() => useBotContacts());
  await waitFor(() => expect(api.lastRuns).toHaveBeenCalledTimes(1));
  act(() => {
    for (const cb of listeners.stream)
      cb({ botId: "b1", event: { type: "text" } });
  });
  expect(api.lastRuns).toHaveBeenCalledTimes(1);
  act(() => {
    for (const cb of listeners.stream)
      cb({ botId: "b1", event: { type: "done" } });
  });
  await waitFor(() => expect(api.lastRuns).toHaveBeenCalledTimes(2));
  api.getPauseState.mockResolvedValue({ global: false, bots: [] });
  await act(() => result.current.setBotPaused("b1", false));
  expect(api.resumeBot).toHaveBeenCalledWith("b1");
  await waitFor(() => expect(result.current.paused.has("b1")).toBe(false));
});
