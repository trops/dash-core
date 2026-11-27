/**
 * refusals.js — what Dash refused a bot in a run, why, and the fix
 * (DASH-115). A bot never asks the user, in prose, to grant it something:
 * its setup is the answer. A command or tool its setup doesn't allow ends
 * the run failed with an exact reason, and the job shows it with a way to
 * the bot's settings at the right section.
 *
 *   refusal: { kind, what, why, fix, section, rule?, server?, message,
 *              test? }
 *     kind     "command" (a shell command) or "tool" (a built-in or
 *              provider tool)
 *     what     the exact command, or the tool (and its args), capped
 *     why      the reason, in words
 *     fix      what to change, and where
 *     section  the bot's settings section to open: "commands", "folders",
 *              "tools" (built-in tools) or "providers"
 *     rule     the blocked-list entry it matched ("git push")
 *     test     a self-test's own block (DASH-109): expected, not a failure
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const MAX_WHAT = 300;
const MAX_KEPT = 10;

// Tokens and passwords never stay in what's recorded.
const SECRET =
  /\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[abprs]-[A-Za-z0-9-]{6,}|sk-[A-Za-z0-9_-]{10,})\b/g;
const URL_AUTH = /(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g;

/** A command or tool's args, one line, secrets hidden, capped. */
function cleanWhat(text) {
  const t = String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .replace(SECRET, "•••")
    .replace(URL_AUTH, "$1•••@");
  return t.length > MAX_WHAT ? `${t.slice(0, MAX_WHAT - 1)}…` : t;
}

function argsText(input) {
  if (input == null) return "";
  try {
    const s = JSON.stringify(input);
    return s === "{}" ? "" : s;
  } catch (_e) {
    return "";
  }
}

const SECTION_WORDS = {
  commands: "Commands",
  folders: "Folders",
  tools: "Built-in tools",
  providers: "Providers",
};

/**
 * A refusal, with its reason and fix, from what the engine or gate saw.
 * @param {{ reason: string, botName?: string, command?: string,
 *           tool?: string, server?: string, input?: any, rule?: string,
 *           label?: string, folders?: string, detail?: string }} r
 *   reason: "always-blocked" | "blocked-list" | "not-allowed" |
 *           "outside-folders" | "no-folders" | "no-builtins" | "read-only" |
 *           "not-available" | "not-its-tool" | "not-its-provider" |
 *           "provider-missing"
 */
function makeRefusal(r = {}) {
  const bot = r.botName || "This bot";
  const isCommand = typeof r.command === "string" && r.command.trim() !== "";
  const what = isCommand
    ? cleanWhat(r.command)
    : cleanWhat(
        [r.tool || "a tool", argsText(r.input)].filter(Boolean).join(" "),
      );
  let why;
  let fix;
  let section;
  switch (r.reason) {
    case "always-blocked":
      why = `${r.label || "it"} is always blocked for bots`;
      fix =
        "Dash never runs it for a bot: change the bot's instructions so it does this another way.";
      section = "commands";
      break;
    case "blocked-list":
      why = `it's on the bot's blocked commands ("${r.rule}")`;
      fix = `Take "${r.rule}" off the bot's Commands, or give it a provider tool that does this.`;
      section = "commands";
      break;
    case "not-allowed":
      why = "it isn't in the bot's allowed commands";
      fix =
        "Add it on the bot's Commands, or give it a provider tool that does this.";
      section = "commands";
      break;
    case "outside-folders":
      why = `${r.detail ? `${r.detail} is` : "it's"} outside the bot's folders (${r.folders || "none"})`;
      fix =
        "Add the folder on the bot's Folders, or change its instructions to keep the work inside them.";
      section = "folders";
      break;
    case "no-folders":
      why = "it's unattended and has no folders to work in";
      fix = "Give it the folders it works in, on the bot's Folders.";
      section = "folders";
      break;
    case "no-builtins":
      why = "the bot has no built-in tools";
      fix = "Turn on its Built-in tools, or give it a provider tool for this.";
      section = "tools";
      break;
    case "read-only":
      why = "the bot's built-in tools only read";
      fix =
        'Set its Built-in tools to "All", or give it a provider tool for this.';
      section = "tools";
      break;
    case "not-available":
      why = "that built-in tool isn't available to bots";
      fix = "Give it a provider tool for this.";
      section = "providers";
      break;
    case "not-its-tool":
      why = `it isn't one of the bot's tools${r.server ? ` on ${r.server}` : ""}`;
      fix = `Add the tool to the bot's ${r.server || "provider"} tools, on its Providers.`;
      section = "providers";
      break;
    case "not-its-provider":
      why = `${r.server ? `${r.server} isn't` : "its provider isn't"} one of the bot's providers`;
      fix = "Add the provider, with this tool, on the bot's Providers.";
      section = "providers";
      break;
    case "provider-missing":
      why = r.server
        ? `${r.server} isn't set up or signed in on this computer`
        : "no provider on this computer has that tool";
      fix =
        "Add or sign in to the provider in Settings › Providers, then give it to the bot on its Providers.";
      section = "providers";
      break;
    default:
      why = r.detail || "Dash refused it";
      fix = "Check the bot's settings.";
      section = isCommand ? "commands" : "providers";
  }
  const verb = isCommand ? "run" : "use";
  const message = `${bot} can't ${verb} \`${what}\`: ${why}. ${fix}`;
  return {
    kind: isCommand ? "command" : "tool",
    what,
    why,
    fix,
    section,
    ...(r.rule ? { rule: String(r.rule) } : {}),
    ...(r.server ? { server: String(r.server) } : {}),
    ...(r.test ? { test: true } : {}),
    message,
  };
}

/** The words of the settings section a refusal opens: "Commands". */
function sectionWords(section) {
  return SECTION_WORDS[section] || "settings";
}

/** Refusals kept on a run: a few, each one once. */
function keepRefusal(list, refusal) {
  const out = Array.isArray(list) ? list : [];
  if (!refusal || out.length >= MAX_KEPT) return out;
  if (out.some((x) => x.what === refusal.what && x.why === refusal.why)) {
    return out;
  }
  out.push(refusal);
  return out;
}

const norm = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The recorded refusal a question is about, or null. Deterministic: the
 * question holds the refused command or tool as recorded, the blocked-list
 * entry it matched, or the command's first two words ("git push"). Never a
 * guess from what the prose seems to mean.
 */
function refusalAsked(question, refusals) {
  const q = norm(question);
  if (!q) return null;
  for (const r of Array.isArray(refusals) ? refusals : []) {
    if (!r || !r.what) continue;
    const keys = [];
    if (r.kind === "command") {
      keys.push(r.what);
      if (r.rule) keys.push(r.rule);
      const two = String(r.what).split(/\s+/).slice(0, 2).join(" ");
      if (two.includes(" ")) keys.push(two);
    } else {
      // The tool's name, without its args.
      keys.push(String(r.what).split(" ")[0]);
    }
    if (keys.map(norm).some((k) => k.length >= 3 && q.includes(k))) return r;
  }
  return null;
}

module.exports = {
  MAX_WHAT,
  makeRefusal,
  keepRefusal,
  refusalAsked,
  sectionWords,
  cleanWhat,
};
