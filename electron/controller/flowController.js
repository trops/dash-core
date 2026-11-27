/**
 * flowController.js
 *
 * The host for a bot's own checks (bot-checks PRD): each held run is a job
 * on the dashboard's ledger, following a small flow made from the bot's
 * checks (botChecks.checksFlow). The flow runner moves those jobs on — it
 * runs the bot again, runs each check, waits for you — on every ledger
 * change and on a slow tick.
 *
 * Bots aren't kept here: botController hands in how to run and find them,
 * call a read-only tool, and write a script check (useBots).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFlowRunner } = require("../flows/flowRunner");
const { runCheck } = require("../checks/checkRunner");
const { fetchStatus } = require("../checks/linkStatus");
const goalController = require("./goalController");
const { isChecksFlow } = require("../bots/botChecks");
const { gitSignInEnv } = require("../bots/gitSignIn");
const { contextEnv } = require("../jobs/jobContext");

let runner = null;
let offGoals = null;
let tick = null;
let bots = {
  runBot: async () => ({ skipped: true, reason: "Bots aren't ready yet" }),
  isBusy: () => false,
  getBot: () => null,
  gitToken: async () => null,
  callTool: async () => ({ isError: true, text: "Tools aren't ready yet" }),
  isReadOnlyTool: () => false,
  readOnlyTools: async () => [],
  writeScript: async () => ({ error: "Bots aren't ready yet" }),
};

const goals = () => goalController.store();

/** Files a goal's steps share, relative to its work folder. */
function filesOf(goalId) {
  const g = goals();
  const p = g && g.paths(goalId);
  if (!p) return [];
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3 || out.length >= 200) return;
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const d of names) {
      if (d.name.startsWith(".") || d.name === "node_modules") continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r, depth + 1);
      else out.push(r);
    }
  };
  walk(p.work, "", 0);
  return out;
}

/** What a check needs to run for a job: its folder, scripts and tools. */
async function checkContext(goal, step) {
  const g = goals();
  // The job's work item and workspace (DASH-100): its checks run in the
  // workspace, and get both in their input and environment.
  const jobContext =
    goal && goal.id && bots.jobContext ? bots.jobContext(goal.id) : null;
  const ctxInput = {};
  if (jobContext && jobContext.item) ctxInput.item = jobContext.item;
  if (jobContext && jobContext.workspace) {
    ctxInput.workspace = jobContext.workspace;
  }
  const ws =
    jobContext && jobContext.workspace && jobContext.workspace.dir
      ? jobContext.workspace.dir
      : null;
  // Else a bot's own checks run in its first folder, where its work is —
  // filled from its job (DASH-100), so a {repo.*} or {workspace.*} folder
  // is the job's.
  let own = null;
  if (ws && fs.existsSync(ws)) {
    own = ws;
  } else if (goal && goal.flow && goal.flow.botId) {
    const bot = bots.getBot
      ? bots.getBot(goal.flow.botId, { goalId: goal.id })
      : null;
    const first = bot && Array.isArray(bot.projects) ? bot.projects[0] : null;
    if (first && fs.existsSync(first)) own = first;
  }
  const folder = own || (g && goal && goal.id ? g.paths(goal.id).work : null);
  const ctxEnv = contextEnv(jobContext || {});
  // Which step is running (DASH-102), for a check shared by several.
  if (step && step.name) ctxEnv.DASH_STEP = String(step.name);
  // A bot's command checks sign git and gh in like its own commands
  // (DASH-66): its GitHub provider's token, for that check only, and taken
  // out of what the check keeps.
  let token = null;
  if (goal && goal.flow && goal.flow.botId && bots.gitToken) {
    try {
      token = await bots.gitToken(goal.flow.botId);
    } catch (_e) {
      token = null;
    }
  }
  const signIn = token ? gitSignInEnv(token, process.env) : null;
  const env =
    signIn || Object.keys(ctxEnv).length
      ? { ...(signIn || {}), ...ctxEnv }
      : null;
  return {
    ...(env ? { env } : {}),
    ...(token ? { secret: token } : {}),
    ...(Object.keys(ctxInput).length ? { jobContext: ctxInput } : {}),
    // The job's files reach a command through its input, never through a
    // path written into the command.
    cwd: folder,
    tmpDir: os.tmpdir(),
    fetchStatus,
    callTool: (server, tool, args) =>
      bots.callTool(server, tool, args, goal ? goal.workspaceId : null),
    isReadOnly: (server, tool) => bots.isReadOnlyTool(server, tool),
    readScript: (ref) => readScriptRef(ref),
  };
}

