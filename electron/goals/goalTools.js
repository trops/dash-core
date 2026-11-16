/**
 * goalTools.js
 *
 * The goals ledger as bot tools (goals-ledger PRD, GOAL-002): create_goal,
 * add_task, list_tasks, claim_task, read_task, write_done. Served under a
 * virtual "bot-goals" server the PermissionGate auto-allows — the ledger is
 * the dashboard's own shared record, not an outside action.
 *
 * A bot only sees the goals of its own dashboard. A bot on no dashboard has
 * no ledger. The run's goal holder (`ctx.goal`) is set when the bot creates
 * a goal or claims a task, so the run record and the events it sends carry
 * that goal's id.
 *
 * Portable: no Electron. Result shape matches the engines' executeTool
 * contract: { text, isError }.
 */
"use strict";

const GOALS_SERVER = "bot-goals";

const GOAL_TOOLS = [
  {
    name: "create_goal",
    description:
      "Start a goal on your dashboard's ledger: the main thing being worked on (e.g. a ticket to ship, this week's newsletter). Add its pieces with add_task. Returns the goal id and the folders for its work files and evidence.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the goal." },
        body: {
          type: "string",
          description: "What it's about: the request, ticket text, notes.",
        },
        source: {
          type: "object",
          description:
            "Where it came from, when it came from outside Dash (a ticket, a note).",
          properties: {
            kind: {
              type: "string",
              description: "e.g. ticket, note, email, schedule.",
            },
            ref: {
              type: "string",
              description: "Its id or link in that system.",
            },
            label: { type: "string", description: "e.g. the ticket key." },
          },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "add_task",
    description:
      "Add a task to a goal. A task starts as 'new' and moves new → claimed → built → checked → ready, one step per done record. The user marks it done.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        title: { type: "string", description: "What this task is." },
        body: { type: "string", description: "Details for whoever does it." },
        maxRounds: {
          type: "number",
          description:
            "How many tries before it stops and waits for the user (default 3).",
        },
      },
      required: ["goalId", "title"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks on your dashboard's ledger, optionally only one goal's or only those with a status. Use status to find work waiting for you: 'new' to start work, 'built' to check work, 'checked' for a final review.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        status: {
          type: "string",
          enum: [
            "new",
            "claimed",
            "built",
            "checked",
            "ready",
            "done",
            "needs-you",
            "closed",
          ],
        },
      },
    },
  },
  {
    name: "read_task",
    description:
      "Read one task: its goal, status, round, and every done record so far (with evidence and any fix list).",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "claim_task",
    description:
      "Take a task to work on before doing it. Only one bot holds a task at a time; it's let go when you write its done record or your run ends.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "write_done",
    description:
      "Finish your step on a task you claimed with a done record. 'passed' moves it to the next step; 'failed' sends it back for another round with your summary as the fix list (or to the user once its rounds are used up); 'needs-you' stops it for the user. Always include evidence: commands run and their exit codes, links, ids, file paths, totals.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["passed", "failed", "needs-you"] },
        summary: {
          type: "string",
          description:
            "What you did, or on a fail what must be fixed, or what you need from the user.",
        },
        evidence: {
          type: "array",
          description:
            "Proof for this record, each a {label, value}: e.g. {label: 'PR', value: 'https://…'}, {label: 'npm run ci', value: 'exit 0'}.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
          },
        },
      },
      required: ["taskId", "status", "summary"],
    },
  },
];

const ok = (text) => ({ text, isError: false });
const fail = (text) => ({ text, isError: true });

const onDashboard = (ws) => ws !== null && ws !== undefined && ws !== "";

function taskLine(t) {
  const holder = t.holder
    ? ` · held by ${t.holder.botName || t.holder.botId}`
    : "";
  return `${t.id} [${t.status}, round ${t.round}/${t.maxRounds}] ${t.title} (goal ${t.goalId})${holder}`;
}

function taskText(store, task) {
  const goal = store.getGoal(task.goalId);
  const lines = [
    `Task ${task.id}: ${task.title}`,
    `Goal ${task.goalId}: ${goal ? goal.title : ""}`,
    `Status: ${task.status} · round ${task.round} of ${task.maxRounds}`,
  ];
  if (task.body) lines.push("", task.body);
  if (goal && goal.body) lines.push("", "About the goal:", goal.body);
  const p = store.paths(task.goalId);
  if (p)
    lines.push("", `Work folder: ${p.work}`, `Evidence folder: ${p.evidence}`);
  if ((task.history || []).length) {
    lines.push("", "Done records:");
    for (const r of task.history) {
      const who = r.by === "you" ? "the user" : r.botName || r.botId || "a bot";
      lines.push(
        `- ${who}: ${r.status} (${r.from} → ${r.to}, round ${r.round})${r.summary ? ` — ${r.summary}` : ""}`,
      );
      for (const e of r.evidence || []) {
        lines.push(`    ${e.label ? `${e.label}: ` : ""}${e.value}`);
      }
    }
  }
  return lines.join("\n");
}

