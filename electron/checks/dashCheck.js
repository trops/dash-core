/**
 * dashCheck.js — how Dash runs @trops/dash-check checks (DASH-133).
 *
 * The library (primitives, helpers, recipes) knows nothing of Dash; this
 * file is the Dash side:
 *
 *   readOnlyTool      ctx.tool for a check: a provider tool that can't
 *                     change anything (the same rule as a tool check),
 *                     anything else refused
 *   startToolSocket   the same tool for a check in its own node, through
 *                     DASH_TOOL_SOCKET (one JSON line in, one back)
 *   runRecipe         a recipe in this process, in Dash's result shape
 *   runCheckFile      a .check.js file (its own node, the library's runner)
 *                     or a .check.json recipe that needs the repo's own
 *                     helpers (its own node too: repo code never runs in
 *                     Dash's process)
 *   listPalette       the helpers and matchers (the composer's palette),
 *                     plus a repo's own helpers from its base branch
 *
 * Results are { pass, reason, details }, details holding each check's and
 * each step's result.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { runCommand } = require("./kinds/command");
const { READ_NAME, parseAnswer } = require("./kinds/toolCall");
const { runEnv } = require("../bots/runEnv");

const LIB = "@trops/dash-check";
const SOURCE = LIB;
const MAX_DETAIL_FAILURES = 10;
const HELPER_ID_RE = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

/** The library, loaded when first used. */
const core = () => require("@trops/dash-check");
const recipeLib = () => require("@trops/dash-check/recipe");
const helpersLib = () => require("@trops/dash-check/helpers");

/** The library's register file: `node -r` it so a check's require works. */
function registerPath() {
  return require.resolve("@trops/dash-check/lib/register.js");
}

/** How to start a plain Node process: Electron as Node, or this Node. */
function nodeCommand() {
  if (process.versions.electron) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.execPath, env: {} };
}

const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * ctx.tool for a check: only a tool that can't change anything. Read-only
 * is what the caller's isReadOnly says (the provider's own hint, then the
 * tool's name), else the tool's name (READ_NAME), as a tool check.
 * @param {{ callTool?: (server, tool, args) => Promise<object>,
 *           isReadOnly?: (server, tool) => boolean }} deps
 */
function readOnlyTool(deps = {}) {
  return async (provider, name, args = {}) => {
    const server = String(provider || "");
    const tool = String(name || "");
    if (!server || !tool) throw new Error("Name the provider and the tool");
    const readOnly = deps.isReadOnly
      ? deps.isReadOnly(server, tool)
      : READ_NAME.test(tool);
    if (!readOnly) {
      throw new Error(
        `Not run: ${tool} could change something. A check only uses tools that can't.`,
      );
    }
    if (!deps.callTool) throw new Error("Tools can't be reached here");
    const result = await deps.callTool(server, tool, args || {});
    if (result && result.isError) {
      throw new Error(
        `${tool} answered with an error: ${String(result.text || "").slice(0, 300)}`,
      );
    }
    return parseAnswer(result);
  };
}

/**
 * Answer ctx.tool for a check in its own process: a local socket that
 * takes one JSON line { id, provider, tool, args } and answers
 * { id, result } or { id, error }.
 * @returns {Promise<{ path: string, close: () => Promise<void> }>}
 */
