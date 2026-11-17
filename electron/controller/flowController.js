/**
 * flowController.js
 *
 * A dashboard's flows (flows PRD): stored under `<userData>/flows/`, run by
 * the flow runner, told to every window when they change (FLOWS_CHANGED).
 * The renderer's Graph tab reads them, sets steps and checks up, tries a
 * check on the last real record, makes a flow from a starter or the Dash
 * Lead's proposal, and starts goals in a flow.
 *
 * Bots aren't kept here: botController hands in how to run, find, make and
 * delete them (useBots).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFlowStore } = require("../flows/flowStore");
const { createFlowRunner } = require("../flows/flowRunner");
const {
  chain,
  stepById,
  inputStep,
  insertBetween,
  removeStep,
  briefLine,
  normalizeFlow,
} = require("../flows/flowModel");
const { flowWarnings, flowGood } = require("../flows/flowWarnings");
const { listStarters, starterProposal } = require("../flows/starterFlows");
const {
  cleanProposal,
  proposalToFlow,
  dashChecked,
  itWill,
} = require("../flows/proposals");
const {
  buildInput,
  describeInput,
  suggestFields,
  stepKey,
  latestPassed,
  checkOutput,
} = require("../checks/stepInput");
const { runCheck } = require("../checks/checkRunner");
const { RULE_TYPES } = require("../checks/kinds/rules");
const { fetchStatus } = require("../checks/linkStatus");
const {
  proveCriteria,
  canStart,
  vagueness,
  PROOF_LABELS,
} = require("../goals/criteria");
const goalController = require("./goalController");
const { FLOWS_CHANGED } = require("../events/flowEvents");
const { prepareWorkFolder, pruneWorktrees } = require("../flows/workFolder");
const { createFlowShare } = require("../flows/flowShare");

const DIR = "flows";

// How the lead writes a proposed flow (proposals.js reads it).
const PROPOSAL_NOTE = [
  'The flow\'s JSON: {"name", "brief" (a few words: when it runs, where from), "maxRounds": 3,',
  ' "steps": [ {"key" (short id), "kind": "source"|"bot"|"check"|"you", "name", "note" (what this step does or may do),',
  '   "botId" (an existing bot) or "bot": {"name", "instructions", "schedules": [{"cron"}], "readOnly", "acts" (true when it sends or changes things)},',
  '   "outputs": [{"name", "kind": "text"|"number"|"list"|"links"|"paths"|"object", "required"}],',
  '   "judgment": true for a reviewer that judges,',
  '   "check" for a check: {"kind": "rules", "rules": [{"type": "required"|"words"|"maxLength"|"banned"|"linksWork"|"everyIncluded"|"equals"|"sumEquals"|"noDuplicates", "field": "input.text", …}]}',
  '   or {"kind": "command", "command"} or {"kind": "tool", "server", "tool", "args", "answerRules": [{"path", "op", "value"}]},',
  '   "action" for you: what you do ("Approve the send") } ],',
  ' "edges": [ {"from": key, "to": key, "kind": "next"|"fail", "label"} ] ("fail" sends work back for another round),',
  ' "needs": {"providers": [{"label", "anyOf": [provider types]}], "folder": true when it works on files} }',
].join("\n");

let store = null;
let runner = null;
let share = null;
let getWindows = () => [];
let offGoals = null;
let tick = null;
let bots = {
  runBot: async () => ({ skipped: true, reason: "Bots aren't ready yet" }),
  isBusy: () => false,
  getBot: () => null,
  listBots: () => [],
  saveBot: () => null,
  deleteBot: () => {},
  resumeBot: () => {},
  providers: () => [],
  callTool: async () => ({ isError: true, text: "Tools aren't ready yet" }),
  isReadOnlyTool: () => false,
  readOnlyTools: async () => [],
  actsOutward: () => false,
  graphRows: () => [],
  proposeFlow: async () => ({ error: "Bots aren't ready yet" }),
  writeScript: async () => ({ error: "Bots aren't ready yet" }),
};

function broadcast(payload) {
  for (const win of getWindows() || []) {
    try {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(FLOWS_CHANGED, payload);
      }
    } catch (_e) {
      // A closing window.
    }
  }
}

function ensure() {
  if (store) return store;
  let dir = null;
  try {
    dir = require("electron").app.getPath("userData");
  } catch (_e) {
    dir = null;
  }
  if (!dir) return null;
  open(path.join(dir, DIR));
  return store;
}

function open(root) {
  store = createFlowStore({ root, onChange: broadcast });
  return store;
}

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

/** Where a goal's own copy of its flow's files is. */
function goalFlowFiles(goalId) {
  const g = goals();
  const p = g && g.paths(goalId);
  return p ? path.join(p.dir, "flow-files") : null;
}

