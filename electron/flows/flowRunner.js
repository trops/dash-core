/**
 * flowRunner.js
 *
 * Moves a bot's checks jobs on (bot-checks PRD): each job follows the small
 * flow made from its bot's checks (botChecks.checksFlow). Nothing has to be
 * running for work to go on: on every ledger change, and on a slow tick,
 * the runner looks at each job's task —
 *
 *   at a bot step    the bot answers again (its work came back), or a
 *                    reviewer judges it and writes its done record
 *   at a check step  Dash runs the check itself and writes the record
 *                    ("said by Dash"), passed or failed with its proof
 *   at a you step    nothing: it waits in Needs you
 *
 * A bot that ends its run without a done record is started once more; a
 * second time, the task waits for the user. A paused or busy bot is left
 * until it can run. Rounds come from the ledger (flowMoves.js), never from
 * bots asking each other, so the event chain's limits stay as they are.
 *
 * Injected: the goal store, how to run a bot and a check, and the files in
 * a goal's work folder. No Electron.
 */
"use strict";

const { stepById } = require("./flowModel");
const { buildInput, stepKey } = require("../checks/stepInput");
const { isChecksFlow, retryPrompt, WORK_STEP } = require("../bots/botChecks");

const MAX_INPUT_JSON = 20 * 1024;
const NO_RECORD_TRIES = 2;
const SKIP_WAIT_MS = 60 * 1000;

function clip(json) {
  return json.length > MAX_INPUT_JSON
    ? `${json.slice(0, MAX_INPUT_JSON)}\n… (cut: read the full records with read_task)`
    : json;
}

