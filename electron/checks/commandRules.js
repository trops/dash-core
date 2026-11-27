/**
 * commandRules.js
 *
 * Which shell commands may run (flows PRD, phases 2 and 5; G6). Some are
 * always blocked — for a command check and for any bot — whatever a list
 * allows: force pushes, a hard reset, removing folders recursively, pushing
 * straight to the main branch, and publishing a package. A bot can also
 * have its own allowed list; then nothing else runs without asking.
 *
 * Commands are split into parts (&&, ||, ;, |) and each part into words, so
 * flags can't hide (`rm -Rf`, `git -C . push -fu`, `npm --registry x
 * publish`). Anything the split can't see into — a background `&`, a new
 * line, `$(…)`, backticks, redirection, git's own config options — is
 * never allowed without asking.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

/** Words of one command part, quotes kept together. */
function words(part) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(part))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * The command with its quoted text masked, same length so positions match
 * (DASH-140). Inside '…' nothing can run; inside "…" only $, `, ( and {
 * are kept, so $(…) and ${…} still show. An unclosed quote is left as it
 * is: the shell wouldn't run it anyway.
 */
function masked(command) {
  const s = String(command || "");
  let out = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q === "'") {
      if (ch === "'") {
        q = null;
        out += ch;
      } else out += "_";
      continue;
    }
    if (q === '"') {
      if (ch === "\\" && i + 1 < s.length) {
        out += "__";
        i++;
      } else if (ch === '"') {
        q = null;
        out += ch;
      } else out += "$`({".includes(ch) ? ch : "_";
      continue;
    }
    if (ch === "\\" && i + 1 < s.length) {
      out += "__";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    out += ch;
  }
  return q ? s : out;
}

/** The parts of a chained command; a quoted ; | or && doesn't split it. */
function partsOf(command) {
  const s = String(command || "");
  const m = masked(s);
  const re = /\s*(?:&&|\|\||;|\|)\s*/g;
  const out = [];
  let last = 0;
  let x;
  while ((x = re.exec(m))) {
    out.push(s.slice(last, x.index));
    last = x.index + x[0].length;
  }
  out.push(s.slice(last));
  return out.map((p) => p.trim()).filter(Boolean);
}

// git's own options that come before its subcommand, and take a value.
const GIT_VALUE_OPTS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

