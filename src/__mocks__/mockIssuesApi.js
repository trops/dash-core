/**
 * mockIssuesApi — a window.mainApi.issues for tests (issues PRD): list
 * filters like the main process, resolve / clearResolved change the list,
 * and every change tells "issues:changed" listeners.
 */
export function mockIssuesApi(initial = [], extra = {}) {
  let all = initial.map((i) => ({ ...i }));
  const listeners = new Map();
  let n = 0;
  const emit = () => {
    for (const { channel, fn } of [...listeners.values()]) {
      if (channel === "issues:changed") fn({}, { counts: {} });
    }
  };
  const api = {
    list: jest.fn(async (f = {}) =>
      all.filter(
        (i) =>
          (f.status === "all" || i.status === (f.status || "open")) &&
          (!f.kind || (i.asset && i.asset.kind === f.kind)) &&
          (f.workspaceId == null ||
            String(i.asset && i.asset.workspaceId) === String(f.workspaceId)),
      ),
    ),
    counts: jest.fn(async () => ({})),
    resolve: jest.fn(async (id) => {
      all = all.map((i) =>
        i.id === id
          ? { ...i, status: "resolved", resolvedAt: new Date().toISOString() }
          : i,
      );
      emit();
      return true;
    }),
    resolveAsset: jest.fn(async () => 1),
    clearResolved: jest.fn(async () => {
      all = all.filter((i) => i.status !== "resolved");
      emit();
      return 0;
    }),
  };
  window.mainApi = {
    ...extra,
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
    emit,
    set: (next) => {
      all = next;
    },
  };
}

export default mockIssuesApi;
