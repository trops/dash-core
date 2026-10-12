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
 *   onEvent?: (event) => void, continueConversation?: boolean }} [opts]
 *   continueConversation resumes the role's last session (a reply).
 * @returns {Promise<{ skipped: true, reason: string } |
 *   { status, output, model, usage, cost, error, bot }>}
 */
export async function runTeamRole(
  role,
  prompt,
  { onText, onStart, onEvent, continueConversation = false } = {},
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
    const record = await api.run(bot.id, prompt, !!continueConversation);
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
