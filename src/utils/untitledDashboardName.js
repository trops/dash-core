/**
 * untitledDashboardName — a new blank dashboard's name, told apart from the
 * ones already there: "Untitled dashboard", then "Untitled dashboard 2", 3…
 * (the lowest number not in use). Two tabs, the Dashboards list and their
 * leads no longer read the same.
 *
 * @param {Array<{ name?: string }>} workspaces  the dashboards there now
 * @returns {string}
 */
export const UNTITLED_DASHBOARD = "Untitled dashboard";

export function untitledDashboardName(workspaces) {
  const taken = new Set(
    (Array.isArray(workspaces) ? workspaces : [])
      .map((w) => (w && typeof w.name === "string" ? w.name.trim() : ""))
      .filter(Boolean)
      .map((n) => n.toLowerCase()),
  );
  const base = UNTITLED_DASHBOARD.toLowerCase();
  if (!taken.has(base)) return UNTITLED_DASHBOARD;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base} ${n}`)) return `${UNTITLED_DASHBOARD} ${n}`;
  }
}