/** What a reviewer is told when the job hands it the work. */
function stepPrompt({ goal, task, step, input, workFolder }) {
  const flow = goal.flow;
  const lines = [
    `You're the "${step.name}" step of the "${flow.name}" flow on this dashboard.`,
    `Goal ${goal.id}: ${goal.title}. Task ${task.id}, round ${task.round || 1} of ${task.maxRounds || flow.maxRounds || 3}.`,
  ];
  if (step.note) lines.push("", `This step: ${step.note}`);
  if (goal.body) lines.push("", `About the goal: ${goal.body}`);
  if (Array.isArray(goal.criteria) && goal.criteria.length) {
    lines.push("", "What done means (locked):");
    for (const c of goal.criteria) lines.push(`- ${c.text}`);
  }
  if (input.fix) {
    lines.push(
      "",
      input.fix.byYou
        ? `The user sent it back at "${input.fix.step}": ${input.fix.reason}`
        : `It came back from "${input.fix.step}": ${input.fix.reason}`,
      ...(input.fix.details != null
        ? [`Details: ${clip(JSON.stringify(input.fix.details))}`]
        : []),
      "Fix that first.",
    );
  }
  lines.push(
    "",
    `Start with claim_task ${task.id}. When you're done, call write_done on it: "passed" with what you made, "failed" if it can't be done (say why), or "needs-you" if you need the user.`,
  );
  if (step.outputs && step.outputs.length) {
    lines.push(
      `Your record's output must fill: ${step.outputs
        .map((f) => `${f.name} (${f.kind}${f.required ? "" : ", optional"})`)
        .join(
          ", ",
        )}. A record missing one is refused — fill it and call write_done again.`,
    );
  }
  if (step.judgment) {
    lines.push(
      "You judge the work: match every criterion to its evidence. Pass only when each one has proof; otherwise fail with a fix list, one line per thing to fix. You only read: change nothing.",
    );
  }
  lines.push(
    "",
    "What the steps before you made (as JSON):",
    clip(JSON.stringify({ input: input.input, from: input.from }, null, 1)),
  );
  if (workFolder) {
    lines.push(
      "",
      `The goal's work folder (files the steps share): ${workFolder}`,
    );
  }
  if (input.files && input.files.length) {
    lines.push(`Files in it: ${input.files.slice(0, 50).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * @param {{ store: object,
 *           runBot: (botId, opts) => Promise<object>,
 *           isBusy?: (botId) => boolean,
 *           runCheck: (check, input, ctx) => Promise<object>,
 *           filesOf?: (goalId) => string[],
 *           checkContext?: (goal, step) => object,
 *           now?: () => number,
 *           onError?: (e) => void }} deps
 */
function createFlowRunner(deps) {
  const {
    store,
    runBot,
    isBusy = () => false,
    runCheck,
    filesOf = () => [],
    checkContext = () => ({}),
    now = Date.now,
    onError = () => {},
  } = deps;
  // `${taskId}:${stepId}:${round}` → a run or check in progress.
  const inFlight = new Set();
  // Same key → bot runs that ended without a done record.
  const noRecord = new Map();
  // botId → when a run was skipped (paused, over budget): wait a while.
  const skipped = new Map();
  // What each task is waiting on (a paused or busy bot).
  const waiting = new Map();
  let scheduled = false;
  let stopped = false;

  const keyOf = (task) => `${task.id}:${task.stepId}:${task.round || 1}`;

  function inputFor(goal, task, stepId) {
    return buildInput({
      goal,
      task,
      flow: goal.flow,
      stepId,
      files: filesOf(goal.id),
    });
  }

  function startBot(goal, task, step) {
    const key = keyOf(task);
    const input = inputFor(goal, task, step.id);
    const paths = store.paths(goal.id);
    // The bot's own work coming back from its checks: it answers again,
    // and Dash records the answer for it.
    const again = step.id === WORK_STEP;
    inFlight.add(key);
    waiting.delete(task.id);
    let p;
    try {
      p = Promise.resolve(
        runBot(step.botId, {
          prompt: again
            ? retryPrompt({ goal, task, input })
            : stepPrompt({
                goal,
                task,
                step,
                input,
                workFolder: paths ? paths.work : null,
              }),
          trigger: "flow",
          via: `flow:${goal.flow.id || ""}`,
          goal: { goalId: goal.id, taskId: task.id },
          ...(step.limits ? { limits: step.limits } : {}),
          // Work a team lead asked for: every step's run still asks before
          // tools that delete or send, as the first run did (DASH-29).
          ...(goal.source && goal.source.kind === "lead"
            ? { leadRequest: true }
            : {}),
        }),
      );
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (record) => afterBotRun(key, goal.id, task.id, step, record),
      (e) => {
        onError(e);
        afterBotRun(key, goal.id, task.id, step, { status: "failed" });
      },
    ).finally(() => {
      inFlight.delete(key);
      schedule();
    });
  }

  function afterBotRun(key, goalId, taskId, step, record) {
    const task = store.getTask(taskId);
    // Moved on (it wrote its record) or finished: nothing to do.
    if (!task || keyOf(task) !== key) {
      noRecord.delete(key);
      return;
    }
    if (record && record.skipped) {
      skipped.set(step.botId, now());
      waiting.set(taskId, {
        stepId: step.id,
        why: record.reason || `${step.name}'s bot didn't run`,
      });
      return;
    }
    // Its run is over: what it claimed is let go (the app does this too when
    // a run ends; doing it here keeps the order certain).
    if (task.holder && task.holder.botId === step.botId)
      store.release(step.botId);
    const n = (noRecord.get(key) || 0) + 1;
    noRecord.set(key, n);
    if (n < NO_RECORD_TRIES) return; // Started once more on the next pass.
    noRecord.delete(key);
    store.writeStepRecord(taskId, {
      stepId: step.id,
      status: "needs-you",
      summary: `${step.name} ended its run ${NO_RECORD_TRIES} times without a done record${
        record && record.status === "failed" && record.error
          ? ` (${String(record.error).slice(0, 200)})`
          : ""
      }.`,
    });
  }

  async function runCheckStep(goal, task, step) {
    const key = keyOf(task);
    inFlight.add(key);
    waiting.delete(task.id);
    try {
      const ctx = await checkContext(goal, step);
      // The job's work item and workspace (DASH-100) are part of its input.
      const input = {
        ...inputFor(goal, task, step.id),
        ...((ctx && ctx.jobContext) || {}),
      };
      const res = await runCheck(step.check || {}, input, ctx);
      const fresh = store.getTask(task.id);
      if (!fresh || keyOf(fresh) !== key) return;
      store.writeStepRecord(task.id, {
        stepId: step.id,
        // A handoff that asks (DASH-101) waits for a person, not a retry.
        status: res.pass ? "passed" : res.ask ? "needs-you" : "failed",
        ...(res.pass && res.handOn === false ? { handOn: false } : {}),
        ...(res.pass && res.handOn === false && res.ended
          ? { ended: res.ended }
          : {}),
        ...(!res.pass && res.ask ? { ask: res.ask } : {}),
        summary: res.reason,
        details: res.details,
        kind: res.kind,
        ms: res.ms,
        evidence: [
          ...(res.exitCode !== undefined && res.exitCode !== null
            ? [{ label: "exit code", value: String(res.exitCode) }]
            : []),
          ...(res.output ? [{ label: "output", value: res.output }] : []),
        ],
      });
    } catch (e) {
      onError(e);
    } finally {
      inFlight.delete(key);
      schedule();
    }
  }

  /** One pass over every bot checks job. */
  function pass() {
    scheduled = false;
    if (stopped) return;
    let goals = [];
    try {
      goals = store.listGoals();
    } catch (e) {
      onError(e);
      return;
    }
    for (const goal of goals) {
      // Only a bot's checks jobs move here: any other goal is worked through
      // by its bots with their tasks.
      if (!isChecksFlow(goal.flow) || goal.closed || goal.waiting) continue;
      for (const task of goal.tasks || []) {
        if (!task.stepId || task.holder) continue;
        if (["done", "closed", "needs-you", "ready"].includes(task.status))
          continue;
        const step = stepById(goal.flow, task.stepId);
        if (!step) continue;
        const key = keyOf(task);
        if (inFlight.has(key)) continue;
        try {
          if (step.kind === "check") {
            runCheckStep(goal, task, step);
          } else if (step.kind === "bot" && step.botId) {
            const since = skipped.get(step.botId);
            if (since && now() - since < SKIP_WAIT_MS) continue;
            if (isBusy(step.botId)) {
              waiting.set(task.id, {
                stepId: step.id,
                why: `${step.name} is busy with another run`,
              });
              continue;
            }
            startBot(goal, task, step);
          } else if (step.kind === "bot") {
            waiting.set(task.id, {
              stepId: step.id,
              why: `${step.name} has no bot`,
            });
          }
        } catch (e) {
          onError(e);
        }
      }
    }
  }

  /** Run a pass soon (coalesced: many changes, one pass). */
  function schedule() {
    if (scheduled || stopped) return;
    scheduled = true;
    setImmediate(pass);
  }

  return {
    pass,
    schedule,
    stop: () => {
      stopped = true;
    },
    start: () => {
      stopped = false;
      schedule();
    },
    /** What a task is waiting on (paused bot, busy bot), if anything. */
    waitingFor: (taskId) => waiting.get(taskId) || null,
    isWorking: (task) => inFlight.has(keyOf(task)),
    stepKey,
  };
}

module.exports = { createFlowRunner, stepPrompt };
