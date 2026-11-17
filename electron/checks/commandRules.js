/**
 * commandRules.js
 *
 * Which shell commands may run (flows PRD, phases 2 and 5; G6). Some are
 * always blocked — for a command check and for any bot — whatever a list
 * allows: force pushes, a hard reset, removing folders recursively, pushing
 * straight to the main branch, and publishing a package. A bot can also
 * have its own allowed list; then nothing else runs without asking.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const ALWAYS_BLOCKED = [
  {
    id: "force-push",
    label: "git push --force",
    test: (c) =>
      /\bgit\s+push\b[^;&|]*(\s--force(-with-lease)?\b|\s-f\b|\s\+[\w./-]+)/.test(
        c,
      ),
  },
  {
    id: "reset-hard",
    label: "git reset --hard",
    test: (c) => /\bgit\s+reset\b[^;&|]*\s--hard\b/.test(c),
  },
  {
    id: "rm-rf",
    label: "rm -rf",
    test: (c) =>
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/.test(
        c,
      ),
  },
  {
    id: "push-main",
    label: "pushing to the main branch",
    test: (c) =>
      /\bgit\s+push\b[^;&|]*\s(origin\s+)?(HEAD:)?(refs\/heads\/)?(main|master)\b/.test(
        c,
      ),
  },
  {
    id: "publish",
    label: "publishing a package",
    test: (c) => /\b(npm|yarn|pnpm)\s+publish\b/.test(c),
  },
];

/** The always-blocked rule a command breaks, or null. */
function blockedBy(command) {
  const c = String(command || "");
  for (const rule of ALWAYS_BLOCKED) {
    if (rule.test(c)) return rule;
  }
  return null;
}

/**
 * A command against a bot's own lists: blocked (always, or the bot's own
 * blocked list), allowed (on its allowed list), or ask.
 * @param {string} command
 * @param {{ allowed?: string[], blocked?: string[] }} lists  prefixes
 * @returns {{ decision: "blocked"|"allowed"|"ask", reason?: string }}
 */
function commandDecision(command, lists = {}) {
  const c = String(command || "").trim();
  const always = blockedBy(c);
  if (always) {
    return { decision: "blocked", reason: `${always.label} is always blocked` };
  }
  // Each part of a chained command is judged on its own.
  const parts = c
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const blocked = (lists.blocked || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  for (const p of parts) {
    const b = blocked.find((pre) => p === pre || p.startsWith(`${pre} `));
    if (b)
      return {
        decision: "blocked",
        reason: `"${b}" is on this bot's blocked list`,
      };
  }
  const allowed = (lists.allowed || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (!allowed.length || !parts.length) return { decision: "ask" };
  const all = parts.every((p) =>
    allowed.some((pre) => p === pre || p.startsWith(`${pre} `)),
  );
  return all ? { decision: "allowed" } : { decision: "ask" };
}

module.exports = { ALWAYS_BLOCKED, blockedBy, commandDecision };
