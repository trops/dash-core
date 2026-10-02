/**
 * botConversation.js
 *
 * Pure helpers for the Bots view (bot-teams PRD TEAM-011): turn a bot's run
 * records into chat turns, and work out each bot's status and how many things
 * on a team need the user.
 *
 * A run record (BotRunner) carries: trigger, status, startedAt/endedAt,
 * prompt, output (the answer), toolCalls [{ tool, provider, ok }], continued
 * (a reply in the same session), error, outputUnavailable, and — for event
 * runs — source { eventType, label, originBotId, chain }.
 *
 * Turn kinds: "user" (what was asked), "system" (what started a run that
 * nobody typed), "tools" (tool-call rows), "bot" (the answer), "error",
 * "divider" (a new conversation started).
 */

const sameId = (id) => id;

/**
 * What started a run nobody typed, or null for typed runs. Event runs name
 * their event (the bot's subscription label) and, for bot events, the chain
 * of bots that led here. Runs recorded before `source` existed fall back to
 * "Triggered by an event".
 *
 * @param {object} r a run record
 * @param {(botId: string) => string} [nameOf] bot id → name
 */
export function triggerLabel(r, nameOf = sameId) {
  if (!r) return null;
  if (r.trigger === "schedule") return "Scheduled run";
  if (r.trigger !== "event") return null;
  const src = r.source;
  if (!src || !(src.label || src.eventType)) return "Triggered by an event";
  let text = `Triggered by ${src.label || src.eventType}`;
  const chain = Array.isArray(src.chain) ? src.chain : [];
  if (chain.length > 1) text += ` · ${chain.map(nameOf).join(" → ")}`;
  return text;
}

const PROVIDER_PROBLEM =
  /couldn't start|settings › providers|credit balance|api[ -]?key|x-api-key|\b401\b|unauthori[sz]ed|authentication|token (has )?expired|expired token|invalid token|forbidden|\b403\b/i;

/**
 * Next steps for a failed run: always run it again (ask again, for a lead);
 * and when the error points at a provider (a server that couldn't start, an
 * AI provider's key or credit), a way to its settings.
 *
 * @returns {{ action: "run-again" | "open-settings", label: string, section?: string }[]}
 */
export function errorNextSteps(text, { isLead = false } = {}) {
  if (!text) return [];
  const steps = [
    { action: "run-again", label: isLead ? "Ask again" : "Run again" },
  ];
  if (PROVIDER_PROBLEM.test(String(text))) {
    steps.push({
      action: "open-settings",
      section: "providers",
      label: "Open Settings › Providers",
    });
  }
  return steps;
}

function turnsForRun(r, { pending = false, nameOf = sameId } = {}) {
  const turns = [];
  const at = r.startedAt || r.at || null;
  const label = triggerLabel(r, nameOf);
  if (label) {
    // Event prompts are machine-written (and fence untrusted payloads) — show
    // what started the run, not the raw prompt.
    turns.push({ kind: "system", text: label, at });
  } else if (r.prompt) {
    // Typed by the user: a manual run, a reply, or a question to the lead.
    turns.push({ kind: "user", text: r.prompt, at });
  }
  if (Array.isArray(r.toolCalls) && r.toolCalls.length) {
    turns.push({ kind: "tools", calls: r.toolCalls, at });
  }
  if (r.status === "failed" && r.error) {
    // The prompt rides along so "Run again" can repeat the run.
    turns.push({
      kind: "error",
      text: r.error,
      prompt: r.prompt || "",
      at: r.endedAt || at,
    });
  }
  if (r.outputUnavailable) {
    turns.push({
      kind: "bot",
      unavailable: true,
      text: "",
      at: r.endedAt || at,
    });
  } else if (r.output || pending) {
    turns.push({
      kind: "bot",
      text: r.output || r.text || "",
      pending,
      at: r.endedAt || at,
    });
  }
  return turns;
}

/**
 * @param {object[]} runs  oldest first
 * @param {{ live?: { prompt?, text?, toolCalls?, continued? }, nameOf?: Function }} [opts]
 *        the run in progress, if any; bot id → name for trigger chains
 * @returns {object[]} turns
 */
export function buildConversation(runs, { live = null, nameOf = sameId } = {}) {
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const turns = [];
  list.forEach((r, i) => {
    if (i > 0 && !r.continued) {
      turns.push({
        kind: "divider",
        text: "New conversation",
        at: r.startedAt || r.at || null,
      });
    }
    turns.push(...turnsForRun(r, { nameOf }));
  });
  if (live) {
    if (list.length && !live.continued) {
      turns.push({ kind: "divider", text: "New conversation", at: null });
    }
    turns.push(
      ...turnsForRun(
        {
          trigger: live.trigger || "manual",
          prompt: live.prompt || "",
          toolCalls: live.toolCalls || [],
          text: live.text || "",
        },
        { pending: true },
      ),
    );
  }
  return turns;
}

/**
 * One bot's status. Needs approval > Running > Paused > Failed (its last run)
 * > Idle.
 */
export function botStatus({ botId, running, paused, approvals, lastRun }) {
  if (
    (approvals || []).some((a) => a && a.request && a.request.botId === botId)
  ) {
    return "Needs approval";
  }
  if ((running || []).includes(botId)) return "Running";
  if (paused && (paused.global || (paused.bots || []).includes(botId))) {
    return "Paused";
  }
  if (lastRun && lastRun.status === "failed") return "Failed";
  return "Idle";
}

/**
 * Bot answers are shown as plain text — never rendered as HTML, because they
 * can quote email or web content. Strip leftover Markdown markers.
 */
export function toPlainText(text) {
  return String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/**
 * The Bots switch badge: the team's pending approvals plus bots whose last
 * run failed.
 */
export function attentionCount({ botIds, approvals, lastRunByBot }) {
  const ids = new Set(botIds || []);
  const pending = (approvals || []).filter(
    (a) => a && a.request && ids.has(a.request.botId),
  ).length;
  const failed = [...ids].filter(
    (id) =>
      lastRunByBot && lastRunByBot[id] && lastRunByBot[id].status === "failed",
  ).length;
  return pending + failed;
}
