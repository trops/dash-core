/**
 * runEnv.js — the environment a bot's commands run in (DASH-53, Code
 * Factory G2).
 *
 * Dash started from the Dock gets the Mac app's bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin): no Homebrew, no nvm's node. A bot's shell
 * commands and its command checks must find the same tools the user's
 * Terminal does, so they get the login shell's PATH (looked up once, as the
 * Assistant's CLI backend does), with the app's own PATH and Homebrew's
 * folders after it. A command that still isn't there is named plainly —
 * "Needs `git`" — instead of failing in some confusing way later.
 */
"use strict";

const { execSync } = require("child_process");

// Where tools are installed when the login shell doesn't say (or can't run).
const FALLBACK_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

let cached = null;
let lookup = null;

/** The login shell's PATH, or "" when it can't be read. */
function loginShellPath({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (platform === "win32") return env.PATH || "";
  const shell = env.SHELL || "/bin/zsh";
  try {
    return execSync(`${shell} -ilc 'printf %s "$PATH"'`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_e) {
    return "";
  }
}

/** PATH lists joined, each folder once, in order. */
function mergePaths(lists, sep = ":") {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const dir of String(list || "").split(sep)) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      out.push(dir);
    }
  }
  return out.join(sep);
}

/**
 * The PATH bots' commands run with: the login shell's, then the app's own,
 * then Homebrew's folders. Looked up once per app session.
 */
function runPath({ env = process.env, platform = process.platform } = {}) {
  if (cached !== null) return cached;
  if (platform === "win32") {
    cached = env.PATH || "";
    return cached;
  }
  const login = lookup ? lookup() : loginShellPath({ env, platform });
  cached = mergePaths([login, env.PATH, FALLBACK_DIRS.join(":")]);
  return cached;
}

/** `base` with PATH set to runPath(). */
function runEnv(base = process.env) {
  return { ...base, PATH: runPath({ env: base }) };
}

// "zsh: command not found: git", "bash: git: command not found",
// "/bin/sh: git: not found", "sh: 1: git: not found", "env: node: No such file or directory"
const NOT_FOUND = [
  /command not found:\s*([^\s:'"`]+)/i,
  /(?:^|[\s/])([A-Za-z0-9._+-]+):\s*command not found/im,
  /(?:^|\s)(?:\/bin\/)?(?:sh|bash|zsh|dash)(?::\s*\d+)?:\s*([A-Za-z0-9._+-]+):\s*not found/im,
  /env:\s*'?([A-Za-z0-9._+-]+)'?:\s*No such file or directory/i,
];

/** The command a shell said isn't installed, or null. */
function missingTool(text) {
  const s = String(text || "");
  for (const re of NOT_FOUND) {
    const m = s.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** What the user sees when a tool isn't installed. */
function needsMessage(tool) {
  return `Needs \`${tool}\`: it isn't installed on this computer (or isn't on its PATH). Install it and run again.`;
}

/** Test seam: replace the login-shell lookup and forget the cached PATH. */
function __setLoginLookupForTest(fn) {
  lookup = fn;
  cached = null;
}

module.exports = {
  runPath,
  runEnv,
  mergePaths,
  missingTool,
  needsMessage,
  FALLBACK_DIRS,
  __setLoginLookupForTest,
};
