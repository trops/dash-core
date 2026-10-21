/**
 * dashTeamContact.js — the Dash team as one contact in the Bots panel
 * (consolidation Phase 4a). Kept apart from DashTeamPage so the panel
 * doesn't load the page.
 */

/** Its avatar's colour and name. */
export const DASH_TEAM_CONTACT = { id: "dash-team", name: "Dash team" };

/** Open the Dash team's page from anywhere (DashboardStage answers). */
export function openDashTeam(tab = "conversation") {
  window.dispatchEvent(
    new CustomEvent("dash:open-dash-team", { detail: { tab } }),
  );
}
