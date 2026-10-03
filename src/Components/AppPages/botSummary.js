/**
 * botSummary — what the Bots page shows about a bot (app-navigation PRD
 * NAV-006): its widget-style name, avatar colour, providers + tools, each
 * bot's last run (from the recent-runs list) and what a waiting approval is
 * for. Status itself comes from botConversation's `botStatus`. Pure.
 */

// Generic avatar colours — classes in the prebuilt CSS.
export const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-pink-500",
];

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The bot's widget-style name: `local/<slug>` until it's published
 * (`@org/<name>`, same scheme as widgets).
 */
export function botHandle(bot) {
  if (bot && bot.registryName) return bot.registryName;
  return `local/${slug((bot && (bot.name || bot.id)) || "bot")}`;
}

/** A stable avatar colour per bot (from its id). */
export function avatarColor(bot) {
  const key = String((bot && (bot.id || bot.name)) || "");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Each bot's newest run, from `listRecentRuns` (newest first). */
export function lastRunsByBot(recent) {
  const out = {};
  for (const r of recent || []) {
    if (r && r.botId && !(r.botId in out)) out[r.botId] = r.run || null;
  }
  return out;
}

/** Granted providers with the tools chosen for each. Leads: team tools only. */
export function botProviders(bot) {
  if (!bot || bot.role === "lead") return [];
  const selections = bot.toolSelections || {};
  return (bot.mcpServers || []).map((name) => ({
    name,
    tools: selections[name] || [],
  }));
}

/** "Wants to use send_email on Gmail 3." */
export function approvalText(approval) {
  const req = approval && approval.request;
  if (!req || !req.toolName) return "Wants your approval.";
  return req.serverName
    ? `Wants to use ${req.toolName} on ${req.serverName}.`
    : `Wants to use ${req.toolName}.`;
}
