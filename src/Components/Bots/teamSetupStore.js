/**
 * teamSetupStore.js — the renderer's memory of each team's last Check setup
 * (DASH-119), and a "this team's setup changed" signal.
 *
 * The team page's Check setup keeps its result here, so the team's setup
 * status (teamSetupStatus) can count what the check found everywhere the
 * team appears, until the next check. A save of the team's settings says
 * so here too, so those views read them again. Kept for this window's
 * session, like the main process's own cache of the check.
 */

const checks = new Map();
const listeners = new Set();

const keyOf = (workspaceId) =>
  workspaceId === null || workspaceId === undefined
    ? null
    : String(workspaceId);

function emit(workspaceId) {
  for (const fn of Array.from(listeners)) {
    try {
      fn(keyOf(workspaceId));
    } catch (_e) {
      // one listener's error never stops the others
    }
  }
}

/** Keep a Check setup result ({ ok, problems, off, at }) for a team. */
export function rememberSetupCheck(workspaceId, result) {
  const key = keyOf(workspaceId);
  if (key === null) return;
  if (result && typeof result === "object" && typeof result.ok === "boolean") {
    checks.set(key, {
      ok: result.ok,
      problems: Array.isArray(result.problems) ? result.problems : [],
      // Checks that came with a package and are off (DASH-125).
      off: Array.isArray(result.off) ? result.off : [],
      at: result.at || null,
    });
  } else {
    checks.delete(key);
  }
  emit(workspaceId);
}

/** The team's last Check setup result, or null. */
export function lastSetupCheck(workspaceId) {
  const key = keyOf(workspaceId);
  return key === null ? null : checks.get(key) || null;
}

/** Something about this team's setup changed (its settings were saved). */
export function noteSetupChanged(workspaceId) {
  emit(workspaceId);
}

/** fn(workspaceId as a string) on any change; returns an unsubscribe. */
export function onSetupChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only. */
export function _resetSetupStore() {
  checks.clear();
  listeners.clear();
}
