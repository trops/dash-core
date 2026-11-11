/**
 * issues.js — the renderer's side of Issues (issues PRD): tell the main
 * process what went wrong in a widget (a provider call that failed, a crash)
 * and that a call works again. The main process words them, groups repeats
 * and tells every window ("issues:changed"). Best effort: never throws.
 */

export const ISSUES_CHANGED = "issues:changed";

const api = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.issues) ||
  null;

/**
 * A widget copy's id, the same everywhere an issue is recorded or looked
 * up (and in the main process's `widgetItemId`): its layout item's `uuid`,
 * else its `id` — never a made-up one, so repeats group together.
 */
export function widgetItemId(item) {
  if (!item || typeof item !== "object") return null;
  if (item.uuid != null && item.uuid !== "") return String(item.uuid);
  if (item.id != null && item.id !== "") return String(item.id);
  return null;
}

// How a widget is named everywhere else (its card, the Widgets page) —
// set by the widget factory, which has the widgets' configs. Kept out of
// this file's imports so it stays small and loop-free.
let namer = null;

/** The widget factory tells this file how to name a widget. */
export function setWidgetNamer(fn) {
  namer = typeof fn === "function" ? fn : null;
}

/** The user's title, else the widget's own name — not its code name. */
function widgetNameOf(w) {
  const own = (w.userPrefs && w.userPrefs.title) || w.title || w.label;
  if (own) return String(own);
  try {
    return (namer && w.component && namer(w)) || "";
  } catch (_e) {
    return "";
  }
}

/** A widget instance's facts from its widgetData (or layout item) and workspace. */
export function widgetFacts(widgetData, workspace) {
  const ws = (workspace && (workspace.workspaceData || workspace)) || {};
  const w = widgetData || {};
  return {
    component: w.component || w.name || "",
    itemId: widgetItemId(w),
    workspaceId: ws.id ?? w.dashboardId ?? null,
    // Its place, so Fix with AI and Retry reach this very copy.
    id: w.id ?? null,
    gridItemId: w.parent ?? null,
    scope: w.scope || "",
    packageId: w.packageId || w._sourcePackage || "",
    widgetName: widgetNameOf(w),
    dashboardName: ws.name || ws.label || "",
  };
}

const safely = (fn) => {
  try {
    const p = fn();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_e) {
    // Issues never get in the way of a widget.
  }
};

// The widget calls with an open issue: a call that works only tells the
// main process when it fixes one, never on every success (a widget that
// polls would flood the Debug Console). Loaded once, then kept up here.
let openCalls = null;
const callKey = (component, itemId, workspaceId, provider, tool) =>
  `${component}|${itemId ?? ""}|${workspaceId ?? ""}|${provider}/${tool}`;

function loadOpenCalls(issues) {
  if (openCalls) return;
  openCalls = new Set();
  safely(() =>
    Promise.resolve(issues.list({ status: "open", kind: "widget" })).then(
      (list) => {
        for (const i of Array.isArray(list) ? list : []) {
          const a = i.asset || {};
          if (!i.call) continue;
          openCalls.add(
            callKey(
              a.component,
              a.itemId,
              a.workspaceId,
              i.call.provider,
              i.call.tool,
            ),
          );
        }
      },
    ),
  );
}

/** Tests only. */
export function _resetOpenCalls() {
  openCalls = null;
}

/** A widget's provider call failed. */
export function noteWidgetCallFailed(facts, { provider, tool, args, error }) {
  const issues = api();
  if (!issues || !facts || !facts.component) return;
  loadOpenCalls(issues);
  openCalls.add(
    callKey(facts.component, facts.itemId, facts.workspaceId, provider, tool),
  );
  safely(() =>
    issues.record({
      from: "widget-call",
      ...facts,
      provider,
      tool,
      args,
      error: String(error || ""),
    }),
  );
}

/** The same call worked: its issue (if any) is resolved. */
export function noteWidgetCallWorked(facts, { provider, tool }) {
  const issues = api();
  if (!issues || !facts || !facts.component) return;
  loadOpenCalls(issues);
  const key = callKey(
    facts.component,
    facts.itemId,
    facts.workspaceId,
    provider,
    tool,
  );
  if (!openCalls.has(key)) return;
  openCalls.delete(key);
  safely(() =>
    issues.resolveWorked({ from: "widget-call", ...facts, provider, tool }),
  );
}

/** A widget crashed while showing, or was stopped for failing again and again. */
export function noteWidgetCrashed(facts, { message, stopped = false }) {
  const issues = api();
  if (!issues || !facts || !facts.component) return;
  safely(() =>
    issues.record({
      from: "widget-crash",
      ...facts,
      message: String(message || ""),
      stopped,
    }),
  );
}

/** The text of an MCP tool's error result ({ isError, content }). */
export function toolErrorText(result) {
  const parts =
    (result && Array.isArray(result.content) && result.content) || [];
  const text = parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || "The tool reported an error.";
}
