/**
 * folderFence.js — a bot's "Folders it works in" as a boundary (DASH-47).
 *
 * A bot with folders may read, change and run commands only inside them (and
 * its own sandbox / the run's working folder). File tools are checked
 * strictly: the path is resolved through `..` and symlinks before it is
 * compared. Shell commands are checked as far as their text allows: every
 * `cd`/`pushd` target and every absolute or home path in the command must be
 * inside; a variable, `..` or `~` it can't follow counts as outside.
 *
 * A bot without folders has no fence: everything here returns null and the
 * engine behaves as before.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { partsOf } = require("../../checks/commandRules");

// Built-ins that take a path, and the input field(s) it's in.
const FILE_TOOL_FIELDS = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  Grep: ["path"],
};

// Paths a command may always name: they read or write nothing of the user's.
const SAFE_PATHS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);

/**
 * The path as the file system sees it: `..` resolved and symlinks followed on
 * the part that exists (a file about to be written doesn't yet).
 */
function realPath(p) {
  let abs = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(abs), ...rest.reverse());
    } catch (_e) {
      const parent = path.dirname(abs);
      if (parent === abs) return path.resolve(p);
      rest.push(path.basename(abs));
      abs = parent;
    }
  }
}

/**
 * The fence for a run: its folders (absolute ones only) plus the run's
 * working folder. null when the bot has no folders.
 * @param {{ projects?: string[], workingDir?: string }} ctx
 */
function makeFence(ctx) {
  const projects = Array.isArray(ctx && ctx.projects)
    ? ctx.projects.filter((p) => typeof p === "string" && path.isAbsolute(p))
    : [];
  if (!projects.length) return null;
  const dirs = [...projects];
  if (ctx.workingDir && path.isAbsolute(ctx.workingDir)) {
    dirs.push(ctx.workingDir);
  }
  const roots = [...new Set(dirs.map(realPath))];
  return {
    projects,
    roots,
    cwd: ctx.workingDir || projects[0],
    label: projects.join(", "),
  };
}

function isInside(fence, p) {
  const r = realPath(p);
  return fence.roots.some(
    (root) => r === root || r.startsWith(root + path.sep),
  );
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "$HOME" || p === "${HOME}") return os.homedir();
  if (p.startsWith("$HOME/")) return path.join(os.homedir(), p.slice(6));
  if (p.startsWith("${HOME}/")) return path.join(os.homedir(), p.slice(8));
  return p;
}

/**
 * The first path a file tool would touch outside the fence, or null.
 * A relative path is taken from the run's working folder; a Glob/Grep with
 * no path searches the working folder.
 */
