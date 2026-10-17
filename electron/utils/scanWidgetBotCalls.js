/**
 * scanWidgetBotCalls.js — refuse widget packages that start the user's bots
 * directly (team-dashboards PRD TD-005 AC1, create-entry phase 4c).
 *
 * Widgets may only start a bot by publishing an event the user wired the
 * bot to ("Run on events"). A package whose code reaches `mainApi.bots`
 * (run, ask, pause… anything) is refused at install, before it's registered.
 * Dash's own bot widgets are built in, not packages, so this never sees them.
 *
 * What it catches: `mainApi.bots`, `mainApi?.bots`, `mainApi["bots"]`,
 * `mainApi['bots']`, and `{ bots } = …mainApi` destructuring. It reads every
 * .js/.jsx/.cjs/.mjs/.ts/.tsx file, `dist/` included (that's the code that
 * runs), skipping node_modules.
 *
 * Limitation (stated in the PRD): widgets share the app's window, so code
 * that builds the name at runtime could still reach it — the same is true
 * of every mainApi namespace. This blocks plain and AI-written use.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CODE_EXT = new Set([".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const PATTERNS = [
  /mainApi\s*(?:\?\.|\.)\s*bots\b/,
  /mainApi\s*(?:\?\.)?\s*\[\s*["'`]bots["'`]\s*\]/,
  /\{[^{}]*\bbots\b[^{}]*\}\s*=\s*[\w.?]*mainApi\b/,
];

/** Whether a piece of code reaches mainApi.bots. */
function callsBots(code) {
  const src = String(code || "");
  return PATTERNS.some((re) => re.test(src));
}

function* walk(dir, root) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full, root);
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
      yield full;
    }
  }
}

/**
 * @param {string} packageDir  the installed (extracted / copied) package
 * @returns {{ ok: boolean, files: string[] }}  files that reach mainApi.bots
 */
function scanWidgetBotCalls(packageDir) {
  const files = [];
  for (const file of walk(packageDir, packageDir)) {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch (_e) {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;
    let code = "";
    try {
      code = fs.readFileSync(file, "utf8");
    } catch (_e) {
      continue;
    }
    if (callsBots(code)) files.push(path.relative(packageDir, file));
  }
  return { ok: files.length === 0, files };
}

/** The refusal, in words. */
function botCallsMessage(widgetName, files) {
  return `${widgetName} wasn't installed: it starts your bots directly (${files
    .slice(0, 3)
    .join(
      ", ",
    )}). Widgets may only send events that you wire a bot to, under the bot's "Run on events".`;
}

/**
 * Throw when it calls bots. Never deletes the folder: it may be a
 * developer's own folder (Load a widget from a folder) or the installed
 * package (the publish check); an install's staged copy is removed by the
 * install itself (consolidation Phase 1a-2).
 * @param {string} widgetName
 * @param {string} packageDir
 */
function assertNoBotCalls(widgetName, packageDir) {
  const res = scanWidgetBotCalls(packageDir);
  if (res.ok) return;
  const err = new Error(botCallsMessage(widgetName, res.files));
  err.code = "WIDGET_CALLS_BOTS";
  throw err;
}

module.exports = {
  callsBots,
  scanWidgetBotCalls,
  assertNoBotCalls,
  botCallsMessage,
};
