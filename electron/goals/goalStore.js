/**
 * goalStore.js
 *
 * The goals ledger (goals-ledger PRD): what a dashboard's bots are working
 * on, one folder per goal —
 *
 *   <root>/<goalId>/goal.json          title, dashboard, where it came from
 *   <root>/<goalId>/tasks/<taskId>.json status, round, holder, done records
 *   <root>/<goalId>/evidence/          files a step kept as proof
 *   <root>/<goalId>/work/              files the bots share while working
 *
 * Records are sealed at rest like bot runs (secretBox; plain without a
 * keychain) and written to a temp file, then renamed into place. Everything
 * runs in the one main process, so a claim — read, check, write — can't
 * interleave with another: two bots never hold the same task.
 *
 * A goal's runs aren't kept here: run records carry its goalId (BotRunner),
 * so the goal finds them by id and deleting it removes them too.
 *
 * A goal that follows a flow (flows PRD) keeps its own copy of the flow as
 * it was when the goal started, so a flow changed or updated later never
 * changes the rules halfway. Its one task travels the flow's steps
 * (flowMoves.js); each done record names its step and carries the step's
 * output, checked against the fields the step must fill.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  CLAIMABLE,
  FINISHED,
  clampRounds,
  afterDone,
  afterUser,
  goalStatus,
} = require("./taskStatus");
const { stepById } = require("../flows/flowModel");
const { startOf, afterStep, afterUserInFlow } = require("../flows/flowMoves");
const { checkOutput, outputProblem } = require("../checks/stepInput");

const MAX_OUTPUT_JSON = 64 * 1024;

/** A step's output as kept on its record: plain JSON, size-capped. */
function cleanOutput(output) {
  if (output === undefined) return undefined;
  try {
    const json = JSON.stringify(output);
    if (json === undefined) return undefined;
    if (json.length > MAX_OUTPUT_JSON) {
      return { error: "This output was too big to keep (64 KB at most)." };
    }
    return JSON.parse(json);
  } catch (_e) {
    return undefined;
  }
}

/** The copy of a flow a goal keeps: what it needs to run, nothing else. */
function flowSnapshot(flow) {
  if (!flow || !Array.isArray(flow.steps)) return null;
  return JSON.parse(
    JSON.stringify({
      id: flow.id || null,
      name: flow.name || "",
      version: flow.version || 1,
      package: flow.package || null,
      maxRounds: flow.maxRounds || 3,
      taskLimits: flow.taskLimits || null,
      steps: flow.steps,
      edges: flow.edges || [],
    }),
  );
}

const GOAL_ID = /^goal_[a-z0-9]{6,40}$/;
const TASK_ID = /^task_[a-z0-9]{6,40}$/;
const MAX_HISTORY = 50;
const MAX_EVIDENCE = 20;
const MAX_TEXT = 4000;
const MAX_TITLE = 200;

const text = (v, max = MAX_TEXT) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const sameWs = (a, b) =>
  a != null && a !== "" && b != null && b !== "" && String(a) === String(b);

/** Evidence as `{label, value}` pairs: what a step points to as proof. */
function cleanEvidence(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, MAX_EVIDENCE)) {
    if (typeof item === "string") {
      const value = text(item, 2000);
      if (value) out.push({ label: "", value });
    } else if (item && typeof item === "object") {
      const value =
        typeof item.value === "string"
          ? text(item.value, 2000)
          : item.value == null
            ? ""
            : text(JSON.stringify(item.value), 2000);
      const label = text(item.label, 80);
      if (value || label) out.push({ label, value });
    }
  }
  return out;
}

/**
 * @param {{ root: string,
 *           box?: { seal: (s: string) => string, open: (s: string) => string|null } | null,
 *           now?: () => number,
 *           random?: () => number,
 *           onChange?: (change: object) => void }} deps
 */
