/**
 * canDoView.js — the display data for the "What it can do" section of a
 * bot's side panel on the team diagram (DASH-126, screen 1b): what this
 * bot's own setup lets it touch and run. Generic: it reads only the bot's
 * capability fields, never what kind of team it is on.
 *
 *   files      Built-in tools ("None" / "Read only" / "All") and the
 *              folders they work in, shown readably (~ for the home folder,
 *              <name> for a team setting the folder is made from)
 *   asks       what its approval policy asks you before
 *   commands   its allowed ("Runs") and blocked ("Never") shell commands;
 *              shell is false when its built-ins can't run any
 *   providers  each provider it uses and the tools it's allowed
 *              (tools null → every tool the provider offers)
 *   alwaysBlocked  the commands no bot ever runs (electron/checks/
 *              commandRules.js), shown once
 *
 * Mirrors what a run uses (electron/bots/BotRunner.js, strictMode.js): a
 * lead has no built-in tools; a bot without builtinTools has all of them;
 * a provider with no toolSelections entry keeps every tool it offers.
 *
 * Pure: no React, no IPC.
 */

/** Always blocked for every bot, whatever its lists say (commandRules.js). */
export const ALWAYS_BLOCKED = [
  "git push --force",
  "git reset --hard",
  "rm -rf",
  "pushing to the main branch",
  "publishing a package",
];

export const ALWAYS_BLOCKED_TEXT = `Always blocked for every bot: ${ALWAYS_BLOCKED.join(
  ", ",
)}.`;

const BUILTIN_LABELS = {
  none: "None",
  "read-only": "Read only",
  all: "All",
};

const ASKS = {
  ask: "Anything that sends, changes or deletes (reading doesn't ask)",
  "ask-every": "Every tool, reading included",
  allow: "Nothing (it runs every tool without asking)",
  unattended: "Nothing (unattended, its folders only)",
};

const strings = (v) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

/** The built-ins a run gets: "none" | "read-only" | "all". */
export function builtinLevel(bot) {
  if (!bot || typeof bot !== "object") return "none";
  if (bot.role === "lead") return "none";
  return bot.builtinTools === "none" || bot.builtinTools === "read-only"
    ? bot.builtinTools
    : "all";
}

/**
 * A folder as a person reads it: the home folder as ~, a team setting
 * ({workDir}, {repo.dir}) as <workDir>, <repo.dir>; a table row's key
 * ({repo.key}) as <repo>.
 */
export function readableFolder(path) {
  let p = String(path || "").trim();
  if (!p) return "";
  p = p
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
  p = p.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?\}/g,
    (_, name, field) =>
      field && field !== "key" ? `<${name}.${field}>` : `<${name}>`,
  );
  if (p.length > 1) p = p.replace(/[\\/]+$/, "");
  return p;
}

// Server ids are often lower-case; a friendlier label for the panel.
const SERVER_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  openai: "OpenAI",
};

/** "github" → "GitHub", "google-drive" → "Google Drive", "My Jira" kept. */
export function providerLabel(name) {
  const n = String(name || "").trim();
  if (SERVER_LABELS[n.toLowerCase()]) return SERVER_LABELS[n.toLowerCase()];
  if (/[A-Z]/.test(n)) return n;
  return n
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * What the bot's setup lets it touch and run, ready to show.
 * @param {object} bot
 */
export function canDoView(bot) {
  const b = bot && typeof bot === "object" ? bot : {};
  const level = builtinLevel(b);
  const folders = (level === "none" ? [] : strings(b.projects))
    .map(readableFolder)
    .filter(Boolean);
  const files =
    level === "none"
      ? "None"
      : folders.length
        ? `${BUILTIN_LABELS[level]}, only in`
        : `${BUILTIN_LABELS[level]}, not limited to a folder`;

  const policy = ASKS[b.approvalPolicy] ? b.approvalPolicy : "ask";

  const shell = level === "all";
  const cmds = b.commands && typeof b.commands === "object" ? b.commands : {};
  const runs = shell ? strings(cmds.allowed) : [];
  const never = shell ? strings(cmds.blocked) : [];
  let commandsNote = null;
  if (!shell) commandsNote = "None: its built-in tools can't run commands";
  else if (!runs.length)
    commandsNote = "No list: each command follows what it asks you before";

  const selections =
    b.toolSelections && typeof b.toolSelections === "object"
      ? b.toolSelections
      : {};
  const seen = new Set();
  const providers = strings(b.mcpServers)
    .filter((n) => !seen.has(n) && seen.add(n))
    .map((name) => ({
      name,
      label: providerLabel(name),
      tools: Array.isArray(selections[name]) ? strings(selections[name]) : null,
    }));

  return {
    builtins: level,
    files,
    folders,
    asks: ASKS[policy],
    commands: { shell, runs, never, note: commandsNote },
    providers,
    alwaysBlocked: ALWAYS_BLOCKED_TEXT,
  };
}

export default canDoView;