/** Copy a new flow goal's files (scripts/, checks/, data/) once. */
function copyFlowFiles(goalId) {
  try {
    const g = goals();
    const goal = g && g.getGoal(goalId);
    const s = ensure();
    if (!goal || !goal.flow || !goal.flow.id || !s) return;
    const dest = goalFlowFiles(goalId);
    if (!dest || fs.existsSync(dest)) return;
    const src = s.folderOf(goal.flow.id);
    fs.mkdirSync(dest, { recursive: true });
    if (!src) return;
    for (const folder of ["scripts", "checks", "data"]) {
      const from = path.join(src, folder);
      if (fs.existsSync(from))
        fs.cpSync(from, path.join(dest, folder), { recursive: true });
    }
  } catch (_e) {
    // Without a copy, checks read the flow's own files.
  }
}

/** What a check needs to run for a goal: its folder, scripts and tools. */
function checkContext(goal, _step) {
  const flowId = goal && goal.flow ? goal.flow.id : null;
  const s = ensure();
  const g = goals();
  // The goal's own copy of the flow's files, when it has one.
  const copy = goal && goal.id ? goalFlowFiles(goal.id) : null;
  const folder =
    (copy && fs.existsSync(copy) ? copy : null) ||
    (s && flowId && s.folderOf(flowId)) ||
    (g && g.paths(goal.id).work);
  return {
    // Commands run in the flow's folder; the goal's files reach them
    // through the input, never through a path written into the command.
    cwd: folder,
    tmpDir: os.tmpdir(),
    fetchStatus,
    callTool: (server, tool, args) =>
      bots.callTool(server, tool, args, goal ? goal.workspaceId : null),
    isReadOnly: (server, tool) => bots.isReadOnlyTool(server, tool),
    readScript: (ref) => readScriptRef(flowId, ref, copy),
  };
}

/** A check's script: in the flow's folder ("checks/x.js") or on this computer. */
function readScriptRef(flowId, ref, copy = null) {
  const r = String(ref || "");
  if (
    copy &&
    /^(scripts|checks|data)\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(r)
  ) {
    try {
      return fs.readFileSync(path.join(copy, r), "utf8");
    } catch (_e) {
      // Not copied: the flow's own.
    }
  }
  if (r.startsWith("local:")) {
    try {
      return fs.readFileSync(r.slice(6), "utf8");
    } catch (_e) {
      return null;
    }
  }
  const s = ensure();
  return s && flowId ? s.readFile(flowId, r) : null;
}