/** The git subcommand and its arguments, past git's own options. */
function gitCommand(w) {
  let i = 1;
  const globals = [];
  while (i < w.length && w[i].startsWith("-")) {
    globals.push(w[i]);
    if (GIT_VALUE_OPTS.has(w[i]) && !w[i].includes("=")) {
      globals.push(w[i + 1]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return { sub: w[i] || "", args: w.slice(i + 1), globals };
}

const shortFlags = (args) =>
  args
    .filter((a) => /^-[A-Za-z]+$/.test(a))
    .flatMap((a) => a.slice(1).split(""));
const MAIN = /^(refs\/heads\/)?(main|master)$/i;

function partBlocked(part) {
  const w = words(part);
  const bin = (w[0] || "").replace(/^.*[\\/]/, "").toLowerCase();
  if (bin === "git") {
    const { sub, args } = gitCommand(w);
    if (sub === "push") {
      const flags = shortFlags(args);
      if (
        flags.includes("f") ||
        args.some((a) => /^--force(-with-lease|-if-includes)?(=|$)/.test(a))
      ) {
        return { id: "force-push", label: "git push --force" };
      }
      const refs = args.filter((a) => !a.startsWith("-"));
      // The remote, then refspecs: "+x" forces; a destination of main pushes to it.
      for (const ref of refs.slice(1)) {
        if (ref.startsWith("+"))
          return { id: "force-push", label: "git push --force" };
        const dest = ref.includes(":") ? ref.split(":").pop() : ref;
        if (MAIN.test(dest))
          return { id: "push-main", label: "pushing to the main branch" };
      }
    }
    if (sub === "reset" && args.includes("--hard")) {
      return { id: "reset-hard", label: "git reset --hard" };
    }
  }
  if (bin === "rm") {
    const flags = shortFlags(w.slice(1)).map((f) => f.toLowerCase());
    const recursive = flags.includes("r") || w.includes("--recursive");
    const force = flags.includes("f") || w.includes("--force");
    if (recursive && force) return { id: "rm-rf", label: "rm -rf" };
  }
  if (["npm", "yarn", "pnpm"].includes(bin) && w.slice(1).includes("publish")) {
    return { id: "publish", label: "publishing a package" };
  }
  return null;
}

/** The always-blocked rule a command breaks, or null. */
function blockedBy(command) {
  for (const part of partsOf(command)) {
    const b = partBlocked(part);
    if (b) return b;
  }
  return null;
}

// What the split can't see into: never allowed without asking.
const OPAQUE = /(^|[^&])&([^&]|$)|\n|\$\(|`|[<>]|\$\{/;

// A strict bot's basics (DASH-140): steps that only look around, allowed
// with its own list. Paths stay fenced: the folder fence still refuses an
// absolute or home path outside its folders, and a ".." here is refused.
const BASICS = [
  "cd",
  "pwd",
  "ls",
  "test",
  "[",
  "head",
  "tail",
  "wc",
  "echo",
  "true",
];
// Output thrown away (2>/dev/null, &>/dev/null) or joined (2>&1): taken out
// before the opaque test. Any other redirection still can't run.
const QUIET =
  /\s*(?:\d?>>?|&>>?)\s*\/dev\/null(?=\s|$|[;&|)])|\s*\d?>&\d(?=\s|$|[;&|)])/g;

/** A command with its quiet redirects taken out (DASH-140). */
function withoutQuiet(command) {
  return String(command || "").replace(QUIET, "");
}

/** One of the basics, with no ".." in its words. */
function isBasic(part) {
  const w = words(part);
  if (!BASICS.includes(w[0] || "")) return false;
  return !w.slice(1).some((x) => x.split(/[\\/]/).includes(".."));
}

/**
 * A command against a bot's own lists: blocked (always, or the bot's own
 * blocked list), allowed (every part on its allowed list), or ask.
 * @param {string} command
 * @param {{ allowed?: string[], blocked?: string[] }} lists  prefixes
 * @param {{ basics?: boolean }} [opts]  basics: a strict bot's (DASH-140):
 *   cd, ls, head… and quiet redirects pass with its allowed list, and a
 *   chained command (&&, ||, ;, |) comes back { decision: "ask", chained }
 * @returns {{ decision: "blocked"|"allowed"|"ask", reason?: string,
 *            always?: string, rule?: string }}
 */
function commandDecision(command, lists = {}, opts = {}) {
  const basics = !!(opts && opts.basics);
  const c = String(command || "").trim();
  const always = blockedBy(c);
  if (always) {
    return {
      decision: "blocked",
      reason: `${always.label} is always blocked`,
      // What it matched (DASH-115): an always-blocked rule.
      always: always.label,
    };
  }
  const parts = partsOf(c);
  const blocked = (lists.blocked || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  for (const p of parts) {
    const b = blocked.find((pre) => p === pre || p.startsWith(`${pre} `));
    if (b) {
      return {
        decision: "blocked",
        reason: `"${b}" is on this bot's blocked list`,
        // The blocked-list entry it matched (DASH-115).
        rule: b,
      };
    }
  }
  const allowed = (lists.allowed || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
  const seen = basics ? withoutQuiet(c).trim() : c;
  const seenParts = basics ? partsOf(seen) : parts;
  if (!allowed.length || !seenParts.length || OPAQUE.test(masked(seen)))
    return { decision: "ask" };
  // A strict bot runs one command per call (DASH-140): each step is seen
  // and checked on its own.
  if (basics && seenParts.length > 1) return { decision: "ask", chained: true };
  const all = seenParts.every((p) => {
    if (basics && isBasic(p)) return true;
    const w = words(p);
    // git's own config options can run anything: never on an allowed list.
    if (
      (w[0] || "") === "git" &&
      gitCommand(w).globals.some((g) =>
        /^(-c|--config-env|--exec-path)/.test(g),
      )
    ) {
      return false;
    }
    return allowed.some((pre) => p === pre || p.startsWith(`${pre} `));
  });
  return all ? { decision: "allowed" } : { decision: "ask" };
}

module.exports = { BASICS, blockedBy, commandDecision, masked, partsOf };
