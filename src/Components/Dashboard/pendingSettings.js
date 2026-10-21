import React from "react";

/**
 * Settings saved outside the dashboard's file — a widget's notification
 * preferences and scheduled tasks (they live in the main process) — wait
 * for the dashboard's Save like every other edit (consolidation Phase 3P;
 * they used to save the moment you clicked, even if you then pressed
 * Cancel).
 *
 * The editor (DashboardStage) provides `{ stage(key, apply) }`: each change
 * is staged under a key (the last one for a key wins) and `apply` runs on
 * Save; Cancel drops them. Outside the editor there's no provider and the
 * change applies at once, as before.
 */
export const PendingSettingsContext = React.createContext(null);

/** Drop what's staged under `key` (a change undone before Save). */
export function unstageSetting(pending, key) {
  if (pending && typeof pending.unstage === "function") pending.unstage(key);
}

/** Stage `apply` under `key` while editing; otherwise run it now. */
export function stageOrApply(pending, key, apply) {
  if (pending && typeof pending.stage === "function") {
    pending.stage(key, apply);
    return;
  }
  apply();
}

/**
 * A staging store for DashboardStage: stage(key, apply), unstage(key),
 * take() — the staged applies in the order they were first staged,
 * emptying the store — clear() and size().
 */
export function createPendingSettings(onChange = () => {}) {
  const staged = new Map();
  return {
    stage(key, apply) {
      if (typeof apply !== "function") return;
      staged.set(String(key), apply);
      onChange(staged.size);
    },
    unstage(key) {
      if (staged.delete(String(key))) onChange(staged.size);
    },
    take() {
      const list = [...staged.values()];
      staged.clear();
      onChange(0);
      return list;
    },
    clear() {
      if (staged.size === 0) return;
      staged.clear();
      onChange(0);
    },
    size() {
      return staged.size;
    },
  };
}
