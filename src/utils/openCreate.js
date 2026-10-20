import { createType } from "./handoff";

/**
 * Open Create on what a team lead handed off (consolidation Phase 2c-2): a
 * bot → Create › Bot; a widget or layout → a plan that changes that
 * dashboard. The request is filled in, and the lead's note (and who it's
 * from) comes along for the Scout and the Planner.
 *
 * @param {{ type, request, note }} handoff  from extractHandoff
 * @param {{ workspaceId?: string|number|null, from?: string }} lead
 */
export function planWithDashTeam(handoff, { workspaceId = null, from = "" }) {
  window.dispatchEvent(
    new CustomEvent("dash:open-create", {
      detail: {
        type: createType(handoff.type),
        workspaceId: workspaceId ?? null,
        prompt: handoff.request,
        context: { note: handoff.note || "", from: from || "" },
      },
    }),
  );
}