function createGoalStore({
  root,
  box = null,
  now = Date.now,
  random = Math.random,
  onChange = () => {},
}) {
  const goals = new Map();
  const tasks = new Map();
  // Goals sealed by a keychain this session can't open: never shown, never
  // overwritten with less. Deleting one still removes its folder.
  const unreadable = new Set();

  const newId = (prefix) =>
    `${prefix}_${now().toString(36)}${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;

  const goalDir = (goalId) => path.join(root, goalId);

  function readRecord(file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw.sealed === "string") {
      const opened = box ? box.open(raw.sealed) : raw.sealed;
      if (opened == null) throw new Error("sealed by another keychain");
      return JSON.parse(opened);
    }
    return raw;
  }

  function writeRecord(file, record) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const json = JSON.stringify(record);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ v: 1, sealed: box ? box.seal(json) : json }),
    );
    fs.renameSync(tmp, file);
  }

  const saveGoal = (goal) =>
    writeRecord(path.join(goalDir(goal.id), "goal.json"), goal);
  const saveTask = (task) =>
    writeRecord(
      path.join(goalDir(task.goalId), "tasks", `${task.id}.json`),
      task,
    );

  function load() {
    goals.clear();
    tasks.clear();
    unreadable.clear();
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch (_e) {
      return; // No ledger yet.
    }
    for (const name of names) {
      if (!GOAL_ID.test(name)) continue;
      let goal;
      try {
        goal = readRecord(path.join(goalDir(name), "goal.json"));
      } catch (e) {
        // No goal.json at all: what's left of a deleted goal (a run still
        // writing work files re-made the folder). Anything else unreadable
        // is kept, never overwritten.
        if (e && e.code === "ENOENT") {
          try {
            fs.rmSync(goalDir(name), { recursive: true, force: true });
          } catch (_e) {
            // Tried again on the next load.
          }
        } else {
          unreadable.add(name);
        }
        continue;
      }
      if (!goal || goal.id !== name) continue;
      goals.set(goal.id, goal);
      let files = [];
      try {
        files = fs.readdirSync(path.join(goalDir(name), "tasks"));
      } catch (_e) {
        files = [];
      }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const task = readRecord(path.join(goalDir(name), "tasks", f));
          if (task && TASK_ID.test(task.id) && task.goalId === name) {
            // No run survives a restart (a crash, a force-quit): what a bot
            // held is let go, so it isn't stuck "being worked on" for good.
            if (task.holder) {
              task.holder = null;
              if (task.status === "claimed") task.status = "new";
              saveTask(task);
            }
            tasks.set(task.id, task);
          }
        } catch (_e) {
          // One unreadable task doesn't hide the goal.
        }
      }
    }
  }

  const tasksOf = (goalId) =>
    [...tasks.values()]
      .filter((t) => t.goalId === goalId)
      .sort((a, b) => a.createdAt - b.createdAt);

  /** A goal as the app shows it: its status and tasks, newest first in lists. */
  function view(goal) {
    const list = tasksOf(goal.id);
    return { ...goal, status: goalStatus(goal, list), tasks: list };
  }

  function changed(change) {
    // Every change names its dashboard, so a window showing another
    // dashboard's goals doesn't reload for it.
    if (change.workspaceId === undefined) {
      const goal = goals.get(change.goalId);
      change.workspaceId = goal ? goal.workspaceId : null;
    }
    try {
      onChange(change);
    } catch (_e) {
      // Listeners never break a write.
    }
  }

  function touch(goalId) {
    const goal = goals.get(goalId);
    if (!goal) return;
    goal.updatedAt = now();
    saveGoal(goal);
  }

  // ---- reads --------------------------------------------------------------

  function listGoals({ workspaceId } = {}) {
    return [...goals.values()]
      .filter((g) => workspaceId == null || sameWs(g.workspaceId, workspaceId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(view);
  }

  function getGoal(goalId) {
    const goal = goals.get(goalId);
    return goal ? view(goal) : null;
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  function listTasks({ workspaceId, goalId, status } = {}) {
    return [...tasks.values()]
      .filter((t) => {
        const goal = goals.get(t.goalId);
        if (!goal || goal.closed) return false;
        if (workspaceId != null && !sameWs(goal.workspaceId, workspaceId)) {
          return false;
        }
        if (goalId && t.goalId !== goalId) return false;
        if (status && t.status !== status) return false;
        return true;
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Goals a conversation started (deleting it offers to delete these). */
  function goalsForConversation(conversationId) {
    if (!conversationId) return [];
    return listGoals().filter(
      (g) => g.conversationId && g.conversationId === String(conversationId),
    );
  }

  function paths(goalId) {
    if (!GOAL_ID.test(goalId || "")) return null;
    const dir = goalDir(goalId);
    return {
      dir,
      evidence: path.join(dir, "evidence"),
      work: path.join(dir, "work"),
    };
  }

  // ---- writes -------------------------------------------------------------

  /**
   * @param {{ workspaceId: string|number, title: string, body?: string,
   *           source?: { kind: string, ref?: string, label?: string },
   *           conversationId?: string, createdBy?: { botId?: string, botName?: string } }} input
   */
  function createGoal(input = {}) {
    const title = text(input.title, MAX_TITLE);
    if (!title) return { error: "A goal needs a title." };
    if (input.workspaceId == null || input.workspaceId === "") {
      return { error: "A goal belongs to a dashboard." };
    }
    const flow = flowSnapshot(input.flow);
    let start = null;
    if (flow) {
      start = startOf(flow);
      if (start.error) return { error: start.error };
    }
    const at = now();
    const goal = {
      id: newId("goal"),
      workspaceId: String(input.workspaceId),
      title,
      body: text(input.body),
      source: {
        kind: text(input.source && input.source.kind, 40) || "bot",
        ref: text(input.source && input.source.ref, 400),
        label: text(input.source && input.source.label, 200),
      },
      conversationId: input.conversationId
        ? String(input.conversationId)
        : null,
      createdBy: input.createdBy || null,
      closed: false,
      createdAt: at,
      updatedAt: at,
    };
    if (flow) {
      goal.flowId = flow.id;
      goal.flow = flow;
    }
    if (Array.isArray(input.criteria) && input.criteria.length) {
      goal.criteria = input.criteria.slice(0, 20);
    }
    // A goal held before it starts (a criterion with no way to be proven
    // yet, phase 6): its work waits until the user starts it.
    if (input.waiting) goal.waiting = true;
    saveGoal(goal);
    fs.mkdirSync(path.join(goalDir(goal.id), "evidence"), { recursive: true });
    fs.mkdirSync(path.join(goalDir(goal.id), "work"), { recursive: true });
    goals.set(goal.id, goal);
    if (flow) {
      // The goal's work: one task that travels the flow's steps. What the
      // source step read (a ticket, today's events) is its first record.
      const source = (flow.steps || []).find((s) => s.kind === "source");
      const history = [];
      if (source && input.sourceOutput !== undefined) {
        history.push({
          botId: (input.createdBy && input.createdBy.botId) || null,
          botName: (input.createdBy && input.createdBy.botName) || null,
          status: "passed",
          from: "new",
          to: start.status,
          round: 1,
          stepId: source.id,
          summary: text(input.sourceSummary) || "Started the goal",
          evidence: [],
          output: cleanOutput(input.sourceOutput),
          said: "bot",
          at,
        });
      }
      const task = {
        id: newId("task"),
        goalId: goal.id,
        title,
        body: goal.body,
        status: start.status,
        stepId: start.stepId,
        round: 1,
        maxRounds: clampRounds(flow.maxRounds),
        holder: null,
        history,
        createdAt: at,
        updatedAt: at,
      };
      saveTask(task);
      tasks.set(task.id, task);
    }
    changed({ type: "goal", goalId: goal.id, workspaceId: goal.workspaceId });
    return { goal: view(goal) };
  }

  /** A goal already started from this source (a ticket already in a flow). */
  function findBySource({ workspaceId, flowId, ref }) {
    const r = text(ref, 400);
    if (!r) return null;
    const goal = [...goals.values()].find(
      (g) =>
        sameWs(g.workspaceId, workspaceId) &&
        (flowId ? g.flowId === flowId : true) &&
        g.source &&
        g.source.ref === r,
    );
    return goal ? view(goal) : null;
  }

  /** Start a goal that was held (phase 6): its work can be picked up now. */
  function startGoal(goalId, patch = {}) {
    const goal = goals.get(goalId);
    if (!goal) return { error: "No such goal." };
    if (goal.closed) return { error: "This goal is closed." };
    if (Array.isArray(patch.criteria))
      goal.criteria = patch.criteria.slice(0, 20);
    goal.waiting = false;
    touch(goalId);
    changed({ type: "goal", goalId, workspaceId: goal.workspaceId });
    return { goal: view(goal) };
  }

  /**
   * Change a goal's criteria: before it starts, or while it's stopped and
   * waiting for the user ("Change what done means", frame 4). Never while a
   * step is working on it.
   */
  function setCriteria(goalId, criteria) {
    const goal = goals.get(goalId);
    if (!goal) return { error: "No such goal." };
    const stopped = tasksOf(goalId).some((t) => t.status === "needs-you");
    if (!goal.waiting && goal.flow && !stopped) {
      return {
        error:
          "What done means is locked while the goal runs. It can change once it stops and waits for you.",
      };
    }
    goal.criteria = Array.isArray(criteria) ? criteria.slice(0, 20) : [];
    touch(goalId);
    changed({ type: "goal", goalId, workspaceId: goal.workspaceId });
    return { goal: view(goal) };
  }

  function addTask(goalId, input = {}) {
    const goal = goals.get(goalId);
    if (!goal) return { error: "No such goal." };
    if (goal.closed) return { error: "This goal is closed." };
    if (goal.flow) {
      return {
        error: `This goal follows the "${goal.flow.name}" flow: its work goes through the flow's steps, so it takes no other tasks.`,
      };
    }
    const title = text(input.title, MAX_TITLE);
    if (!title) return { error: "A task needs a title." };
    const at = now();
    const task = {
      id: newId("task"),
      goalId,
      title,
      body: text(input.body),
      status: "new",
      round: 1,
      maxRounds: clampRounds(input.maxRounds),
      holder: null,
      history: [],
      createdAt: at,
      updatedAt: at,
    };
    saveTask(task);
    tasks.set(task.id, task);
    touch(goalId);
    changed({ type: "task", goalId, taskId: task.id });
    return { task };
  }

  /**
   * A bot takes a task to work on. Only one bot holds a task at a time; a
   * bot that already holds it may claim it again.
   * @param {{ botId: string, botName?: string, workspaceId?: string|number }} who
   */
  function claimTask(taskId, who = {}) {
    const task = tasks.get(taskId);
    const goal = task && goals.get(task.goalId);
    if (!task || !goal) return { error: "No such task." };
    if (
      who.workspaceId !== undefined &&
      !sameWs(goal.workspaceId, who.workspaceId)
    ) {
      return { error: "That task is on another dashboard." };
    }
    if (goal.closed || FINISHED.includes(task.status)) {
      return { error: "This task is finished." };
    }
    if (task.holder && task.holder.botId !== who.botId) {
      return { error: "Another bot is working on this task." };
    }
    if (goal.flow) {
      // In a flow, only the bot at the task's step works on it.
      if (goal.waiting) {
        return {
          error: "This goal hasn't started yet: it waits for the user.",
        };
      }
      const step = stepById(goal.flow, task.stepId);
      if (!step || step.kind !== "bot" || !CLAIMABLE.includes(task.status)) {
        return {
          error: step
            ? `This task is at "${step.name}", which isn't a bot's step right now.`
            : "This task isn't at a step of its flow.",
        };
      }
      if (step.botId && step.botId !== who.botId) {
        return {
          error: `This task is at "${step.name}": another bot works on it there.`,
        };
      }
    }
    if (!task.holder && !CLAIMABLE.includes(task.status)) {
      return {
        error: `A task that is '${task.status}' can't be picked up.`,
      };
    }
    task.holder = {
      botId: who.botId || null,
      botName: text(who.botName, 120) || null,
      at: now(),
    };
    if (task.status === "new") task.status = "claimed";
    task.updatedAt = now();
    saveTask(task);
    touch(task.goalId);
    changed({ type: "task", goalId: task.goalId, taskId });
    return { task };
  }

  /**
   * A bot finishes its step on a task: a done record, and the task moves on.
   * @param {{ botId: string, botName?: string, workspaceId?: string|number,
   *           status: "passed"|"failed"|"needs-you",
   *           summary?: string, evidence?: Array }} done
   */
  function writeDone(taskId, done = {}) {
    const task = tasks.get(taskId);
    const goal = task && goals.get(task.goalId);
    if (!task || !goal) return { error: "No such task." };
    if (
      done.workspaceId !== undefined &&
      !sameWs(goal.workspaceId, done.workspaceId)
    ) {
      return { error: "That task is on another dashboard." };
    }
    if (!task.holder || task.holder.botId !== done.botId) {
      return { error: "Claim the task before writing its done record." };
    }
    const output = cleanOutput(done.output);
    let next;
    let step = null;
    if (goal.flow) {
      step = stepById(goal.flow, task.stepId);
      // A passed record must fill the fields the step declares (phase 3):
      // refused here, so the bot can fix it in the same run.
      if (
        done.status === "passed" &&
        step &&
        step.outputs &&
        step.outputs.length
      ) {
        const fit = checkOutput(step.outputs, output);
        if (!fit.ok)
          return { error: outputProblem(step.name, fit), mismatch: fit };
      }
      next = afterStep(goal.flow, task, done.status);
    } else {
      next = afterDone(task, done.status);
    }
    if (next.error) return { error: next.error };
    const record = {
      botId: done.botId || null,
      botName: text(done.botName, 120) || null,
      status: done.status,
      from: task.status,
      to: next.status,
      round: task.round || 1,
      summary: text(done.summary),
      evidence: cleanEvidence(done.evidence),
      ...(step ? { stepId: step.id } : {}),
      ...(output !== undefined ? { output } : {}),
      // Said by the bot: a check after it re-verifies the work.
      said: "bot",
      ...(next.stopped ? { stopped: true } : {}),
      at: now(),
    };
    applyMove(task, next, record);
    return { task, record };
  }

  /** Put a record on a task and move it where its outcome takes it. */
  function applyMove(task, next, record) {
    task.history = [...(task.history || []), record].slice(-MAX_HISTORY);
    task.status = next.status;
    if (next.stepId !== undefined) task.stepId = next.stepId;
    if (next.round) task.round = next.round;
    if (next.maxRounds) task.maxRounds = next.maxRounds;
    if (next.retryStepId !== undefined) task.retryStepId = next.retryStepId;
    task.holder = null;
    task.updatedAt = record.at;
    saveTask(task);
    touch(task.goalId);
    changed({ type: "task", goalId: task.goalId, taskId: task.id });
  }

  /**
   * Dash's own record for a step it ran (a check), or one it closed for a
   * bot that ended its run without a record: said by Dash, not a bot.
   * @param {{ stepId: string, status: "passed"|"failed"|"needs-you",
   *           summary?: string, details?: any, output?: any,
   *           evidence?: Array, kind?: string, ms?: number }} done
   */
  function writeStepRecord(taskId, done = {}) {
    const task = tasks.get(taskId);
    const goal = task && goals.get(task.goalId);
    if (!task || !goal || !goal.flow)
      return { error: "No such task in a flow." };
    if (goal.closed || FINISHED.includes(task.status)) {
      return { error: "This task is finished." };
    }
    if (done.stepId && done.stepId !== task.stepId) {
      return { error: "The task has moved on from that step." };
    }
    const step = stepById(goal.flow, task.stepId);
    const next = afterStep(goal.flow, task, done.status);
    if (next.error) return { error: next.error };
    const output = cleanOutput(done.output);
    const record = {
      botId: null,
      botName: null,
      by: "dash",
      status: done.status,
      from: task.status,
      to: next.status,
      round: task.round || 1,
      stepId: step ? step.id : null,
      summary: text(done.summary),
      evidence: cleanEvidence(done.evidence),
      ...(done.details !== undefined
        ? { details: cleanOutput(done.details) }
        : {}),
      ...(output !== undefined ? { output } : {}),
      ...(done.kind ? { kind: text(done.kind, 20) } : {}),
      ...(typeof done.ms === "number" ? { ms: done.ms } : {}),
      said: "dash",
      ...(next.stopped ? { stopped: true } : {}),
      at: now(),
    };
    applyMove(task, next, record);
    return { task, record };
  }

  /**
   * A bot's run ended: let go of what it held without a done record. A task
   * it had only just claimed goes back to `new` for the next bot.
   */
  function release(botId) {
    const freed = [];
    for (const task of tasks.values()) {
      if (!task.holder || task.holder.botId !== botId) continue;
      task.holder = null;
      if (task.status === "claimed") task.status = "new";
      task.updatedAt = now();
      saveTask(task);
      touch(task.goalId);
      freed.push(task.id);
      changed({ type: "task", goalId: task.goalId, taskId: task.id });
    }
    return freed;
  }

  /** The user's own moves: done, one more round, close. */
  function userAction(taskId, action) {
    const task = tasks.get(taskId);
    const goal = task && goals.get(task.goalId);
    if (!task || !goal) return { error: "No such task." };
    // Nothing picks up a closed goal's tasks, so none can be restarted.
    if (goal.closed) return { error: "This goal is closed." };
    const next = goal.flow
      ? afterUserInFlow(goal.flow, task, action)
      : afterUser(task, action);
    if (next.error) return { error: next.error };
    const record = {
      botId: null,
      by: "you",
      status: action,
      from: task.status,
      to: next.status,
      round: task.round || 1,
      ...(goal.flow ? { stepId: task.stepId } : {}),
      summary: "",
      evidence: [],
      at: now(),
    };
    applyMove(task, next, record);
    return { task };
  }

  function closeGoal(goalId) {
    const goal = goals.get(goalId);
    if (!goal) return { error: "No such goal." };
    goal.closed = true;
    for (const task of tasksOf(goalId)) {
      if (task.holder) task.holder = null;
      saveTask(task);
    }
    touch(goalId);
    changed({ type: "goal", goalId, workspaceId: goal.workspaceId });
    return { goal: view(goal) };
  }

  /** Is a bot holding one of this goal's tasks right now? */
  function isBusy(goalId) {
    return tasksOf(goalId).some((t) => !!t.holder);
  }

  /** Remove a goal's folder: its record, tasks, evidence and work files. */
  function deleteGoal(goalId) {
    if (!GOAL_ID.test(goalId || "")) return { error: "No such goal." };
    if (!goals.has(goalId) && !unreadable.has(goalId)) {
      return { error: "No such goal." };
    }
    if (goals.has(goalId) && isBusy(goalId)) {
      return { error: "A bot is still working on it — stop it first." };
    }
    const goal = goals.get(goalId);
    try {
      fs.rmSync(goalDir(goalId), { recursive: true, force: true });
    } catch (e) {
      // A locked file: the goal stays whole rather than half deleted.
      return {
        error: `It couldn't be deleted: ${(e && e.message) || e}`,
      };
    }
    for (const t of tasksOf(goalId)) tasks.delete(t.id);
    goals.delete(goalId);
    unreadable.delete(goalId);
    changed({
      type: "deleted",
      goalId,
      workspaceId: goal ? goal.workspaceId : null,
    });
    return { ok: true, goalId };
  }

  /** A dashboard was deleted: its goals go with it. */
  function deleteForWorkspace(workspaceId) {
    const removed = [];
    for (const goal of [...goals.values()]) {
      if (!sameWs(goal.workspaceId, workspaceId)) continue;
      for (const t of tasksOf(goal.id)) t.holder = null;
      const r = deleteGoal(goal.id);
      if (r.ok) removed.push(goal.id);
    }
    return removed;
  }

  load();

  return {
    load,
    listGoals,
    getGoal,
    getTask,
    listTasks,
    goalsForConversation,
    paths,
    createGoal,
    findBySource,
    startGoal,
    setCriteria,
    addTask,
    claimTask,
    writeDone,
    writeStepRecord,
    release,
    userAction,
    closeGoal,
    isBusy,
    deleteGoal,
    deleteForWorkspace,
  };
}

module.exports = { createGoalStore, GOAL_ID, TASK_ID, MAX_HISTORY };