function startRunner() {
  if (runner) return runner;
  runner = createFlowRunner({
    store: goals(),
    runBot: (botId, opts) => bots.runBot(botId, opts),
    isBusy: (botId) => bots.isBusy(botId),
    runCheck: (check, input, ctx) => runCheck(check, input, ctx),
    filesOf,
    checkContext,
    // A task's own copy of its bot's folder (phase 5).
    prepareWork: (goal, _task, step) => {
      const bot = step.botId ? bots.getBot(step.botId) : null;
      const folder =
        bot && Array.isArray(bot.projects) ? bot.projects[0] : null;
      if (!folder) return null;
      const p = goals().paths(goal.id);
      return prepareWorkFolder({ folder, goalId: goal.id, workRoot: p.work });
    },
    // What a task has used across its runs: minutes and steps (phase 5).
    taskUsage: (goalId, taskId, since = 0) => {
      const g = goalController.get(goalId);
      let minutes = 0;
      let steps = 0;
      for (const r of (g && g.runs) || []) {
        if (r.taskId !== taskId || (r.startedAt || 0) < since) continue;
        if (r.startedAt && r.endedAt)
          minutes += (r.endedAt - r.startedAt) / 60000;
        steps += r.steps || 0;
      }
      return { minutes, steps };
    },
  });
  if (offGoals) offGoals();
  offGoals = goalController.onChange((change) => {
    // A new goal in a flow keeps its own copy of the flow's files, so a
    // script changed or a flow deleted later doesn't change it halfway.
    if (change && change.type === "goal" && change.goalId)
      copyFlowFiles(change.goalId);
    // A deleted goal's work folder is gone: git forgets its worktree.
    if (change && change.type === "deleted" && change.workspaceId != null) {
      const folders = (bots.listBots(change.workspaceId) || []).flatMap((b) =>
        Array.isArray(b.projects) ? b.projects : [],
      );
      if (folders.length) setImmediate(() => pruneWorktrees(folders));
    }
    runner.schedule();
  });
  if (tick) clearInterval(tick);
  // Slow tick: a paused bot resumed, a busy bot freed up.
  tick = setInterval(() => runner.schedule(), 20 * 1000);
  if (tick.unref) tick.unref();
  runner.start();
  return runner;
}

/** How many of a flow's goals are at each step, and what each waits on. */
function whereGoalsAre(flow) {
  const g = goals();
  const counts = {};
  let total = 0;
  let running = 0;
  if (!g) return { counts, total, running };
  for (const goal of g.listGoals({ workspaceId: flow.workspaceId })) {
    if (goal.flowId !== flow.id || goal.closed) continue;
    total += 1;
    if (goal.status === "working") running += 1;
    for (const t of goal.tasks || []) {
      if (!t.stepId || t.status === "done" || t.status === "closed") continue;
      const c = counts[t.stepId] || {
        goals: 0,
        rounds: [],
        ready: 0,
        stopped: 0,
        waiting: [],
      };
      c.goals += 1;
      if (t.status === "ready") c.ready += 1;
      if (t.status === "needs-you") c.stopped += 1;
      c.rounds.push(t.round || 1);
      const w = runner && runner.waitingFor(t.id);
      if (w) c.waiting.push(w.why);
      counts[t.stepId] = c;
    }
  }
  return { counts, total, running };
}

function warningsOf(flow) {
  const deps = {
    botExists: (id) => !!bots.getBot(id),
    actsOutward: (id) => bots.actsOutward(id),
  };
  return { warnings: flowWarnings(flow, deps), good: flowGood(flow, deps) };
}

/** A flow as the Graph tab shows it. */
function view(flow) {
  const where = whereGoalsAre(flow);
  const { warnings, good } = warningsOf(flow);
  const names = {};
  for (const s of flow.steps) {
    if (s.botId) {
      const b = bots.getBot(s.botId);
      names[s.botId] = b ? b.name : null;
    }
  }
  return {
    ...flow,
    order: chain(flow).map((s) => s.id),
    line: briefLine(flow),
    where,
    warnings,
    good,
    botNames: names,
  };
}

/** The most recent goal in this flow with a record from `stepId`'s input step. */
function lastRealInput(flow, stepId) {
  const g = goals();
  if (!g) return null;
  const src = inputStep(flow, stepId);
  const list = g
    .listGoals({ workspaceId: flow.workspaceId })
    .filter((x) => x.flowId === flow.id);
  for (const goal of list) {
    for (const task of goal.tasks || []) {
      if (src && !latestPassed(task, src.id)) continue;
      const rec = src ? latestPassed(task, src.id) : null;
      return {
        goal,
        task,
        input: buildInput({
          goal: { ...goal, flow },
          task,
          flow,
          stepId,
          files: filesOf(goal.id),
        }),
        record: rec,
        from: src ? src.name : null,
      };
    }
  }
  return null;
}

