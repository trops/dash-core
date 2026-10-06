/**
 * leadMessages.js — pure helpers for messaging a team lead directly from the
 * AI Assistant's "To:" picker (bot-teams TEAM-013).
 *
 * Chat messages addressed to a lead carry `to: lead`; the lead's answer is a
 * `role: "lead"` message with `from: lead`. A lead is the directory entry
 * from `mainApi.bots.listLeads()`:
 *   { botId, leadName, dashboardName, dashboardLabel, running, paused, overBudget }
 */

/** "Daily Brief Lead · Daily Brief" */
export function leadLabel(lead) {
  if (!lead) return "";
  return `${lead.leadName} · ${lead.dashboardLabel || lead.dashboardName}`;
}

const who = (lead) =>
  `${lead.leadName} (${lead.dashboardLabel || lead.dashboardName})`;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => c && c.type === "text")
          .map((c) => c.text)
          .join("")
      : "";

/**
 * The conversation as sent to the Assistant's model. Direct lead exchanges
 * are folded in as labelled user-role context (AC10) so "summarise what the
 * lead said" works; consecutive user-role entries are merged so roles keep
 * alternating. The lead's streaming placeholder is never sent.
 */
export function buildLlmHistory(messages) {
  const out = [];
  const push = (role, content) => {
    const last = out[out.length - 1];
    if (
      role === "user" &&
      last &&
      last.role === "user" &&
      typeof last.content === "string" &&
      typeof content === "string"
    ) {
      last.content = `${last.content}\n\n${content}`;
      return;
    }
    out.push({ role, content });
  };

  for (const msg of messages || []) {
    if (msg.role === "lead") {
      if (msg.streaming || !msg.from) continue;
      const text = textOf(msg.content);
      if (msg.error) {
        push("user", `${who(msg.from)} could not answer: ${msg.error}`);
      } else if (text) {
        push("user", `${who(msg.from)} answered: ${text}`);
      }
      continue;
    }
    if (msg.role === "user" && msg.to) {
      push("user", `You asked ${who(msg.to)}: ${textOf(msg.content)}`);
      continue;
    }
    push(msg.role, msg.content);
  }
  return out;
}

/**
 * Why this lead can't take a message right now, or null (AC7). Pause and
 * budgets only block tool calls, so running a paused lead would "answer"
 * with its team tools refused — say why instead.
 */
export function availabilityNotice(lead) {
  if (!lead) return null;
  if (lead.paused) {
    return `${lead.leadName} is paused — resume it in the Bots view.`;
  }
  if (lead.overBudget) {
    return `${lead.leadName} is over its budget — raise it in the Bots view.`;
  }
  if (lead.running) {
    return `${lead.leadName} is busy with another run — try again when it finishes.`;
  }
  return null;
}

/**
 * Has this lead already answered in this chat? Follow-ups then continue
 * the lead's session (AC4).
 */
export function hasLeadSession(messages, botId) {
  return (messages || []).some(
    (m) =>
      m.role === "lead" &&
      !m.streaming &&
      !m.error &&
      m.from &&
      m.from.botId === botId,
  );
}

/** The "Assistant" entry in the @ list (the default recipient). */
export const ASSISTANT_RECIPIENT = Object.freeze({
  botId: null,
  leadName: "Assistant",
  dashboardName: "",
  dashboardLabel: "",
  isAssistant: true,
});

/**
 * Recipients for the @ shortcut (AC6): the Assistant and each lead whose
 * lead or dashboard name contains `query` (any case), in list order.
 */
export function filterRecipients(leads, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const all = [ASSISTANT_RECIPIENT, ...(leads || [])];
  if (!q) return all;
  return all.filter((r) =>
    [r.leadName, r.dashboardLabel || r.dashboardName]
      .filter(Boolean)
      .some((s) => s.toLowerCase().includes(q)),
  );
}
