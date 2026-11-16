/**
 * mockGoalsApi — a window.mainApi.goals for tests (goals-ledger PRD): list
 * by dashboard, get one with its runs, the user's task moves, close and
 * delete — every change tells "goals:changed" listeners.
 */
export function mockGoalsApi(initial = [], extra = {}) {
  let all = initial.map((g) => ({
    ...g,
    tasks: (g.tasks || []).map((t) => ({ ...t })),
  }));
  const listeners = new Map();
  let n = 0;
  const emit = (payload = {}) => {
    for (const { channel, fn } of [...listeners.values()]) {
      if (channel === "goals:changed") fn({}, payload);
    }
  };
  const findTask = (taskId) => {
    for (const g of all) {
      const t = (g.tasks || []).find((x) => x.id === taskId);
      if (t) return { g, t };
    }
    return null;
  };
  const api = {
    list: jest.fn(async (workspaceId) =>
      all.filter((g) => String(g.workspaceId) === String(workspaceId)),
    ),
    get: jest.fn(async (goalId) => {
      const g = all.find((x) => x.id === goalId);
      return g ? { runs: [], ...g } : null;
    }),
    forConversation: jest.fn(async (conversationId) =>
      all.filter((g) => g.conversationId === conversationId),
    ),
    taskAction: jest.fn(async (taskId, action) => {
      const hit = findTask(taskId);
      if (!hit) return { error: "No such task." };
      const next =
        action === "done" ? "done" : action === "close" ? "closed" : "new";
      hit.t.status = next;
      emit({ type: "task", goalId: hit.g.id, workspaceId: hit.g.workspaceId });
      return { ok: true, task: hit.t };
    }),
    close: jest.fn(async (goalId) => {
      all = all.map((g) =>
        g.id === goalId ? { ...g, closed: true, status: "closed" } : g,
      );
      emit({ type: "goal", goalId });
      return { ok: true };
    }),
    delete: jest.fn(async (goalIds) => {
      const ids = Array.isArray(goalIds) ? goalIds : [goalIds];
      all = all.filter((g) => !ids.includes(g.id));
      emit({ type: "deleted" });
      return { deleted: ids, kept: [] };
    }),
    ...extra,
  };
  window.mainApi = {
    ...(window.mainApi || {}),
    goals: api,
    on: jest.fn((channel, fn) => {
      const id = ++n;
      listeners.set(id, { channel, fn });
      return id;
    }),
    removeListener: jest.fn((_channel, id) => listeners.delete(id)),
  };
  return { api, emit, all: () => all };
}

export default mockGoalsApi;
