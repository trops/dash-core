import { useCallback, useEffect, useRef, useState } from "react";
import { ISSUES_CHANGED } from "../utils/issues";

/**
 * useIssues — what went wrong in widgets, bots and providers (issues PRD),
 * read from the main process (window.mainApi.issues) and kept fresh on
 * "issues:changed".
 *
 * - useIssues(filter)    → { issues, counts, loading, refresh } for a page.
 * - useIssueCounts()     → open counts { total, widget, bot, provider }.
 * - useWidgetIssues(component, itemId, workspaceId) → open issues of one
 *   widget copy.
 *
 * The counts and the per-widget lists share one subscription and one list
 * of open issues, so a dashboard of many widgets reads it once per change.
 */

const EMPTY_COUNTS = { total: 0, widget: 0, bot: 0, provider: 0 };

const issuesApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.issues) ||
  null;

/** Subscribe to issues:changed; returns an unsubscribe. */
function subscribe(fn) {
  const m = typeof window !== "undefined" ? window.mainApi : null;
  if (!m || typeof m.on !== "function") return () => {};
  let id = null;
  try {
    id = m.on(ISSUES_CHANGED, (_e, payload) => fn(payload || {}));
  } catch (_e) {
    return () => {};
  }
  return () => {
    try {
      if (typeof m.removeListener === "function")
        m.removeListener(ISSUES_CHANGED, id);
    } catch (_e) {
      // already gone
    }
  };
}

function countsOf(list) {
  const out = { ...EMPTY_COUNTS };
  for (const i of list || []) {
    const k = i && i.asset && i.asset.kind;
    if (k && out[k] !== undefined) out[k] += 1;
    out.total += 1;
  }
  return out;
}

// ─── The shared store of open issues ──────────────────────────────
const store = {
  open: [],
  counts: EMPTY_COUNTS,
  loaded: false,
  listeners: new Set(),
  unsubscribe: null,
  seq: 0,
};

function emit() {
  for (const fn of store.listeners) fn();
}

async function reloadOpen() {
  const api = issuesApi();
  if (!api || typeof api.list !== "function") return;
  const seq = ++store.seq;
  try {
    const list = await api.list({ status: "open" });
    if (seq !== store.seq) return;
    store.open = Array.isArray(list) ? list : [];
    store.counts = countsOf(store.open);
    store.loaded = true;
    emit();
  } catch (_e) {
    // keep what we had on a transient IPC error
  }
}

function join(fn) {
  store.listeners.add(fn);
  if (!store.unsubscribe) {
    store.unsubscribe = subscribe(() => reloadOpen());
    reloadOpen();
  }
  return () => {
    store.listeners.delete(fn);
    if (store.listeners.size === 0 && store.unsubscribe) {
      store.unsubscribe();
      store.unsubscribe = null;
    }
  };
}

/** Tests only: forget the shared store. */
export function __resetIssuesStore() {
  if (store.unsubscribe) store.unsubscribe();
  store.open = [];
  store.counts = EMPTY_COUNTS;
  store.loaded = false;
  store.listeners = new Set();
  store.unsubscribe = null;
  store.seq = 0;
}

function useStore(select) {
  const selectRef = useRef(select);
  selectRef.current = select;
  const [value, setValue] = useState(() => select(store));
  useEffect(() => {
    const update = () => setValue(selectRef.current(store));
    const leave = join(update);
    update();
    return leave;
  }, []);
  return value;
}

/** Every open issue, newest first (shared). */
export function useOpenIssues() {
  return useStore((s) => s.open);
}

/** Open counts, for the left menu. */
export function useIssueCounts() {
  return useStore((s) => s.counts);
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** Is this issue about this widget copy? */
export function isIssueOfWidget(issue, component, itemId, workspaceId) {
  const a = issue && issue.asset;
  if (!a || a.kind !== "widget" || !component) return false;
  if (a.component !== component) return false;
  if (itemId != null && a.itemId != null && !same(a.itemId, itemId))
    return false;
  if (
    workspaceId != null &&
    a.workspaceId != null &&
    !same(a.workspaceId, workspaceId)
  )
    return false;
  return true;
}

/** Open issues of one widget copy, newest first. */
export function useWidgetIssues(component, itemId, workspaceId) {
  const [list, setList] = useState([]);
  const key = `${component || ""}@${workspaceId ?? ""}#${itemId ?? ""}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (!component) {
      setList([]);
      return undefined;
    }
    const update = () => {
      const next = store.open.filter((i) =>
        isIssueOfWidget(i, component, itemId, workspaceId),
      );
      setList((prev) =>
        prev.length === next.length &&
        prev.every(
          (p, n) =>
            p.id === next[n].id &&
            p.count === next[n].count &&
            p.lastAt === next[n].lastAt,
        )
          ? prev
          : next,
      );
    };
    const leave = join(update);
    update();
    return leave;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list;
}

/**
 * Issues for a page: { status, kind, workspaceId, asset }. Re-reads on
 * every change.
 */
export function useIssues(filter = {}) {
  const status = filter.status || "open";
  const kind = filter.kind || null;
  const workspaceId = filter.workspaceId ?? null;
  const asset = filter.asset || null;
  const assetKey = asset ? JSON.stringify(asset) : "";
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const counts = useIssueCounts();
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const api = issuesApi();
    if (!api || typeof api.list !== "function") {
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    try {
      const q = { status };
      if (kind) q.kind = kind;
      if (workspaceId != null && workspaceId !== "")
        q.workspaceId = workspaceId;
      if (assetKey) q.asset = JSON.parse(assetKey);
      const list = await api.list(q);
      if (mine !== seq.current) return;
      setIssues(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep the last list
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [status, kind, workspaceId, assetKey]);

  useEffect(() => {
    setLoading(true);
    refresh();
    return subscribe(() => refresh());
  }, [refresh]);

  return { issues, counts, loading, refresh };
}

export default useIssues;