/** A sample input made from the fields the steps before declare. */
function sampleInput(flow, stepId) {
  const sample = (kind, name) =>
    kind === "number"
      ? 0
      : kind === "boolean"
        ? false
        : kind === "links"
          ? ["https://example.com"]
          : kind === "paths"
            ? ["draft.md"]
            : kind === "list"
              ? []
              : kind === "object"
                ? {}
                : `(${name})`;
  const src = inputStep(flow, stepId);
  const input = {};
  for (const f of (src && src.outputs) || [])
    input[f.name] = sample(f.kind, f.name);
  const from = {};
  for (const s of chain(flow)) {
    if (s.id === stepId) break;
    if (!s.outputs || !s.outputs.length) continue;
    const o = {};
    for (const f of s.outputs) o[f.name] = sample(f.kind, f.name);
    from[stepKey(s)] = o;
  }
  return {
    goal: {
      id: null,
      title: "(the goal's title)",
      body: "",
      criteria: [],
      round: 1,
      maxRounds: flow.maxRounds,
    },
    input,
    from,
    files: [],
  };
}

/** Which later steps read each of a step's fields (frames 26–27). */
function fieldUsage(flow, stepId) {
  const step = stepById(flow, stepId);
  if (!step) return {};
  const key = stepKey(step);
  const usage = {};
  for (const f of step.outputs || []) usage[f.name] = [];
  const after = [];
  let seen = false;
  for (const s of chain(flow)) {
    if (seen) after.push(s);
    if (s.id === stepId) seen = true;
  }
  for (const s of after) {
    const reads = inputStep(flow, s.id);
    const text = JSON.stringify({ check: s.check || null, note: s.note || "" });
    for (const name of Object.keys(usage)) {
      const direct =
        reads &&
        reads.id === stepId &&
        new RegExp(`input\\.${name}\\b`).test(text);
      const byName = new RegExp(`from\\.${key}\\.${name}\\b`).test(text);
      // A bot step after it reads the whole record.
      const botReads = s.kind === "bot" && reads && reads.id === stepId;
      if (direct || byName || botReads)
        usage[name].push({ stepId: s.id, name: s.name });
    }
  }
  return usage;
}

const ok = (x) => ({ ok: true, ...x });

