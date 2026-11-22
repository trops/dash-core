/**
 * handoffSteps.js — a lead's hand-offs as steps in its conversation
 * (lead-workspace release 2): "Asked Inbox Watch ▸", opening to what it was
 * asked and what it answered. Read from the lead's stream: a tool_call to
 * team_ask_bot (a dashboard lead) or ask_role (the Dash Lead), then its
 * tool_result. A dashboard lead bringing in the Dash team (release 3c,
 * team_ask_dash_team) is a step too, marked `dashTeam`. Pure.
 */

import { extractPlan, planLost } from "../../utils/teamPlan";

// The app's note to the lead when a plan couldn't be read (botController
// _askRole, DASH-36): for the lead, not shown in the step.
const LOST_NOTE =
  /\n*\(The [^()\n]{1,80}'s plan came through incomplete[^()]*\)\s*$/;
import { hasPlan } from "../Create/askThread";

const ROLE_NAMES = {
  planner: "the Planner",
  scout: "the Scout",
  builder: "the Builder",
  checker: "the Checker",
};

// A plan sent along as data, in words: its summary.
const planWords = (json) => {
  try {
    const p = JSON.parse(json);
    const s = p && typeof p === "object" ? String(p.summary || "").trim() : "";
    return s ? `“${s}”` : "(its details, attached)";
  } catch (_e) {
    return "(its details, attached)";
  }
};

/**
 * What a bot was asked, for people to read: a plan sent along as data
 * (```json {…}```) reads as its summary, and the app's notes to the
 * Planner on how to answer are left out — never raw JSON on screen.
 */
export function readableRequest(text) {
  return String(text || "")
    .replace(
      /\(?The plan as it stands[^:\n]*:\s*```json\s*([\s\S]*?)```\)?/g,
      (_m, json) => `The plan so far: ${planWords(json)}`,
    )
    .replace(/```(?:json)?\s*(\{[\s\S]*?)```/g, (_m, json) => planWords(json))
    .replace(/[^\n]*<plan>[\s\S]*?<\/plan>[^\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
 * @returns {{ who: "step", id, bot, label, request, status: "asking",
 *   dashTeam? } | null}
 */
export function stepFromCall(event) {
  if (!event || event.type !== "tool_call") return null;
  const name = toolName(event.name);
  const input = inputOf(event);
  let bot = null;
  // A dashboard lead's Dash team: brought in, not on its own team.
  const dashTeam = name === "team_ask_dash_team";
  if (name === "team_ask_bot") bot = String(input.bot || "").trim() || null;
  else if (name === "ask_role" || dashTeam) {
    const role = String(input.role || "").toLowerCase();
    bot = ROLE_NAMES[role] || null;
  }
  if (!bot) return null;
  return {
    who: "step",
    id: String(event.id || `${name}:${bot}`),
    bot,
    label: dashTeam
      ? `Brought in the Dash team · asked ${bot}`
      : `Asked ${bot}`,
    request: String(input.request || "").trim(),
    status: "asking",
    ...(dashTeam ? { dashTeam: true } : {}),
  };
}

/**
 * The job a checked answer came from: a last line after the fenced team
 * data (electron/bots/teamTools.js jobMarker). Inside the fence it's a
 * bot's own words, so it doesn't count.
 */
export const JOB_MARKER =
  /<\/(?:team_data|dash_data)>\s*\n<job id="([A-Za-z0-9_-]+)"\/>\s*$/;

/** The bot's own words from a fenced hand-off result. */
export function answerText(output) {
  let text = String(output == null ? "" : output);
  const fenced = /<(team_data|dash_data)>\n?([\s\S]*?)\n?<\/\1>/i.exec(text);
  if (fenced) text = fenced[2];
  return (
    text
      .replace(/^[^\n]{1,80}'s answer:\n/, "")
      // A bot with checks (bot-checks CHK-003): "X's answer (it passed…):"
      .replace(/^[^\n]{1,80}'s answer \(it passed its checks[^)\n]*\):\n/, "")
      .replace(/^(Planner|Scout|Builder|Checker): /, "")
      .trim()
  );
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
    // A checked answer ends with its job (bot-checks CHK-003).
    const marked = event.isError
      ? null
      : JOB_MARKER.exec(String(event.output == null ? "" : event.output));
    const full = answerText(event.output).replace(LOST_NOTE, "");
    // The Planner's answer carries its plan (release 3a): kept on the step,
    // and its words shown without the JSON.
    const plan = event.isError ? null : extractPlan(full);
    const planned = hasPlan(plan);
    // A plan in it that can't be read (DASH-36): the step says so, and the
    // plan's card offers to ask again — never a plan that isn't there.
    const lost = !event.isError && !planned && planLost(full);
    const answer = planned
      ? full.replace(/<plan>[\s\S]*?<\/plan>/gi, "").trim() ||
        plan.summary ||
        ""
      : lost
        ? full
            .replace(/^…\[truncated\]/, "")
            .replace(/<plan>[\s\S]*$|^[\s\S]*<\/plan>/i, "")
            .trim()
        : full;
    return {
      ...m,
      status: event.isError ? "failed" : "done",
      answer,
      result: firstLine(answer),
      ...(planned ? { plan } : {}),
      ...(lost ? { planLost: true } : {}),
      ...(marked ? { jobId: marked[1] } : {}),
      ...(!planned && !lost && didNothing(answer) ? { nothing: true } : {}),
    };
  });
  return hit ? next : messages;
}

/**
 * An answer that says it made nothing ("I haven't created anything…", "I
 * can't build that…"): it stays in the conversation, but isn't an output.
 */
export function didNothing(answer) {
  const text = String(answer || "")
    .toLowerCase()
    .replace(/’/g, "'");
  const first = firstLine(text);
  const said = NOTHING.exec(first);
  if (!said) return false;
  // "…, but I added a Weather widget": something was made after all.
  const rest = text.slice(said.index + said[0].length);
  return !MADE.test(rest);
}
const NOTHING =
  /^(?:sorry,? )?(?:i |i'm )?(?:haven't|have not|didn't|did not|can't|cannot|can not|couldn't|could not|wasn't able to|was not able to|was unable to|am unable to|unable to|am not able to) (?:create|created|build|built|make|made|save|saved|change|changed|do|done)\b[^,.;]*/;
const MADE =
  /\b(?:but|so|instead|then|and)\b[^.]*\bi(?:'ve| have)? (?:\w+ )?(?:saved|created|added|built|made|changed|updated|installed)\b|\bi(?:'ve| have) (?:saved|created|added|built|made|changed|updated|installed)\b/;

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

/**
 * A lead asked from outside the app (an MCP task or question), as its
 * conversation: what was asked, the lead's hand-offs (its saved calls and
 * results, made into steps the way the live stream is — plan and all) and
 * its answer. Steps left asking once the run ended are stopped.
 *
 * @param {{ from?, status?, events?, answer?, error? }} bg  the run, as kept
 * @param {string} asked  what was asked
 * @param {string} leadName
 */
export function backgroundMessages(bg, asked, leadName = "") {
  const b = bg || {};
  let messages = [
    { who: "you", text: String(asked || ""), via: b.from || "mcp" },
  ];
  for (const event of Array.isArray(b.events) ? b.events : []) {
    const step = stepFromCall(event);
    messages = step ? [...messages, step] : withResult(messages, event);
  }
  const ended = !!b.status && b.status !== "running";
  if (ended) messages = withStopped(messages);
  const answer = String(b.answer || "").trim();
  if (answer) {
    messages = [...messages, { who: "lead", by: leadName, text: answer }];
  } else if (ended && b.error) {
    messages = [
      ...messages,
      { who: "lead", by: leadName, text: `I couldn't finish this: ${b.error}` },
    ];
  }
  return messages;
}

function firstLine(text) {
  const line = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}
