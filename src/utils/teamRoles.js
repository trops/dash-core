/**
 * teamRoles.js — hand work to a Dash team role from the app (create-entry
 * PRD CRE-011, phase 3 slice 4): Create asks the Scout before building, the
 * Widget Builder asks the Checker after an install.
 *
 * runTeamRole finds the role's bot (bots.listDashTeam), runs it with the
 * request, streams its text to onText, and resolves to what the run
 * recorded. A paused or missing role resolves to { skipped, reason } — the
 * caller carries on without it.
 */
import { appendAnswerText } from "./answerText";

function bots() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** The team's bot for a role ("scout", "checker", …), or null. */
export async function findTeamRole(role) {
  const api = bots();
  if (!api || typeof api.listDashTeam !== "function") return null;
  try {
    const team = (await api.listDashTeam()) || [];
    return team.find((b) => b && b.role === role) || null;
  } catch (_e) {
    return null;
  }
}

/**
 * @param {string} role
 * @param {string} prompt
 * @param {{ onText?: (soFar: string) => void, onStart?: (bot) => void,
 *   onEvent?: (event) => void, continueConversation?: boolean,
 *   planId?: string }} [opts]
 *   continueConversation resumes the role's last session (a reply); planId
 *   runs it inside a Create plan, with that plan's memory (4e-1).
 * @returns {Promise<{ skipped: true, reason: string } |
 *   { status, output, model, usage, cost, error, bot }>}
 */
export async function runTeamRole(
  role,
  prompt,
  {
    onText,
    onStart,
    onEvent,
    continueConversation = false,
    planId = null,
  } = {},
) {
  const api = bots();
  if (!api || typeof api.run !== "function") {
    return { skipped: true, reason: "the Dash team isn't available here" };
  }
  const bot = await findTeamRole(role);
  if (!bot) return { skipped: true, reason: `the ${role} isn't set up` };
  if (bot.paused) {
    return { skipped: true, reason: `the ${bot.name} is paused`, bot };
  }
  if (onStart) onStart(bot);

  let text = "";
  let afterTool = false;
  const listenerId =
    typeof api.onStream === "function"
      ? api.onStream(({ botId, event } = {}) => {
          if (botId !== bot.id || !event) return;
          if (onEvent) onEvent(event);
          if (event.type === "tool_call") afterTool = true;
          if (event.type !== "text") return;
          text = appendAnswerText(text, event.text, { afterTool });
          afterTool = false;
          if (onText) onText(text);
        })
      : null;
  try {
    const record = planId
      ? await api.run(bot.id, prompt, !!continueConversation, { planId })
      : await api.run(bot.id, prompt, !!continueConversation);
    if (!record) return { status: "failed", error: "no answer", bot };
    if (record.skipped) {
      return { skipped: true, reason: record.reason || "it didn't run", bot };
    }
    return {
      status: record.status,
      output: record.output || text,
      model: record.model || null,
      usage: record.usage || null,
      cost: record.cost || null,
      error: record.error || null,
      bot,
    };
  } catch (err) {
    return {
      status: "failed",
      error: (err && err.message) || String(err),
      bot,
    };
  } finally {
    if (listenerId != null && typeof api.removeListener === "function") {
      api.removeListener(listenerId);
    }
  }
}

/**
 * Why a Dash team role didn't run, in words that say what to do. "A run is
 * already in progress" means it's busy (often waiting for an approval) —
 * never "turn it on", which it already is.
 * @returns {{ text: string, busy: boolean }}
 */
export function teamSkipText(reason, roleName = "Planner") {
  const r = String(reason || "");
  if (/in progress|busy/i.test(r)) {
    return {
      busy: true,
      text: `The ${roleName} is still working on an earlier request — it may be waiting for you to approve something. Answer it, or stop it, then send again.`,
    };
  }
  if (/paused/i.test(r)) {
    return {
      busy: false,
      text: `The ${roleName} is paused. Turn it on in the Bots page › Dash team, then send again.`,
    };
  }
  return {
    busy: false,
    text: `The ${roleName} can't run right now: ${r || "unknown reason"}.`,
  };
}

/**
 * Stop a Dash team role's run — and the team runs it's waiting on (a
 * Planner blocked on the Builder's approval): the others first, then the
 * role, so nothing it waits on keeps it running.
 */
export async function stopTeamRole(role) {
  const api = bots();
  if (!api || typeof api.stop !== "function") return false;
  const bot = await findTeamRole(role);
  if (!bot) return false;
  let team = [];
  try {
    team = (await api.listDashTeam()) || [];
  } catch (_e) {
    team = [];
  }
  for (const other of team) {
    if (other && other.id !== bot.id) {
      try {
        await api.stop(other.id);
      } catch (_e) {
        // not running
      }
    }
  }
  await api.stop(bot.id);
  return true;
}

const SOURCES = ["Yours", "AI-built", "Registry"];

/**
 * The Scout's matches from the end of its answer (<matches>[…]</matches>):
 * [{ source: "Yours" | "AI-built" | "Registry", name, package, why }].
 * Anything unreadable is left out; no tag → null (show the prose).
 */
export function extractMatches(text) {
  const m = /<matches>([\s\S]*?)<\/matches>/i.exec(String(text || ""));
  if (!m) return null;
  let list;
  try {
    list = JSON.parse(m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch (_e) {
    return null;
  }
  if (!Array.isArray(list)) return null;
  return list
    .filter((x) => x && typeof x.name === "string" && x.name.trim())
    .map((x) => ({
      // A bot the Scout found (Phase 2c-1): its id (yours) or package.
      ...(x.kind === "bot" ? { kind: "bot" } : {}),
      source: SOURCES.includes(x.source) ? x.source : "Registry",
      name: x.name.trim(),
      package: typeof x.package === "string" ? x.package.trim() : "",
      why: typeof x.why === "string" ? x.why.trim() : "",
    }))
    .slice(0, 8);
}

/** The answer without its <matches> block, for showing as text. */
export function withoutMatches(text) {
  return String(text || "")
    .replace(/<matches>[\s\S]*?<\/matches>/gi, "")
    .trim();
}
