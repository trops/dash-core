/**
 * The dashboard with unsaved edits in this window, if any (DashboardStage
 * mirrors it): a plan doesn't change a dashboard mid-edit (create-entry
 * 5e-2b; moved here from Create's plan step in lead-workspace release 6c).
 */
export function dirtyDashboardId() {
  const id = typeof globalThis !== "undefined" && globalThis.__dashboardDirtyId;
  return id === undefined || id === null ? null : String(id);
}

export default dirtyDashboardId;
