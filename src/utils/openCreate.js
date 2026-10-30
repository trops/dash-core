import { createType } from "./handoff";

/**
 * Carry on with what a team lead handed off (consolidation Phase 2c-2) — a
 * conversation from before leads brought in the Dash team themselves
 * (lead-workspace release 3c). Since the Create window was retired (release
 * 6c), it opens a new Dash Lead conversation with the request in its reply
 * box, the dashboard it's for, and the lead's note (and who it's from)
 * under it: a bot is what's being made; a widget or layout is a change to
 * that dashboard, which the user says yes to there.
 *
 * @param {{ type, request, note }} handoff  from extractHandoff
 * @param {{ dashboardName?: string, from?: string }} lead
 */
export function planWithDashTeam(
  handoff,
  { dashboardName = "", from = "" } = {},
) {
  const note = String((handoff && handoff.note) || "").trim();
  const draft = [
    String((handoff && handoff.request) || "").trim(),
    dashboardName ? `(For the ${dashboardName} dashboard.)` : "",
    note ? `(${from ? `From ${from}: ` : ""}${note})` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  window.dispatchEvent(
    new CustomEvent("dash:open-workspace", {
      detail: {
        key: "role:dashlead",
        ...(createType(handoff && handoff.type) === "bot"
          ? { making: { kind: "bot" } }
          : {}),
        draft,
      },
    }),
  );
}
