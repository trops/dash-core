/**
 * Persist a freshly created workspace and resolve once the main process
 * confirms the write. New dashboards must be saved before they are opened —
 * otherwise they only exist in the open tab and vanish on reload.
 */
export function saveNewWorkspace({ dashApi, appId, workspace }) {
  return new Promise((resolve, reject) => {
    if (!dashApi || typeof dashApi.saveWorkspace !== "function" || !appId) {
      reject(new Error("Couldn't save the new dashboard."));
      return;
    }
    try {
      dashApi.saveWorkspace(
        appId,
        workspace,
        (e, result) => resolve(result),
        (e, error) =>
          reject(
            new Error(
              (error && (error.message || error.error)) ||
                (typeof error === "string" && error) ||
                "Couldn't save the new dashboard.",
            ),
          ),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** True when `id` is one of the saved workspaces (ids compared as strings). */
export function isSavedWorkspace(savedWorkspaces, id) {
  if (id === null || id === undefined || !Array.isArray(savedWorkspaces)) {
    return false;
  }
  return savedWorkspaces.some((ws) => ws && String(ws.id) === String(id));
}