function fileToolOutside(fence, toolName, input) {
  if (!fence) return null;
  const fields = FILE_TOOL_FIELDS[toolName];
  if (!fields) return null;
  const targets = [];
  for (const f of fields) {
    const v = input && input[f];
    if (typeof v === "string" && v) targets.push(v);
  }
  // An absolute Glob pattern names its own folder: check the part before
  // the first wildcard.
  if (toolName === "Glob" && input && typeof input.pattern === "string") {
    const pat = expandHome(input.pattern);
    if (path.isAbsolute(pat)) {
      const fixed = pat.split(/[*?[{]/)[0];
      targets.push(fixed.endsWith(path.sep) ? fixed : path.dirname(fixed));
    }
  }
  if (!targets.length && (toolName === "Glob" || toolName === "Grep")) {
    targets.push(fence.cwd);
  }
  for (const t of targets) {
    const p = expandHome(t);
    const abs = path.isAbsolute(p) ? p : path.resolve(fence.cwd, p);
    if (!isInside(fence, abs)) return t;
  }
  return null;
}

// Strip one layer of matching quotes.
function unquote(w) {
  if (w.length >= 2 && (w[0] === '"' || w[0] === "'") && w.endsWith(w[0])) {
    return w.slice(1, -1);
  }
  return w;
}

function wordsOf(part) {
  return (part.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote);
}

/**
 * The first thing in a shell command that reaches outside the fence, or
 * null: a `cd`/`pushd` target, or an absolute or home path anywhere in it.
 */
function bashOutside(fence, command) {
  if (!fence || typeof command !== "string") return null;
  for (const part of partsOf(command)) {
    const w = wordsOf(part);
    if (w[0] === "cd" || w[0] === "pushd") {
      const target = w[1] === undefined ? "~" : w[1];
      const t = expandHome(target);
      if (path.isAbsolute(t)) {
        if (!isInside(fence, t)) return target;
      } else if (
        t === "-" ||
        t.startsWith("$") ||
        t.split(/[\\/]/).includes("..")
      ) {
        // Somewhere it can't follow: a variable, the last folder, or up.
        return target;
      }
    }
  }
  // Every absolute or home path named anywhere in the command, including
  // after `=` (--out=/x) and redirections (>/tmp/x).
  const re =
    /(?:^|[\s=:'"(<>|;&])((?:~|\$HOME|\$\{HOME\})?\/[^\s'"();|&<>`]*|~(?=[\s'"();|&<>]|$))/g;
  let m;
  while ((m = re.exec(command))) {
    const raw = m[1];
    if (!raw || SAFE_PATHS.has(raw)) continue;
    // A bare "/" inside a word ("a/b") isn't matched: the class above needs
    // a separator first. URLs ("https://x") aren't paths.
    if (/^\/\//.test(raw)) continue;
    const p = expandHome(raw);
    if (!path.isAbsolute(p)) continue;
    if (!isInside(fence, p)) return raw;
  }
  return null;
}

// Shell commands that send something off this computer. On a run its lead
// started, an "allow" bot still asks before these (DASH-29), unless the
// command is on its own allowed list.
const SEND_COMMANDS = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "nc",
  "ncat",
  "telnet",
  "ftp",
]);
// gh subcommands that only look.
const GH_LOOKS =
  /^gh\s+(pr|issue|run|repo|release)\s+(view|list|checks|diff|status)\b/;

function bashSends(command) {
  if (typeof command !== "string") return false;
  for (const part of partsOf(command)) {
    const w = wordsOf(part);
    // Leading VAR=value assignments.
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift();
    const cmd = path.basename(w[0] || "");
    if (SEND_COMMANDS.has(cmd)) return true;
    if (cmd === "git" && w.includes("push")) return true;
    if (cmd === "gh" && !GH_LOOKS.test(w.join(" "))) return true;
  }
  return false;
}

/**
 * Is this an `rm -r`/`rm -rf` of folders strictly inside the fence, and
 * nothing else (DASH-54)? An unattended bot cleans up its own work this way
 * (the Code Factory deletes a ticket's clone). Only one command, only
 * absolute or home paths — no relative ones (the shell's folder can have
 * moved), no wildcards, variables or "..", and never a fence folder itself.
 */
function rmInside(fence, command) {
  if (!fence || typeof command !== "string") return false;
  const parts = partsOf(command);
  if (parts.length !== 1 || /[`$*?[{\n;&|<>]/.test(command)) return false;
  const w = wordsOf(parts[0]);
  if (w[0] !== "rm") return false;
  let endOfFlags = false;
  const targets = [];
  for (const word of w.slice(1)) {
    if (!endOfFlags && word === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && word.startsWith("-")) {
      if (!/^-[rRfdv]+$|^--(recursive|force|verbose)$/.test(word)) return false;
      continue;
    }
    targets.push(word);
  }
  if (!targets.length) return false;
  return targets.every((t) => {
    const p = expandHome(t);
    if (!path.isAbsolute(p) || p.split(/[\\/]/).includes("..")) return false;
    const r = realPath(p);
    if (fence.roots.includes(r)) return false;
    return isInside(fence, p);
  });
}

module.exports = {
  FILE_TOOL_FIELDS,
  makeFence,
  fileToolOutside,
  bashOutside,
  bashSends,
  rmInside,
  realPath,
};
