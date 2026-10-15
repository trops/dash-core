/**
 * botNotices.js
 *
 * Which bot events become OS notifications, and what they say (bot-factory
 * US-019 AC3: a run takes a limit to 80% or over it; US-018 AC5: a run
 * fails). Budget notices fire only when a run changes a limit's state, so
 * each level notifies once per limit per month without extra state.
 *
 * The Dash team's own runs never notify — Create shows their progress.
 *
 * Pure: the caller sends the notice (dash-electron, via notificationController).
 */
"use strict";

const RANK = { ok: 0, warn: 1, exceeded: 2 };
const MAX_ERROR = 120;

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const nameOf = (bot) => (bot && bot.name) || "A bot";
const isDashTeam = (bot) => !!bot && bot.system === "dash-team";

/**
 * An error's first line. A provider's raw API error ('400 {"type":"error",
 * "error":{"message":"…"}}') reads as its message.
 */
function errorLine(error) {
  let text = String(error || "");
  const m = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      text = JSON.parse(`"${m[1]}"`);
    } catch (_e) {
      text = m[1];
    }
  }
  return text.split("\n")[0].trim();
}

/**
 * A failed run's notice, or null.
 * @param {object} bot
 * @param {object} record  the run record (status, error) or a skipped result
 */
function failureNotice(bot, record) {
  if (!bot || isDashTeam(bot) || !record || record.status !== "failed") {
    return null;
  }
  let line = errorLine(record.error);
  if (line.length > MAX_ERROR) line = `${line.slice(0, MAX_ERROR - 1)}…`;
  return {
    kind: "failed",
    botId: bot.id,
    title: "Bot failed",
    body: `${nameOf(bot)}: ${line || "the run failed."}`,
  };
}

function whose(scopeKey, dashboardNameOf) {
  if (scopeKey === "global") return "the overall";
  if (String(scopeKey).startsWith("workspace:")) {
    const dashboardName = dashboardNameOf(
      String(scopeKey).slice("workspace:".length),
    );
    return dashboardName
      ? `the ${dashboardName} dashboard's`
      : "its dashboard's";
  }
  return "its";
}

/**
 * The notice for limits this run moved up (to 80%, or over), or null. When
 * several limits moved, the most serious one is named.
 * @param {{ bot: object, before: object, after: object,
 *   dashboardNameOf?: (workspaceId: string) => (string|null) }} args
 *   before/after — BudgetController.status(); dashboardNameOf is only called
 *   when a dashboard limit is named
 */
function budgetNotice({
  bot,
  before,
  after,
  dashboardNameOf = () => null,
} = {}) {
  if (!bot || isDashTeam(bot) || !after) return null;
  const prev = new Map(
    ((before && before.scopes) || []).map((s) => [s.scope, s.state]),
  );
  let top = null;
  for (const s of after.scopes || []) {
    const was = RANK[prev.get(s.scope) || "ok"];
    const now = RANK[s.state] || 0;
    if (now > was && (!top || now > RANK[top.state])) top = s;
  }
  if (!top) return null;
  const limit = `${whose(top.scope, dashboardNameOf)} ${money(top.budget)} monthly budget`;
  return top.state === "exceeded"
    ? {
        kind: "budget-exceeded",
        botId: bot.id,
        title: "Bot paused for budget",
        body: `${nameOf(bot)} is over ${limit}. Open it to keep it running.`,
      }
    : {
        kind: "budget-warn",
        botId: bot.id,
        title: "Bot budget at 80%",
        body: `${nameOf(bot)} has used 80% of ${limit}.`,
      };
}

module.exports = { failureNotice, budgetNotice };
