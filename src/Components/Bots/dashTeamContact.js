/**
 * dashTeamContact.js — the Dash team as one contact in the Bots panel
 * (consolidation Phase 4a). Kept apart from DashTeamPage so the panel
 * doesn't load the page.
 */

/** Its avatar's colour and name. */
export const DASH_TEAM_CONTACT = { id: "dash-team", name: "Dash team" };

/**
 * Open the Dash team from anywhere (DashboardStage answers): talking to it
 * is a Dash Lead conversation (lead-workspace release 6b); its settings
 * are its page.
 */
export function openDashTeam(tab = "conversation") {
  window.dispatchEvent(
    tab === "settings"
      ? new CustomEvent("dash:open-dash-team", { detail: { tab } })
      : new CustomEvent("dash:open-workspace", {
          detail: { key: "role:dashlead" },
        }),
  );
}
