/**
 * auditText.js — how the bots' audit log reads (bot-factory US-003 AC5,
 * US-014 AC9, US-019 AC6): "Writer ran read-only search_emails on Gmail
 * without asking", "Kept Writer running this month over its $5.00 budget".
 * Pure.
 */
import { money } from "./spendingText";

// The Log's Kind filter, in the order it lists them.
export const AUDIT_KINDS = [
  { value: "approvals", label: "Approvals" },
  { value: "auto", label: "Ran without asking" },
  { value: "access", label: "Access" },
  { value: "pause", label: "Pause & stop" },
  { value: "budgets", label: "Budgets" },
  { value: "bots", label: "Bots" },
];

// A bot that was deleted before its name was kept reads as "a bot".
const botOf = (e) => e.botName || "a bot";
const toolOn = (e) =>
  e.provider ? `${e.tool || "a tool"} on ${e.provider}` : e.tool || "a tool";
// Reasons that just mean "the user said no" — no need to repeat them.
const PLAIN_DENIALS = new Set(["approval denied", "denied by user"]);
const possessive = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

const BUDGET_OWNER = {
  workspace: "its dashboard's",
  global: "the overall",
};

function budgetSet(e) {
  const usd = e.monthlyUsd;
  const removed = usd === null || usd === undefined;
  let whose;
  if (e.scope === "bot") whose = `${possessive(botOf(e))} monthly limit`;
  else if (e.scope === "workspace") {
    whose = e.dashboardName
      ? `the ${e.dashboardName} dashboard's monthly limit`
      : "a dashboard's monthly limit";
  } else whose = "the overall monthly limit";
  return removed ? `Removed ${whose}` : `Set ${whose} to ${money(usd)}`;
}

function budgetOverride(e) {
  const owner = BUDGET_OWNER[e.budgetScope] || "its";
  const budget = e.budgetUsd ? `${money(e.budgetUsd)} budget` : "budget";
  return `Kept ${botOf(e)} running this month over ${owner} ${budget}`;
}

/** One log entry as a sentence. */
export function auditSentence(entry) {
  const text = sentence(entry);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentence(entry) {
  const e = entry || {};
  switch (e.type) {
    case "approval-asked":
      return `${botOf(e)} asked to use ${toolOn(e)}`;
    case "approval-allowed":
      return e.always
        ? `Always allowed ${botOf(e)} to use ${toolOn(e)}`
        : `Allowed ${botOf(e)} to use ${toolOn(e)}`;
    case "approval-denied":
      return e.reason && !PLAIN_DENIALS.has(e.reason)
        ? `Didn't let ${botOf(e)} use ${toolOn(e)} — ${e.reason}`
        : `Denied ${botOf(e)} the use of ${toolOn(e)}`;
    case "ran-granted":
      return `${botOf(e)} used ${toolOn(e)} without asking — it's always allowed`;
    case "ran-policy":
      return `${botOf(e)} used ${toolOn(e)} without asking — the bot is set to Allow without prompting`;
    case "ran-preapproved":
      return `${botOf(e)} used ${toolOn(e)} without asking — it's on the bot's allowed tools`;
    case "ran-read-only":
      return `${botOf(e)} ran read-only ${toolOn(e)} without asking`;
    case "refused-unconfigured":
      return `Refused ${e.tool || "a tool"} for ${botOf(e)} — it isn't on one of the bot's providers`;
    case "refused-paused":
      return `Refused ${toolOn(e)} for ${botOf(e)} — the bot is paused`;
    case "grant-saved":
      return `${botOf(e)} can now use ${toolOn(e)} without asking`;
    case "grant-revoked":
      return `${botOf(e)} has to ask before using ${toolOn(e)} again`;
    case "pause-bot":
      return `Paused ${botOf(e)}`;
    case "resume-bot":
      return `Resumed ${botOf(e)}`;
    case "pause-all":
      return "Paused all bots";
    case "resume-all":
      return "Resumed all bots";
    case "run-stopped":
      return `Stopped ${possessive(botOf(e))} run`;
    case "runs-interrupted": {
      const n = Number(e.count) || 0;
      const names = (e.botNames || []).filter(Boolean);
      const runs = n === 1 ? "1 run" : `${n} runs`;
      return names.length
        ? `Stopped ${runs} when Dash quit (${names.join(", ")})`
        : `Stopped ${runs} when Dash quit`;
    }
    case "budget-set":
      return budgetSet(e);
    case "budget-override":
      return budgetOverride(e);
    case "bot-created":
      return `Created ${botOf(e)}`;
    case "bot-deleted":
      return `Deleted ${botOf(e)}`;
    default:
      return "Something changed";
  }
}

/** The kind's label ("Ran without asking"). */
export function auditKindLabel(kind) {
  const k = AUDIT_KINDS.find((x) => x.value === kind);
  return k ? k.label : "";
}

/** When it happened, and the run it was part of. */
export function auditWhen(entry) {
  const e = entry || {};
  const at = e.at ? new Date(e.at).toLocaleString() : "";
  if (!e.runStartedAt) return at;
  const run = new Date(e.runStartedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${at} · run started ${run}`;
}
