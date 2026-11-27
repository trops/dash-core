/**
 * openTeamSetup — go to a team's setup (DASH-118): its page under
 * Manage › Bots, scrolled to its setup sections (settings, Check setup,
 * self-test, checks). From the Bots view's Team setup, a banner with no
 * one bot to fix, and a fresh install whose bots need settings.
 */
export function openTeamSetup(workspaceId) {
  if (workspaceId === null || workspaceId === undefined || workspaceId === "")
    return;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("dash:open-page", {
      detail: { page: "bots", teamId: workspaceId, setup: true },
    }),
  );
}

export default openTeamSetup;