/** Point the run at this goal (its record and events carry the id). */
function follow(ctx, goalId, taskId) {
  if (!ctx || !ctx.goal) return;
  ctx.goal.goalId = goalId;
  if (taskId !== undefined) ctx.goal.taskId = taskId;
}

/**
 * Execute a goal tool call in-process.
 * @param {ReturnType<import("./goalStore").createGoalStore>} store
 * @param {{ workspaceId?: string|number, botId?: string, botName?: string,
 *           conversationId?: string|null,
 *           goal?: { goalId: string|null, taskId: string|null } }} ctx
 */
function handleGoalTool(store, ctx = {}, toolName, args = {}) {
  if (!store) return fail("The goals ledger isn't available.");
  const ws = ctx.workspaceId;
  if (!onDashboard(ws)) {
    return fail(
      "Goals belong to a dashboard, and you aren't on one. Ask the user to add you to a dashboard.",
    );
  }
  const a = args || {};
  const own = (taskId) => {
    const task = store.getTask(taskId);
    const goal = task && store.getGoal(task.goalId);
    if (!task || !goal || String(goal.workspaceId) !== String(ws)) return null;
    return task;
  };
  try {
    switch (toolName) {
      case "create_goal": {
        const r = store.createGoal({
          workspaceId: ws,
          title: a.title,
          body: a.body,
          source: a.source,
          conversationId: ctx.conversationId || null,
          createdBy: { botId: ctx.botId || null, botName: ctx.botName || null },
        });
        if (r.error) return fail(r.error);
        follow(ctx, r.goal.id, null);
        const p = store.paths(r.goal.id);
        return ok(
          `Started goal ${r.goal.id}: ${r.goal.title}\nAdd its tasks with add_task.\nWork folder: ${p.work}\nEvidence folder: ${p.evidence}`,
        );
      }
      case "add_task": {
        const goal = store.getGoal(a.goalId);
        if (!goal || String(goal.workspaceId) !== String(ws)) {
          return fail("No such goal on your dashboard.");
        }
        const r = store.addTask(a.goalId, a);
        if (r.error) return fail(r.error);
        return ok(`Added ${taskLine(r.task)}`);
      }
      case "list_tasks": {
        const list = store.listTasks({
          workspaceId: ws,
          goalId: a.goalId || undefined,
          status: a.status || undefined,
        });
        if (!list.length) {
          return ok(
            a.status
              ? `No '${a.status}' tasks on your dashboard.`
              : "No tasks on your dashboard.",
          );
        }
        return ok(list.map(taskLine).join("\n"));
      }
      case "read_task": {
        const task = own(a.taskId);
        if (!task) return fail("No such task on your dashboard.");
        return ok(taskText(store, task));
      }
      case "claim_task": {
        if (!own(a.taskId)) return fail("No such task on your dashboard.");
        const r = store.claimTask(a.taskId, {
          botId: ctx.botId,
          botName: ctx.botName,
          workspaceId: ws,
        });
        if (r.error) return fail(r.error);
        follow(ctx, r.task.goalId, r.task.id);
        return ok(`Claimed. ${taskText(store, r.task)}`);
      }
      case "write_done": {
        if (!own(a.taskId)) return fail("No such task on your dashboard.");
        const r = store.writeDone(a.taskId, {
          botId: ctx.botId,
          botName: ctx.botName,
          workspaceId: ws,
          status: a.status,
          summary: a.summary,
          evidence: a.evidence,
        });
        if (r.error) return fail(r.error);
        follow(ctx, r.task.goalId, r.task.id);
        const where =
          r.task.status === "needs-you"
            ? r.record.stopped
              ? "It has used its rounds and now waits for the user."
              : "It now waits for the user."
            : r.task.status === "new"
              ? `It goes back for round ${r.task.round} of ${r.task.maxRounds}.`
              : `It is now '${r.task.status}'.`;
        return ok(`Done record saved. ${where}`);
      }
      default:
        return fail(`Unknown goal tool '${toolName}'.`);
    }
  } catch (e) {
    return fail(`Goal tool error: ${(e && e.message) || e}`);
  }
}

// A dashboard's lead starts and follows goals and hands their tasks to the
// team; only the team's bots claim tasks and write done records.
const LEAD_GOAL_TOOL_NAMES = [
  "create_goal",
  "add_task",
  "list_tasks",
  "read_task",
];
const LEAD_GOAL_TOOLS = GOAL_TOOLS.filter((t) =>
  LEAD_GOAL_TOOL_NAMES.includes(t.name),
);

module.exports = {
  GOALS_SERVER,
  GOAL_TOOLS,
  LEAD_GOAL_TOOLS,
  handleGoalTool,
};