function startToolSocket(tool, { tmpDir } = {}) {
  const id = crypto.randomBytes(6).toString("hex");
  let dir = null;
  let where;
  if (process.platform === "win32") {
    where = `\\\\.\\pipe\\dash-tool-${id}`;
  } else {
    dir = fs.mkdtempSync(path.join(tmpDir || os.tmpdir(), "dash-tool-"));
    where = path.join(dir, "s");
  }
  const conns = new Set();
  const server = net.createServer((conn) => {
    conns.add(conn);
    conn.on("close", () => conns.delete(conn));
    conn.on("error", () => {});
    let buf = "";
    conn.on("data", async (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (_e) {
          conn.write(`${JSON.stringify({ id: null, error: "not JSON" })}\n`);
          continue;
        }
        let reply;
        try {
          const result = await tool(msg.provider, msg.tool, msg.args || {});
          reply = { id: msg.id, result: result === undefined ? null : result };
        } catch (e) {
          reply = { id: msg.id, error: (e && e.message) || String(e) };
        }
        try {
          conn.write(`${JSON.stringify(reply)}\n`);
        } catch (_e) {
          // The check went away.
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(where, () => {
      resolve({
        path: where,
        close: () =>
          new Promise((done) => {
            for (const c of conns) c.destroy();
            server.close(() => {
              if (dir) fs.rmSync(dir, { recursive: true, force: true });
              done();
            });
          }),
      });
    });
  });
}

/** Is a helper one of the library's own (not a repo's)? */
function isBuiltInHelper(id) {
  helpersLib();
  return core()
    .listHelpers()
    .some((h) => h.id === id && h.source === SOURCE);
}

/** A built-in helper by id, or null (a repo's own never load here). */
function builtInHelper(id) {
  return isBuiltInHelper(id) ? core().getHelper(id) : null;
}

/** The helper ids a recipe uses. */
function helpersUsed(recipe) {
  const steps = recipe && Array.isArray(recipe.steps) ? recipe.steps : [];
  return steps.filter((s) => s && typeof s.use === "string").map((s) => s.use);
}

/**
 * What's wrong with a recipe, or null. Only the library's helpers count
 * unless `repoHelpers` (a recipe in a repo can use its own).
 */
function recipeError(recipe, { repoHelpers = false } = {}) {
  const v = recipeLib().validateRecipe(recipe, { getHelper: builtInHelper });
  if (v.valid) return null;
  // A repo's own helper is checked when it runs, with the repo's files.
  const steps = recipe && Array.isArray(recipe.steps) ? recipe.steps : [];
  const theirs = new Set(
    repoHelpers
      ? steps
          .map((s, i) =>
            s &&
            typeof s.use === "string" &&
            HELPER_ID_RE.test(s.use) &&
            !isBuiltInHelper(s.use)
              ? `steps[${i}]`
              : null,
          )
          .filter(Boolean)
      : [],
  );
  const errors = v.errors.filter(
    (e) => ![...theirs].some((p) => e.path === p || e.path.startsWith(`${p}.`)),
  );
  if (!errors.length) return null;
  return errors
    .slice(0, 5)
    .map((e) => `${e.path ? `${e.path}: ` : ""}${e.message}`)
    .join("; ");
}

/** A failure, for details. */
function failureOf(f) {
  return {
    message: f.message,
    ...(f.at ? { at: f.at } : {}),
    ...("expected" in f ? { expected: f.expected } : {}),
    ...("received" in f ? { received: f.received } : {}),
  };
}

/** The library's result as Dash's: { pass, reason, details }. */
function resultOf(res, extra = {}) {
  const r = res || {};
  const checks = (r.checks || []).map((c) => ({
    name: c.name,
    pass: c.pass,
    ...(c.skipped ? { skipped: true } : {}),
    reason: c.reason,
    ...(c.failures && c.failures.length
      ? {
          failures: c.failures.slice(0, MAX_DETAIL_FAILURES).map(failureOf),
        }
      : {}),
  }));
  const steps = Array.isArray(r.steps)
    ? r.steps.map((s) => ({
        index: s.index,
        label: s.label,
        ...(s.sentence ? { sentence: s.sentence } : {}),
        pass: s.pass,
        ...(s.skipped ? { skipped: true } : {}),
        reason: s.reason,
        ...(s.failures && s.failures.length
          ? {
              failures: s.failures.slice(0, MAX_DETAIL_FAILURES).map(failureOf),
            }
          : {}),
      }))
    : null;
  return {
    pass: r.pass === true,
    reason: String(r.reason || (r.pass ? "Passed" : "Failed")),
    details: {
      ...extra,
      checks,
      ...(steps ? { steps } : {}),
      ...(r.errors && r.errors.length ? { errors: r.errors } : {}),
    },
  };
}

/** The environment a check gets: the user's PATH, Dash's DASH_* and sign-in. */
function checkEnv(env) {
  return { ...runEnv(process.env), ...(env || {}) };
}

/**
 * Run a recipe in this process with the library's own helpers.
 * @param {object} recipe
 * @param {object} input   the standard input
 * @param {{ cwd: string, env?: object, callTool?, isReadOnly?,
 *           fetch?, now?, sleep?, only?: number[], extra?: object }} opts
 */
async function runRecipe(recipe, input, opts = {}) {
  const res = await recipeLib().runRecipe(recipe, input || {}, {
    cwd: opts.cwd,
    env: checkEnv(opts.env),
    getHelper: builtInHelper,
    tool: readOnlyTool(opts),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(Array.isArray(opts.only) ? { only: opts.only } : {}),
  });
  return resultOf(res, opts.extra || {});
}

// The runner a recipe that uses a repo's own helpers gets, in its own node:
// the repo's helpers (copied from where the check was read), then the recipe.
const RECIPE_CHILD = `"use strict";
const fs = require("fs");
const path = require("path");
const core = require("@trops/dash-check");
const recipe = require("@trops/dash-check/recipe");
const [file, root] = process.argv.slice(2);
(async () => {
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.log(JSON.stringify({ reason: path.basename(file) + " isn't valid JSON (" + e.message + ")" }));
    process.exit(1);
  }
  const found = core.loadHelpers({ cwd: root });
  for (const e of found.errors) console.error(e.source + " didn't load: " + e.error);
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(process.env.DASH_INPUT, "utf8"));
  } catch (_e) {
    input = {};
  }
  const res = await recipe.runRecipe(r, input, { cwd: process.cwd() });
  const text = core.report(res);
  if (text) console.log(text);
  console.log(core.lastLine(res));
  process.exit(res.pass ? 0 : 1);
})();
`;

/**
 * Run a check file in its own node: a .check.js file with the library's
 * runner, or a .check.json recipe that needs the repo's own helpers (found
 * under `root`/.dash/checks/helpers). It gets Dash's env, DASH_INPUT, its
 * input on stdin and, with tools, DASH_TOOL_SOCKET.
 * @param {string} file   the check's file (a temp copy)
 * @param {object} input
 * @param {{ cwd: string, env?: object, tmpDir?: string, timeoutSec?: number,
 *           root?: string, shown?: string, spawn?: Function,
 *           callTool?, isReadOnly? }} opts
 */
async function runCheckFile(file, input, opts = {}) {
  const node = nodeCommand();
  const register = registerPath();
  let args;
  let runner = null;
  if (/\.json$/i.test(file)) {
    runner = path.join(
      path.dirname(file),
      `.dash-recipe-runner-${Date.now()}.js`,
    );
    fs.writeFileSync(runner, RECIPE_CHILD);
    args = [runner, file, opts.root || path.dirname(file)];
  } else {
    args = [file];
  }
  const command = [node.command, "-r", register, ...args].map(quote).join(" ");
  let socket = null;
  if (opts.callTool) {
    try {
      socket = await startToolSocket(readOnlyTool(opts), {
        tmpDir: opts.tmpDir,
      });
    } catch (_e) {
      socket = null;
    }
  }
  try {
    const res = await runCommand(
      { command, timeoutSec: opts.timeoutSec, passWhen: { type: "exit0" } },
      input,
      {
        cwd: opts.cwd,
        tmpDir: opts.tmpDir,
        ...(opts.spawn ? { spawn: opts.spawn } : {}),
        env: {
          ...(opts.env || {}),
          ...node.env,
          ...(socket ? { DASH_TOOL_SOCKET: socket.path } : {}),
        },
      },
    );
    const said = /^(Passed|Failed) \(exit/.test(String(res.reason || ""));
    const d =
      res.details && typeof res.details === "object" ? res.details : null;
    return {
      ...res,
      reason: said && opts.shown ? `${opts.shown}: ${res.reason}` : res.reason,
      details: {
        ...(opts.shown ? { file: opts.shown } : {}),
        ...(d || {}),
        ...(!d || !Array.isArray(d.checks) ? { checks: [] } : {}),
      },
    };
  } finally {
    if (socket) await socket.close();
    if (runner) fs.rmSync(runner, { force: true });
  }
}

/** The palette: every built-in helper and matcher, with its metadata. */
function builtInPalette() {
  helpersLib();
  const c = core();
  return {
    helpers: c.listHelpers().filter((h) => h.source === SOURCE),
    matchers: c.expect.matchers(),
  };
}

// Lists a repo's own helpers, in its own node.
const LIST_CHILD = `"use strict";
const core = require("@trops/dash-check");
require("@trops/dash-check/helpers");
const found = core.loadHelpers({ cwd: process.argv[2] });
const helpers = core.listHelpers().filter((h) => h.source !== "@trops/dash-check");
console.log(JSON.stringify({ helpers, errors: found.errors }));
`;

/**
 * A repo's own helpers, loaded in their own node from `root`
 * (.dash/checks/helpers, a copy from the base branch).
 * @returns {Promise<{ helpers: object[], errors: object[] }>}
 */
async function repoHelpersAt(root, { tmpDir, cwd } = {}) {
  const node = nodeCommand();
  const runner = path.join(root, ".dash-list-helpers.js");
  fs.writeFileSync(runner, LIST_CHILD);
  try {
    const command = [node.command, "-r", registerPath(), runner, root]
      .map(quote)
      .join(" ");
    const res = await runCommand(
      { command, timeoutSec: 30, passWhen: { type: "exit0" } },
      {},
      { cwd: cwd || root, tmpDir, env: { ...node.env } },
    );
    const line = String(res.output || "")
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((l) => l.startsWith("{"));
    try {
      const v = JSON.parse(line);
      return {
        helpers: Array.isArray(v.helpers) ? v.helpers : [],
        errors: Array.isArray(v.errors) ? v.errors : [],
      };
    } catch (_e) {
      return {
        helpers: [],
        errors: [
          {
            source: ".dash/checks/helpers",
            error: `They didn't load: ${String(res.reason || "").slice(0, 300)}`,
          },
        ],
      };
    }
  } finally {
    fs.rmSync(runner, { force: true });
  }
}

const gitOut = (args, cwd) => {
  const r = require("child_process").spawnSync("git", args, {
    cwd,
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
};

/** A repo's base branch: origin/HEAD's, else origin/main or origin/master. */
function baseRefOf(cwd) {
  const head = gitOut(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    cwd,
  );
  const refs = [];
  if (head)
    refs.push(
      head
        .toString()
        .trim()
        .replace(/^refs\/remotes\//, ""),
    );
  refs.push("origin/main", "origin/master");
  return (
    refs.find((r) =>
      gitOut(["rev-parse", "--verify", "--quiet", `${r}^{commit}`], cwd),
    ) || null
  );
}

/**
 * The composer's palette (list_check_helpers): every built-in helper and
 * matcher with its metadata, and with `workspace` (a repo's folder) the
 * repo's own helpers, read from its base branch (the same rule as its
 * checks: the work on a branch can't add to them) and loaded in their own
 * node, never in Dash's.
 * @returns {Promise<{ helpers, matchers, repo?: { dir, ref, helpers,
 *                     errors } , error?: string }>}
 */
async function listPalette({ workspace = null, tmpDir } = {}) {
  const palette = builtInPalette();
  if (!workspace) return palette;
  const dir = String(workspace);
  if (!path.isAbsolute(dir) || !fs.existsSync(dir)) {
    return { ...palette, error: `${dir} isn't a folder on this computer` };
  }
  if (!gitOut(["rev-parse", "--is-inside-work-tree"], dir)) {
    return { ...palette, error: `${dir} isn't a git repo` };
  }
  const ref = baseRefOf(dir);
  if (!ref) {
    return {
      ...palette,
      error:
        "This repo has no base branch Dash can find (origin/HEAD, origin/main or origin/master)",
    };
  }
  const rel = ".dash/checks/helpers";
  const listing = gitOut(["ls-tree", "--name-only", `${ref}:${rel}`], dir);
  const files = (listing ? listing.toString().split("\n") : []).filter((f) =>
    /\.c?js$/.test(f),
  );
  if (!files.length) {
    return { ...palette, repo: { dir, ref, helpers: [], errors: [] } };
  }
  const out = fs.mkdtempSync(path.join(tmpDir || os.tmpdir(), "dash-helpers-"));
  try {
    fs.mkdirSync(path.join(out, rel), { recursive: true });
    for (const f of files) {
      const body = gitOut(["show", `${ref}:${rel}/${f}`], dir);
      if (body != null) fs.writeFileSync(path.join(out, rel, f), body);
    }
    const found = await repoHelpersAt(out, { tmpDir, cwd: dir });
    return { ...palette, repo: { dir, ref, ...found } };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

module.exports = {
  listPalette,
  baseRefOf,
  LIB,
  core,
  recipeLib,
  helpersLib,
  registerPath,
  nodeCommand,
  readOnlyTool,
  startToolSocket,
  isBuiltInHelper,
  builtInHelper,
  helpersUsed,
  recipeError,
  resultOf,
  checkEnv,
  runRecipe,
  runCheckFile,
  builtInPalette,
  repoHelpersAt,
  RECIPE_CHILD,
};
