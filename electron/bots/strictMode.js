/**
 * strictMode.js — a strict bot does only what its setup lists (DASH-116):
 *
 *   - shell commands run only when they match its allowed commands (the
 *     prefix matching commandDecision uses); anything else is refused, even
 *     under "unattended" inside its folders;
 *   - provider tools run only from its listed tools (as for every bot);
 *   - built-in file tools work only inside its folders.
 *
 * A refusal ends the run failed with its exact reason (refusals.js). A
 * self-test's outward commands are still skipped, and the bot carries on.
 *
 * `bot.strict`: true or false; left out, on for a bot whose team uses the
 * standard handoff (usesHandoffs).
 *
 *   isStrict(bot, team)          whether the bot runs strict
 *   capabilitiesBlock(p)         the "What you can do" block added to a
 *                                strict bot's instructions as it runs
 *   instructionCommands(text)    the shell commands its instructions name
 *   strictCommandWarnings(...)   the setup check's warnings: a command its
 *                                instructions name that isn't allowed
 *
 * Pure.
 */
"use strict";

const { BASICS, commandDecision } = require("../checks/commandRules");

const REFUSED_LINE =
  "Anything else is refused. If your task needs something not listed, stop and end your answer failed with what you needed. Don't try another way and don't ask.";

/** Does this bot run strict? Its own setting, else its team's handoff. */
function isStrict(bot, team = null) {
  if (!bot || typeof bot !== "object") return false;
  if (bot.strict === true) return true;
  if (bot.strict === false) return false;
  return !!(team && team.usesHandoffs === true);
}

const strings = (v) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

/**
 * The "What you can do" block: its provider tools by name, its allowed
 * commands, its folders (team values filled in), then the refused line.
 * @param {{ tools?: { [provider]: string[] }, commands?: string[],
 *           folders?: string[], builtins?: "none"|"read-only"|"all" }} p
 */
function capabilitiesBlock({
  tools = {},
  commands = [],
  folders = [],
  builtins = "all",
} = {}) {
  const providers = Object.entries(tools || {})
    .map(([name, list]) => [name, strings(list)])
    .filter(([, list]) => list.length)
    .sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    "WHAT YOU CAN DO (Dash runs this bot strict: only what's listed here works).",
    "Provider tools:",
    ...(providers.length
      ? providers.map(([name, list]) => `- ${name}: ${list.join(", ")}`)
      : ["- none"]),
  ];
  const cmds = builtins === "all" ? strings(commands) : [];
  lines.push(
    "Shell commands (each covers the command and anything after it):",
    ...(cmds.length ? cmds.map((c) => `- ${c}`) : ["- none"]),
  );
  if (cmds.length) {
    lines.push(
      `Also inside your folders: ${BASICS.join(", ")}, and 2>/dev/null or 2>&1.`,
      "Run one command per call: no &&, ;, || or |. The shell keeps its folder between calls.",
    );
  }
  const dirs = builtins === "none" ? [] : strings(folders);
  lines.push(
    "Folders (its file tools and commands work only inside these):",
    ...(dirs.length ? dirs.map((d) => `- ${d}`) : ["- none"]),
  );
  lines.push(REFUSED_LINE);
  return lines.join("\n");
}

// The commands a line of instructions may name. Kept to the ones a bot
// runs on a computer; a backticked command's first word must be one.
const KNOWN = [
  "git",
  "gh",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "node",
  "make",
  "docker",
  "curl",
  "wget",
  "python",
  "python3",
  "pip",
  "cargo",
  "go",
  "rm",
  "mv",
  "cp",
  "mkdir",
  "ls",
  "cat",
  "grep",
  "sed",
  "jq",
];
// In plain prose only these count: "make sure" or "go to" isn't a command.
const PLAIN = ["git", "gh", "npm", "npx", "yarn", "pnpm", "docker", "curl"];
const PLAIN_RE = new RegExp(
  `(?:^|[\\s(])((?:${PLAIN.join("|")})\\s+[a-z][\\w:.-]*)`,
  "g",
);

/**
 * The shell commands a bot's instructions name, as their first word or two:
 * each `backticked` command, and a known command in a plain line ("git
 * push", from a short list). Deterministic, and simple on purpose.
 */
function instructionCommands(text) {
  const out = [];
  const add = (c) => {
    const two = String(c || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")
      // A sentence's full stop or comma isn't part of it.
      .replace(/[.,;:!?)]+$/, "");
    const first = two.split(" ")[0];
    if (!KNOWN.includes(first)) return;
    if (!out.includes(two)) out.push(two);
  };
  const src = String(text || "");
  // Backticked, inline or fenced.
  for (const m of src.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  // Plain text: a known command and the word after it.
  const plain = src.replace(/`[^`\n]*`/g, " ");
  for (const m of plain.matchAll(PLAIN_RE)) add(m[1]);
  return out;
}

/**
 * The setup check's warnings for a strict bot: a command its instructions
 * name that its allowed commands don't cover. [] for a bot that isn't
 * strict, or has no built-in commands.
 * @returns {{ kind: "strict-command", bot, command, message }[]}
 */
function strictCommandWarnings(bot, team = null) {
  if (!isStrict(bot, team)) return [];
  if (bot.builtinTools === "none" || bot.builtinTools === "read-only") {
    return [];
  }
  const allowed = strings(bot.commands && bot.commands.allowed);
  const name = bot.name || "A bot";
  return instructionCommands(bot.instructions)
    .filter(
      (c) =>
        commandDecision(c, { allowed, blocked: [] }).decision !== "allowed",
    )
    .map((c) => ({
      kind: "strict-command",
      bot: name,
      command: c,
      message: `${name}'s instructions use "${c}", which isn't in its allowed commands, so its runs will be refused it: add it on the bot's Commands, or take it out of its instructions`,
    }));
}

module.exports = {
  REFUSED_LINE,
  isStrict,
  capabilitiesBlock,
  instructionCommands,
  strictCommandWarnings,
};