/** A script check's file on this computer ("local:/path/to/check.js"). */
function readScriptRef(ref) {
  const r = String(ref || "");
  if (!r.startsWith("local:")) return null;
  try {
    return fs.readFileSync(r.slice(6), "utf8");
  } catch (_e) {
    return null;
  }
}

/**
 * Jobs that followed a flow (not a bot's own checks) can't run any more —
 * flows are gone (DASH-13) — so they're deleted, once, when the runner
 * starts. Returns the ids deleted.
 */
function dropOldFlowJobs() {
  const s = goals();
  if (!s || typeof s.listGoals !== "function") return [];
  const old = s
    .listGoals()
    .filter((g) => g && g.flow && !isChecksFlow(g.flow))
    .map((g) => g.id);
  if (!old.length) return [];
  const r = goalController.delete(old);
  return (r && r.deleted) || [];
}

function startRunner() {
  if (runner) return runner;
  try {
    dropOldFlowJobs();
  } catch (_e) {
    // They can't run either way; the list skips them.
  }
  runner = createFlowRunner({
    store: goals(),
    runBot: (botId, opts) => bots.runBot(botId, opts),
    isBusy: (botId) => bots.isBusy(botId),
    runCheck: (check, input, ctx) => runCheck(check, input, ctx),
    filesOf,
    checkContext,
  });
  if (offGoals) offGoals();
  offGoals = goalController.onChange(() => runner.schedule());
  if (tick) clearInterval(tick);
  // Slow tick: a paused bot resumed, a busy bot freed up.
  tick = setInterval(() => runner.schedule(), 20 * 1000);
  if (tick.unref) tick.unref();
  runner.start();
  return runner;
}

const ok = (x) => ({ ok: true, ...x });

const flowController = {
  dropOldFlowJobs,
  /**
   * Kept for the app's setup call; there's nothing to open (a bot's checks
   * live on the bot, its jobs on the goals ledger).
   * @param {{ getWindows?: () => BrowserWindow[] }} _deps
   */
  init(_deps = {}) {
    if (runner || !goals()) return;
    // The bots arrived first (useBots): start moving their jobs now.
    if (bots.ready) startRunner();
  },

  /** How to run and find bots (botController), then start moving work. */
  useBots(hooks = {}) {
    bots = { ...bots, ...hooks, ready: true };
    if (goals()) startRunner();
  },

  /**
   * "Write it with AI": the dashboard's lead writes a script check's
   * function once, from what it should check and the fields it gets. It
   * comes back to read before it's saved; it runs without AI.
   */
  async writeScript(workspaceId, { ask = "", fields = [] } = {}) {
    if (!String(ask || "").trim())
      return { error: "Say what it should check." };
    try {
      const r = await bots.writeScript(workspaceId, ask, fields);
      if (!r || r.error)
        return { error: (r && r.error) || "No script came back." };
      if (!/function\s+check\s*\(/.test(r.script || "")) {
        return {
          error:
            "What came back isn't a check function. Try saying it another way.",
        };
      }
      return { ok: true, script: r.script };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  /** Read-only tools a tool call check may use, per connected provider. */
  async readOnlyTools(workspaceId) {
    try {
      return ok({ servers: await bots.readOnlyTools(workspaceId) });
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  /** For tests and a clean quit: stop moving work on. */
  stop() {
    if (runner) runner.stop();
    if (tick) clearInterval(tick);
    tick = null;
    if (offGoals) offGoals();
    offGoals = null;
    runner = null;
  },
};

module.exports = flowController;