const flowController = {
  /**
   * @param {{ getWindows?: () => BrowserWindow[], dataDir?: string }} deps
   */
  init(deps = {}) {
    if (typeof deps.getWindows === "function") getWindows = deps.getWindows;
    if (deps.dataDir) open(path.join(deps.dataDir, DIR));
    ensure();
  },

  store() {
    return ensure();
  },

  /** How to run and manage bots (botController), then start moving work. */
  useBots(hooks = {}) {
    bots = { ...bots, ...hooks };
    if (goals() && ensure()) startRunner();
  },

  /** For the bot goal tools: which flow a create_goal means; its criteria. */
  toolContext() {
    return {
      resolve: (q) => {
        const s = ensure();
        return s ? s.resolve(q) : null;
      },
      proveCriteria: (list, flow) => proveCriteria(list, flow),
    };
  },

  list(workspaceId) {
    const s = ensure();
    if (!s || workspaceId == null || workspaceId === "") return [];
    return s.list({ workspaceId }).map(view);
  },

  get(flowId) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return null;
    return { ...view(flow), files: s.listFiles(flowId) };
  },

  /** Save a whole flow (the Graph tab's edits). */
  save(flowId, next) {
    const s = ensure();
    if (!s) return { error: "Flows aren't available." };
    const cur = s.get(flowId);
    if (!cur) return { error: "No such flow." };
    // A flow from the registry, changed here: updates ask what to keep.
    const edited = cur.package ? true : cur.edited;
    const r = s.update(flowId, { ...next, edited });
    if (r.error) return r;
    if (runner) runner.schedule();
    return ok({ flow: view(r.flow) });
  },

  /** Add a step on an arrow (the +): a check, a bot, or you approving. */
  addStep(flowId, { from = null, to = null, step = {} } = {}) {
    const s = ensure();
    const cur = s && s.get(flowId);
    if (!cur) return { error: "No such flow." };
    const r = insertBetween(cur, from, to, step);
    if (r.error) return r;
    const saved = flowController.save(flowId, r.flow);
    return saved.error ? saved : { ...saved, stepId: r.stepId };
  },

  removeStep(flowId, stepId) {
    const s = ensure();
    const cur = s && s.get(flowId);
    if (!cur) return { error: "No such flow." };
    return flowController.save(flowId, removeStep(cur, stepId));
  },

  /** Change one step (its bot, check, fields, note…). */
  updateStep(flowId, stepId, patch = {}) {
    const s = ensure();
    const cur = s && s.get(flowId);
    if (!cur) return { error: "No such flow." };
    if (!stepById(cur, stepId)) return { error: "No such step." };
    const steps = cur.steps.map((st) =>
      st.id === stepId ? { ...st, ...patch, id: stepId, kind: st.kind } : st,
    );
    let edges = cur.edges;
    if (patch.failTo !== undefined) {
      edges = edges.filter((e) => !(e.kind === "fail" && e.from === stepId));
      if (patch.failTo)
        edges.push({ from: stepId, to: patch.failTo, kind: "fail", label: "" });
    }
    return flowController.save(flowId, { ...cur, steps, edges });
  },

  /** A blank flow on a dashboard. */
  create(workspaceId, { name = "New flow" } = {}) {
    return flowController.make(workspaceId, starterProposal("blank"), { name });
  },

  /**
   * Delete a flow. Its bots stay unless `removeBots`; then only the bots it
   * made, and only when no goal still works through it.
   */
  remove(flowId, { removeBots = false } = {}) {
    const s = ensure();
    const cur = s && s.get(flowId);
    if (!cur) return { error: "No such flow." };
    const active = whereGoalsAre(cur);
    if (removeBots && active.total > 0) {
      return {
        error: `${active.total} goal${active.total === 1 ? " still follows" : "s still follow"} this flow: finish or delete ${active.total === 1 ? "it" : "them"} before removing its bots.`,
      };
    }
    const r = s.remove(flowId);
    if (r.error) return r;
    const removed = [];
    if (removeBots) {
      for (const id of cur.madeBots || []) {
        try {
          bots.deleteBot(id);
          removed.push(id);
        } catch (_e) {
          // A bot already gone.
        }
      }
    }
    return ok({ removedBots: removed });
  },

  starters() {
    return listStarters();
  },

  /** A proposal as the user sees it before anything is made (frame 23). */
  preview(workspaceId, proposalOrStarter) {
    const proposal =
      typeof proposalOrStarter === "string"
        ? starterProposal(proposalOrStarter)
        : cleanProposal(proposalOrStarter);
    if (!proposal) return { error: "That flow couldn't be read." };
    return ok({
      proposal,
      checked: dashChecked(proposal, {
        actsOutward: (id) => bots.actsOutward(id),
      }),
      itWill: itWill(proposal, { providers: bots.providers() }),
    });
  },

  /**
   * "Make this flow": make its new bots on the dashboard, then the flow.
   * The bots start on Ask (their own approval setting) and aren't paused:
   * you approved the flow.
   */
  make(workspaceId, proposalOrStarter, { name = null, folder = null } = {}) {
    const s = ensure();
    if (!s) return { error: "Flows aren't available." };
    if (workspaceId == null || workspaceId === "")
      return { error: "A flow belongs to a dashboard." };
    const proposal =
      typeof proposalOrStarter === "string"
        ? starterProposal(proposalOrStarter)
        : cleanProposal(proposalOrStarter);
    if (!proposal) return { error: "That flow couldn't be read." };
    if (name) proposal.name = String(name).slice(0, 80);
    const made = {};
    const madeBots = [];
    try {
      for (const st of proposal.steps) {
        if (!st.bot || st.botId) continue;
        const saved = bots.saveBot({
          name: st.bot.name,
          instructions: st.bot.instructions || st.note || st.name,
          workspaceId: String(workspaceId),
          schedules: st.bot.schedules || [],
          approvalPolicy: "ask",
          // Every AI step of a flow that works on files gets the folder: the
          // Builder its own copy to change, the Reviewer the same copy to read.
          ...(folder &&
          proposal.needs &&
          proposal.needs.folder &&
          st.kind === "bot"
            ? { projects: [String(folder)] }
            : {}),
          ...(st.bot.commands ? { commands: st.bot.commands } : {}),
        });
        if (saved && saved.id) {
          made[st.key] = saved.id;
          madeBots.push(saved.id);
          bots.resumeBot(saved.id);
        }
      }
    } catch (e) {
      for (const id of madeBots) {
        try {
          bots.deleteBot(id);
        } catch (_e) {
          // Best effort: undo what was made.
        }
      }
      return { error: (e && e.message) || String(e) };
    }
    const flow = proposalToFlow(proposal, made, workspaceId);
    const r = s.create({ ...flow, madeBots });
    if (r.error) {
      for (const id of madeBots) {
        try {
          bots.deleteBot(id);
        } catch (_e) {
          // Best effort.
        }
      }
      return r;
    }
    return ok({ flow: view(r.flow), madeBots });
  },

  /** Undo "Make this flow": the flow and the bots it made (frame 24). */
  undo(flowId) {
    return flowController.remove(flowId, { removeBots: true });
  },

  /**
   * "Ask the Dash Lead" (frame 22): the dashboard's lead proposes the flow;
   * it's shown as it would be made, and nothing is made until "Make this
   * flow".
   */
  /**
   * "Write it with AI" (frame 19): the dashboard's lead writes a script
   * check's function once, from what it should check and the fields it
   * gets. It comes back to read before it's saved; it runs without AI.
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

  async propose(workspaceId, text) {
    if (!String(text || "").trim())
      return { error: "Say what the flow should do." };
    let r;
    try {
      r = await bots.proposeFlow(workspaceId, text, PROPOSAL_NOTE);
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
    if (!r || r.error)
      return {
        error: (r && r.error) || "No proposal came back.",
        said: r && r.text,
      };
    const prev = flowController.preview(workspaceId, r.proposal);
    return prev.error ? prev : { ...prev, said: r.text || "" };
  },

  /** "What it gets" for a step: real when there's a last record, else a sample. */
  whatItGets(flowId, stepId) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return { error: "No such flow." };
    const real = lastRealInput(flow, stepId);
    const input = real ? real.input : sampleInput(flow, stepId);
    return ok({
      real: !!real,
      from: real ? real.from : null,
      goalTitle: real ? real.goal.title : null,
      at: real && real.record ? real.record.at : null,
      input,
      rows: describeInput(input),
    });
  },

  /**
   * Try a check before it's saved (frames 13, 18–20): on the last real
   * record, or say there isn't one yet.
   */
  async trial(flowId, stepId, check) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return { error: "No such flow." };
    const real = lastRealInput(flow, stepId);
    if (!real) {
      return ok({
        tried: false,
        reason:
          "No goal has reached this step yet, so there's nothing real to try it on.",
      });
    }
    const ctx = checkContext({ ...real.goal, flow }, stepById(flow, stepId));
    const res = await runCheck(check, real.input, ctx);
    return ok({
      tried: true,
      on: real.goal.title,
      from: real.from,
      result: res,
    });
  },

  /** Fields suggested from a step's last 3 records (frame 26). */
  suggestFields(flowId, stepId) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return { error: "No such flow." };
    const g = goals();
    const outputs = [];
    let last = null;
    for (const goal of g
      ? g.listGoals({ workspaceId: flow.workspaceId })
      : []) {
      if (goal.flowId !== flowId) continue;
      for (const t of goal.tasks || []) {
        for (const r of [...(t.history || [])].reverse()) {
          if (r.stepId === stepId && r.status === "passed" && r.output) {
            outputs.push(r.output);
            if (!last || r.at > last.at) last = { output: r.output, at: r.at };
            break;
          }
        }
      }
      if (outputs.length >= 3) break;
    }
    // The last run's record against the step's fields ("Last run matches").
    const step = stepById(flow, stepId);
    const fit =
      last && step && step.outputs && step.outputs.length
        ? checkOutput(step.outputs, last.output)
        : null;
    return ok({
      fields: suggestFields(outputs),
      from: outputs.length,
      last: last ? { ...last, fit } : null,
    });
  },

  /** Which later steps read each of a step's fields. */
  fieldUsage(flowId, stepId) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return { error: "No such flow." };
    return ok({ usage: fieldUsage(flow, stepId) });
  },

  /** Read-only tools a tool call check may use, per connected provider. */
  async readOnlyTools(workspaceId) {
    try {
      return ok({ servers: await bots.readOnlyTools(workspaceId) });
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  /** The rules a rules check can tick, with their labels. */
  ruleTypes() {
    return Object.entries(RULE_TYPES).map(([type, r]) => ({
      type,
      label: r.label,
    }));
  },

  /** A dashboard with no flows yet: what its bots read and show (frame 21). */
  simpleGraph(workspaceId) {
    try {
      return ok({ rows: bots.graphRows(workspaceId) || [] });
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  // ---- goals in a flow (phase 6) -----------------------------------------

  /** Is a criterion too vague to check? With a rewrite. */
  criterionHelp(text) {
    return vagueness(text);
  },

  proofLabels() {
    return PROOF_LABELS;
  },

  /**
   * New goal (frame 29): in a flow, with what done means. It can't start
   * while a criterion has no way to be proven.
   */
  newGoal(
    workspaceId,
    { flowId, title, body = "", criteria = [], conversationId = null } = {},
  ) {
    const s = ensure();
    const flow = s && s.get(flowId);
    if (!flow) return { error: "Choose the flow this goal follows." };
    const proven = proveCriteria(criteria, flow);
    const start = canStart(proven.criteria);
    if (!start.ok) return { error: start.reason, blocking: start.blocking };
    const g = goals();
    const r = g.createGoal({
      workspaceId,
      title,
      body,
      source: { kind: "you", ref: "", label: "" },
      conversationId,
      createdBy: { botId: null, botName: "You" },
      flow,
      criteria: proven.criteria,
    });
    return r.error ? r : ok({ goal: r.goal });
  },

  /** Start a goal that waits for you (frame 30), with its criteria as fixed. */
  startGoal(goalId, criteria) {
    const g = goals();
    const goal = g && g.getGoal(goalId);
    if (!goal) return { error: "No such goal." };
    const list = Array.isArray(criteria) ? criteria : goal.criteria || [];
    const proven = proveCriteria(list, goal.flow);
    const start = canStart(proven.criteria);
    if (!start.ok) return { error: start.reason, blocking: start.blocking };
    const r = g.startGoal(goalId, { criteria: proven.criteria });
    return r.error ? r : ok({ goal: r.goal });
  },

  /** Change a waiting goal's criteria (rewrite, leave out, I'll decide). */
  setCriteria(goalId, criteria) {
    const g = goals();
    const goal = g && g.getGoal(goalId);
    if (!goal) return { error: "No such goal." };
    const proven = proveCriteria(criteria, goal.flow);
    const r = g.setCriteria(goalId, proven.criteria);
    return r.error ? r : ok({ goal: r.goal });
  },

  // ---- publish, install, update (phase 7) --------------------------------

  /** The share steps, with the registry's real sign-in, publish, download. */
  share() {
    if (share) return share;
    share = createFlowShare({
      store: ensure(),
      goals,
      bots: {
        listBots: (ws) => bots.listBots(ws),
        getBot: (id) => bots.getBot(id),
        saveBot: (def) => bots.saveBot(def),
        deleteBot: (id) => bots.deleteBot(id),
        resumeBot: (id) => bots.resumeBot(id),
        providers: () => bots.providers(),
      },
      identity: () => require("./botPublish").registryIdentity(),
      publishZip: (files, manifest) =>
        require("./botPublish").zipAndPublish(files, manifest),
      download: (ref, opts) =>
        require("./botRegistryInstall").downloadBotPackage(ref, opts),
      latest: async (ref) => {
        const { resolveForInstall } = require("../registry/registryPackages");
        const r = await resolveForInstall(ref, { version: null });
        return r && r.pkg
          ? { version: r.pkg.version }
          : { error: (r && r.error) || "Not found" };
      },
    });
    return share;
  },

  publishPreview(flowId) {
    return flowController.share().publishPreview(flowId);
  },
  publish(flowId, opts = {}) {
    return flowController.share().publish(flowId, opts);
  },
  installPreview(packageRef) {
    return flowController.share().installPreview(packageRef);
  },
  install(previewId, choices = {}) {
    return flowController.share().install(previewId, choices);
  },
  checkUpdate(flowId) {
    return flowController.share().checkUpdate(flowId);
  },
  updatePreview(flowId) {
    return flowController.share().updatePreview(flowId);
  },
  update(previewId, choices = {}) {
    return flowController.share().update(previewId, choices);
  },
  skipVersion(flowId, version) {
    return flowController.share().skipVersion(flowId, version);
  },

  /** Flow packages on the registry, for "Install a flow". */
  async searchFlows(query = "") {
    try {
      const { fetchRegistryIndex } = require("./registryController");
      const index = await fetchRegistryIndex(false);
      const list = (index && (index.packages || index)) || [];
      const q = String(query || "")
        .trim()
        .toLowerCase();
      return {
        ok: true,
        packages: (Array.isArray(list) ? list : [])
          .filter((p) => p && p.type === "flow")
          .filter(
            (p) =>
              !q ||
              [p.name, p.displayName, p.description, p.scope, p.author]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q),
          )
          .slice(0, 50)
          .map((p) => ({
            ref: `${p.scope ? `@${p.scope}/` : ""}${p.name}`,
            name: p.displayName || p.name,
            version: p.latestVersion || p.version,
            description: p.description || "",
            author: p.author || p.scope || "",
            steps: (p.flow && p.flow.steps) || [],
          })),
      };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  },

  // ---- the flow's files (phase 6) ----------------------------------------

  listFiles(flowId) {
    const s = ensure();
    return s ? s.listFiles(flowId) : [];
  },
  readFile(flowId, ref) {
    const s = ensure();
    return s ? s.readFile(flowId, ref) : null;
  },
  writeFile(flowId, ref, content) {
    const s = ensure();
    return s
      ? s.writeFile(flowId, ref, content)
      : { error: "Flows aren't available." };
  },
  copyIn(flowId, fromPath, folder) {
    const s = ensure();
    return s
      ? s.copyIn(flowId, fromPath, folder)
      : { error: "Flows aren't available." };
  },
  removeFile(flowId, ref) {
    const s = ensure();
    return s ? s.removeFile(flowId, ref) : { error: "Flows aren't available." };
  },

  /** A dashboard was deleted: its flows go with it (its goals already have). */
  forgetWorkspace(workspaceId) {
    const s = ensure();
    return s ? s.removeForWorkspace(workspaceId) : [];
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

  /** Normalize a flow without saving it (the Graph tab's local edits). */
  normalize(flow) {
    return normalizeFlow(flow);
  },
};

module.exports = flowController;
