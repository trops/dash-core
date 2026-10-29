/**
 * handoffSteps.js — a lead's hand-offs as steps in its conversation
 * (lead-workspace release 2): "Asked Inbox Watch ▸", opening to what it was
 * asked and what it answered. Read from the lead's stream: a tool_call to
 * team_ask_bot (a dashboard lead) or ask_role (the Dash Lead), then its
 * tool_result. Pure.
 */

import { extractPlan } from "../../utils/teamPlan";
import { hasPlan } from "../Create/askThread";

const ROLE_NAMES = {
  planner: "the Planner",
  scout: "the Scout",
  builder: "the Builder",
  checker: "the Checker",
};

/** "mcp__bot-mcp__team_ask_bot" → "team_ask_bot" (bridged tool names). */
export function toolName(name) {
  return String(name || "").replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
}

function inputOf(event) {
  const raw = event && (event.input ?? event.args);
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (_e) {
    return {};
  }
}

/**
 * A step for a hand-off tool call, or null for any other event.
 * @returns {{ who: "step", id, bot, label, request, status: "asking" } | null}
 */
export function stepFromCall(event) {
  if (!event || event.type !== "tool_call") return null;
  const name = toolName(event.name);
  const input = inputOf(event);
  let bot = null;
  if (name === "team_ask_bot") bot = String(input.bot || "").trim() || null;
  else if (name === "ask_role") {
    const role = String(input.role || "").toLowerCase();
    bot = ROLE_NAMES[role] || null;
  }
  if (!bot) return null;
  return {
    who: "step",
    id: String(event.id || `${name}:${bot}`),
    bot,
    label: `Asked ${bot}`,
    request: String(input.request || "").trim(),
    status: "asking",
  };
}

/** The bot's own words from a fenced hand-off result. */
export function answerText(output) {
  let text = String(output == null ? "" : output);
  const fenced = /<(team_data|dash_data)>\n?([\s\S]*?)\n?<\/\1>/i.exec(text);
  if (fenced) text = fenced[2];
  return text
    .replace(/^[^\n]{1,80}'s answer:\n/, "")
    .replace(/^(Planner|Scout|Builder|Checker): /, "")
    .trim();
}

/**
 * Apply a tool_result to the steps: the matching step gets its answer, and
 * a short result line ("2 need attention"…) for the step's row.
 * @param {object[]} messages
 * @param {object} event  { type: "tool_result", id, output, isError }
 * @returns {object[]} the same array when nothing matched
 */
export function withResult(messages, event) {
  if (!event || event.type !== "tool_result") return messages;
  const id = String(event.id || "");
  let hit = false;
  const next = messages.map((m) => {
    if (!m || m.who !== "step" || m.id !== id) return m;
    hit = true;
    const full = answerText(event.output);
    // The Planner's answer carries its plan (release 3a): kept on the step,
    // and its words shown without the JSON.
    const plan = event.isError ? null : extractPlan(full);
    const planned = hasPlan(plan);
    const answer = planned
      ? full.replace(/<plan>[\s\S]*?<\/plan>/gi, "").trim() ||
        plan.summary ||
        ""
      : full;
    return {
      ...m,
      status: event.isError ? "failed" : "done",
      answer,
      result: firstLine(answer),
      ...(planned ? { plan } : {}),
    };
  });
  return hit ? next : messages;
}

/**
 * Steps of one question still asking when its run ended (Stop, quit):
 * marked stopped, so nothing spins forever.
 * @param {string} prefix  the question's id prefix ("3:")
 */
export function withStopped(messages, prefix) {
  let hit = false;
  const next = (messages || []).map((m) => {
    if (!m || m.who !== "step" || m.status !== "asking") return m;
    if (prefix && !String(m.id || "").startsWith(prefix)) return m;
    hit = true;
    return { ...m, status: "stopped" };
  });
  return hit ? next : messages;
}

function firstLine(text) {
  const line = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}
