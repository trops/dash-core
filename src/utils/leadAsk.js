/**
 * leadAsk.js — ask a dashboard's team lead from Create's Ask box
 * (create-entry PRD phase 5e-2a; bot-teams TEAM-013 from the dock).
 *
 * The counterpart of runTeamRole for leads: sends the question straight to
 * the lead (bots.askLead, labelled via "create"), streams its text to
 * onText, and resolves to what the run recorded. A lead that can't take a
 * message (paused, over budget, busy) resolves to { skipped, reason }.
 */
import { appendAnswerText } from "./answerText";
import { availabilityNotice } from "../Components/AiAssistant/leadMessages";

function bots() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/**
 * @param {{ botId, leadName, paused?, overBudget?, running? }} lead
 * @param {string} question
 * @param {{ onText?: (soFar: string) => void,
 *   onEvent?: (event) => void, continueConversation?: boolean }} [opts]
 * @returns {Promise<{ skipped: true, reason: string } |
 *   { status, output, model, usage, cost, error }>}
 */
export async function askTeamLead(
  lead,
  question,
  { onText, onEvent, continueConversation = false, conversationId = null } = {},
) {
  const api = bots();
  if (!lead || !lead.botId) {
    return { skipped: true, reason: "That team lead isn't there any more." };
  }
  if (!api || typeof api.askLead !== "function") {
    return { skipped: true, reason: "Team leads aren't available here." };
  }
  const notice = availabilityNotice(lead);
  if (notice) return { skipped: true, reason: notice };

  let text = "";
  let afterTool = false;
  const listenerId =
    typeof api.onStream === "function"
      ? api.onStream(({ botId, event } = {}) => {
          if (botId !== lead.botId || !event) return;
          // Every event (its hand-offs too), for the lead workspace.
          if (onEvent) onEvent(event);
          if (event.type === "tool_call" || event.type === "tool_result") {
            afterTool = true;
          }
          if (event.type !== "text" || !event.text) return;
          text = appendAnswerText(text, event.text, { afterTool });
          afterTool = false;
          if (onText) onText(text);
        })
      : null;
  try {
    const record = await api.askLead(
      lead.botId,
      question,
      !!continueConversation,
      "create",
      // The conversation asking: the bots the lead asks record it.
      conversationId,
    );
    if (!record) return { status: "failed", error: "no answer" };
    if (record.skipped) {
      return {
        skipped: true,
        reason: `${lead.leadName} is busy with another run — try again when it finishes.`,
      };
    }
    return {
      status: record.status,
      output: record.output || text,
      model: record.model || null,
      usage: record.usage || null,
      cost: record.cost || null,
      error: record.error || null,
    };
  } catch (err) {
    return { status: "failed", error: (err && err.message) || String(err) };
  } finally {
    if (listenerId != null && typeof api.removeListener === "function") {
      api.removeListener(listenerId);
    }
  }
}
