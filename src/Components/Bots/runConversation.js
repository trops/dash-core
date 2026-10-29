/**
 * runConversation.js — the conversation a bot's run came from (lead-workspace
 * release 5, frames 15 and 24): a run its lead asked for opens that lead's
 * conversation; a lead's own answer opens the conversation it answered in.
 * The exact conversation when the run recorded it (`conversationId`), else
 * the lead's. Pure.
 */

/**
 * @param {object} run  a run record ({ via, conversationId, trigger })
 * @param {object} bot  the bot it belongs to
 * @param {(id: string) => string} [nameOf]  a bot's name by id
 * @returns {{ label: string, open: { key: string, recentId?: string } } | null}
 */
export function runConversation(run, bot, nameOf = (id) => id) {
  if (!run || !bot) return null;
  const via = String(run.via || "");
  const recent = run.conversationId
    ? { recentId: String(run.conversationId) }
    : {};
  if (via.startsWith("lead:")) {
    const leadId = via.slice("lead:".length);
    const name = nameOf(leadId);
    return {
      label: `Asked by ${name && name !== leadId ? name : "its lead"}`,
      open: { key: via, ...recent },
    };
  }
  // A lead's own answer, asked in its conversation.
  if (bot.role === "lead" && via === "create") {
    return {
      label: "Your conversation",
      open: { key: `lead:${bot.id}`, ...recent },
    };
  }
  return null;
}

/** Opens a run's conversation in the lead workspace. */
export function openRunConversation(open) {
  if (!open || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("dash:open-workspace", { detail: open }),
  );
}

export default runConversation;
