/**
 * teamTools.js — apps connected to Dash's MCP server talk to team leads
 * (bot-teams TEAM-004; the AI Assistant panel used these until 5e-2c).
 *
 * Dash MCP tools:
 *   list_teams      — dashboards with a team (lead or bots): name, bot count,
 *                     whether it has a lead, last activity.
 *   ask_team_lead   — run a dashboard's lead with a question and return its
 *                     answer, labelled with the team. Recorded on the lead's
 *                     run as via "mcp" ("Asked through Dash's MCP server").
 *   give_task, confirm_task, get_task_status, list_tasks
 *                   — give a team a task to do (TEAM-016). It starts only
 *                     once the user's task passphrase checks out
 *                     (bots/mcpTasks.js), and only on a team the user let
 *                     take tasks. The lead's run is via "mcp-task[:<from>]",
 *                     which may run its bots — an ask (via "mcp") can't.
 *   answer_approval — Allow once / Deny a tool approval a bot in a task's
 *                     job waits on (DASH-32), with the task passphrase;
 *                     off unless the user turns it on. get_task_status
 *                     shows those as status "needs" with an approvals list.
 *
 * A paused or over-budget lead returns that status instead of an answer; a
 * question that fans out to many teams is capped (5 leads per 2 minutes).
 * Handlers take their dependencies so they're testable without Electron.
 */
"use strict";

const {
  summarizeTeams,
  resolveDashboard,
  AskCap,
} = require("../bots/teamDirectory");
const { extractHandoff, withoutHandoff } = require("../bots/handoff");
const { needsLine } = require("../bots/remoteApprovals");

const CAP_LIMIT = 5;
// How long confirm_task waits for the team before saying it's still going.
const TASK_WAIT_MS = 45 * 1000;

const TEAM_TOOLS = [
  {
    name: "list_teams",
    description:
      "List the user's bot teams: each dashboard that has a team lead or bots, with its name, id, number of bots, whether it has a lead, and when the team last ran. Use this before ask_team_lead, and to answer questions like 'what teams do I have?'.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ask_team_lead",
    description: `Ask a dashboard's team lead a question about its team (what its bots did, found, or failed at) and get the lead's answer. 'dashboard' is the dashboard's name or id from list_teams. Each call is a real run of the lead, so ask only the teams the question is about; for a question about all teams, ask each lead once, at most ${CAP_LIMIT} per question. Relay the answer and say which team it came from.`,
    inputSchema: {
      type: "object",
      properties: {
        dashboard: {
          type: "string",
          description: "The dashboard's name or id (from list_teams).",
        },
        question: {
          type: "string",
          description: "The question for the team lead.",
        },
      },
      required: ["dashboard", "question"],
    },
  },
  {
    name: "give_task",
    description:
      "Give one of the user's teams a task to do (not a question — use ask_team_lead for those). Most teams start right away. A team the user set to ask for a passphrase starts only after the user's task passphrase checks out: if the user said it along with the task, pass it as 'passphrase'; otherwise give_task returns status 'waiting' and a taskId — ask the user for their task passphrase and call confirm_task. Never guess or reuse a passphrase the user didn't just say. 'team' is a dashboard name or id from list_teams (only teams with takesTasks); leave it out when the user didn't name one, and the Dash team picks the team that fits — or asks back which.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "What the user wants done, in their words — up to 20,000 characters. A longer task is refused, not cut: shorten it or split it.",
        },
        team: {
          type: "string",
          description: "The team's dashboard name or id (from list_teams).",
        },
        passphrase: {
          type: "string",
          description:
            "The user's task passphrase, only if they said it with this task (only teams that ask for one need it).",
        },
        from: {
          type: "string",
          description:
            "Your app's short name (e.g. 'voice-assistant'), shown next to the task in Dash.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "confirm_task",
    description:
      "Start a task from give_task with the passphrase the user just said. Returns the team's answer if it finishes within about a minute; otherwise it's still running — check with get_task_status.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "From give_task." },
        passphrase: {
          type: "string",
          description: "The user's task passphrase, as they said it.",
        },
      },
      required: ["taskId", "passphrase"],
    },
  },
  {
    name: "get_task_status",
    description:
      "How a task from give_task is going: waiting for the passphrase, running, needs, done (with the team's summary), failed (with why), or expired. A task is running until every bot it set going has finished — the lead, the bots it asked and the ones they handed on to; steps lists each, with its status. While a bot in it waits on the user — a tool approval, or a paused bot — status is 'needs' and approvals lists each, { approvalId, bot, provider, tool, toolTitle, what, askedAt, remote } (a paused bot: { kind: 'paused-bot', bot }); one with remote true can be answered with answer_approval, the rest only in Dash. When done, summary is the lead's answer exactly as it gave it; what the bots it handed on to said is in handOns, each { bot, summary }.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "From give_task." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "list_tasks",
    description:
      "The most recent tasks given to teams via MCP, newest first, with their status ('needs' while a bot in one waits on the user — get_task_status has what).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "answer_approval",
    // Approvals over MCP: off unless the user turns it on (DASH-32).
    defaultOff: true,
    description:
      "Answer a tool approval a bot is waiting on, from get_task_status's approvals — only one marked remote: true (a provider's tool, in a task started over MCP). 'allow_once' lets the bot use the tool this once; 'deny' says no. There's no Always allow: that's only in Dash. It needs the user's task passphrase, said by them just now — never guess or reuse one. The first answer wins, in Dash or here; a later one hears who answered.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: {
          type: "string",
          description: "From get_task_status's approvals.",
        },
        decision: {
          type: "string",
          enum: ["allow_once", "deny"],
          description: "allow_once or deny.",
        },
        passphrase: {
          type: "string",
          description: "The user's task passphrase, as they said it.",
        },
        answeredBy: {
          type: "string",
          description:
            "Who or what answered (your app's short name, or the person it relayed for), kept in Dash's log.",
        },
      },
      required: ["approvalId", "decision", "passphrase"],
    },
  },
];

const json = (body, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(body) }],
  ...(isError ? { isError: true } : {}),
});

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_e) {
    return iso;
  }
};

// How much of each task and summary list_tasks shows.
const LIST_CHARS = 500;

/** A task as the agent sees it — no internal ids. */
const taskView = (t) => ({
  taskId: t.id,
  task: t.task,
  team: t.teamName,
  ...(t.routedBy ? { routedBy: t.routedBy } : {}),
  status: t.status,
  createdAt: t.createdAt,
  ...(t.status === "waiting" ? { expiresAt: t.expiresAt } : {}),
  ...(t.summary ? { summary: t.summary } : {}),
  ...(t.handOns && t.handOns.length ? { handOns: t.handOns } : {}),
  ...(t.needsYou ? { needsUser: t.needsYou } : {}),
  ...(t.error ? { error: t.error } : {}),
  ...(t.endedAt ? { endedAt: t.endedAt } : {}),
});

/** Why a step in a job started, in a few words. */
function stepWhy(why) {
  const w = why || {};
  if (w.kind === "task") return `Task${w.label ? ` from ${w.label}` : ""}`;
  if (w.kind === "you") return "Asked in Dash";
  if (w.kind === "asked") return `Asked by ${w.by || "the team lead"}`;
  if (w.kind === "handon") {
    return `Started by ${w.by || "a bot"}${w.label ? ` › ${w.label}` : ""}`;
  }
  return w.kind || "";
}

/** A job's steps as the agent sees them (DASH-28): bot, status, why. */
const stepsView = (job) =>
  ((job && job.steps) || []).map((st) => ({
    bot: st.botName,
    status: st.status,
    startedBy: stepWhy(st.why),
    ...(st.summary
      ? {
          summary:
            st.summary.length > LIST_CHARS
              ? `${st.summary.slice(0, LIST_CHARS)}…`
              : st.summary,
        }
      : {}),
    ...(st.startedAt ? { startedAt: st.startedAt } : {}),
    ...(st.endedAt ? { endedAt: st.endedAt } : {}),
  }));

/** Running: which bots are still going, or waiting on the user. */
function stillGoing(job) {
  const steps = (job && job.steps) || [];
  const going = steps
    .filter((st) => ["queued", "running", "checking"].includes(st.status))
    .map((st) => st.botName);
  const waiting = steps
    .filter((st) => st.status === "needs-you")
    .map((st) => st.summary || `${st.botName} is waiting on the user.`);
  return [going.length ? `Still going: ${going.join(", ")}.` : "", ...waiting]
    .filter(Boolean)
    .join(" ");
}

/**
 * After the lead's answer: what the bots it set off said (hand-ons), kept
 * apart from it so the lead's answer stays exactly as it gave it (DASH-33).
 */
function afterLead(job) {
  return ((job && job.steps) || [])
    .filter(
      (st) =>
        st.why &&
        st.why.kind === "handon" &&
        st.status === "done" &&
        st.summary,
    )
    .map((st) => ({ bot: st.botName, summary: st.summary }));
}

/** The hand-ons as text: each in its own paragraph, after a blank line. */
const handOnsText = (t) =>
  (t.handOns || []).map((h) => `\n\n${h.bot}: ${h.summary}`).join("");

const STATUS_MESSAGE = {
  waiting: (t) =>
    `Waiting for the user's task passphrase (expires at ${timeOf(t.expiresAt)}). Ask them for it and call confirm_task.`,
  running: (t) => `${t.teamName} is working on it.`,
  done: (t) =>
    t.needsYou
      ? `${`${t.teamName} did what it could, but part of it needs the user in Dash: ${t.needsYou} ${t.summary || ""}`.trim()}${handOnsText(t)}`
      : `${t.teamName} finished: ${t.summary || "(no summary)"}${handOnsText(t)}`,
  failed: (t) => `${t.teamName} couldn't do it: ${t.error}`,
  expired: () =>
    "It expired before the passphrase was given. Give the task again if the user still wants it.",
};

/** What the lead is asked: the task, and that the user stands behind it. */
function taskPrompt(t) {
  return `${t.task}\n\n(A task given via MCP${t.from ? ` by ${t.from}` : ""}${t.needsPassphrase === false ? "" : "; the user confirmed it with their task passphrase"}. Do it with your team's bots, then sum up in a few sentences what was done and anything still waiting on the user.)`;
}

const reply = (text, isError = false) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

const sameId = (a, b) =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);

/**
 * @param {{ getWorkspaces: () => object[],
 *           bots: { list, getRuns, leadAvailability, askLead },
 *           cap?: AskCap }} deps
 */
function makeTeamToolHandlers({
  getWorkspaces,
  bots,
  cap = new AskCap({ limit: CAP_LIMIT }),
  taskWaitMs = TASK_WAIT_MS,
  // Settings › MCP Server › Tools: answer_approval is off unless turned on.
  isOn = () => true,
}) {
  // What a running task's job waits on (DASH-32): its approvals and paused
  // bots, or none.
  const jobNeeds = (task) => {
    if (!task || task.status !== "running" || !task.jobId) return [];
    try {
      return (bots.jobApprovals && bots.jobApprovals(task.jobId)) || [];
    } catch (_e) {
      return [];
    }
  };

  const lastRunAt = (botId) => {
    try {
      const runs = bots.getRuns(botId, { limit: 1 }) || [];
      const last = runs[runs.length - 1];
      return (last && (last.endedAt || last.at || last.startedAt)) || null;
    } catch (_e) {
      return null;
    }
  };

  const takesTasks = (id) => {
    try {
      return !!(bots.takesMcpTasks && bots.takesMcpTasks(id));
    } catch (_e) {
      return false;
    }
  };

  // Does this team ask for the passphrase before a task starts? Its setting
  // (off unless turned on).
  const asksPassphrase = (id) => {
    try {
      return !!(bots.asksTaskPassphrase && bots.asksTaskPassphrase(id));
    } catch (_e) {
      return false;
    }
  };

  // A task's run, from the passphrase on: the lead does it with its bots
  // (allowed — the user confirmed it), and the task follows the run.
  const startTask = (task) => {
    const tasks = bots.tasks();
    // Its job follows the whole chain — the lead, the bots it asks and
    // their hand-ons — so the task is done only when all of it is (DASH-28).
    const jobId = bots.startTaskJob ? bots.startTaskJob(task) : null;
    tasks.running(task.id, { jobId });
    const via = `mcp-task${task.from ? `:${task.from}` : ""}`;
    // Notes left by an earlier run don't belong to this task.
    const takeNotes = () =>
      (bots.takeTaskNotes && bots.takeTaskNotes(task.leadId)) || [];
    takeNotes();
    return Promise.resolve()
      .then(() =>
        bots.askLead(task.leadId, taskPrompt(task), {
          via,
          // Kept as a conversation: the task as it was given, and by whom.
          shown: task.task,
          from: task.from || "mcp",
          ...(jobId ? { jobId } : {}),
        }),
      )
      .then((result) => {
        if (result && result.skipped) {
          if (jobId && bots.abandonJob) {
            bots.abandonJob(
              jobId,
              `The team lead didn't start${result.reason ? `: ${result.reason}` : ""}.`,
            );
          }
          return tasks.failed(
            task.id,
            result.reason && result.reason !== "a run is already in progress"
              ? `The team lead didn't start: ${result.reason}.`
              : "The team lead was busy with something else. Give the task again in a moment.",
          );
        }
        // Only a finished run is done: one stopped in Dash, or cut off when
        // Dash closed, has at most part of an answer. Each keeps its run.
        const ran = { runAt: (result && result.startedAt) || null };
        const ok = result && result.status === "completed" && !result.error;
        if (!ok && jobId && bots.abandonJob) {
          bots.abandonJob(
            jobId,
            (result && result.error) || "The team lead didn't finish.",
          );
        }
        if (result && result.status === "stopped") {
          return tasks.failed(task.id, "It was stopped in Dash.", ran);
        }
        if (result && result.status === "interrupted") {
          return tasks.failed(
            task.id,
            "Dash closed before the team finished.",
            ran,
          );
        }
        if (!result || result.status !== "completed" || result.error) {
          return tasks.failed(
            task.id,
            (result && result.error) || "unknown error",
            ran,
          );
        }
        const notes = takeNotes();
        const lead = {
          summary: withoutHandoff(result.output) || "",
          runAt: result.startedAt || null,
          needsYou: notes.length ? notes.join(" ") : null,
        };
        if (!jobId || !bots.waitForJob) return tasks.done(task.id, lead);
        // The lead has answered; the task ends when its job does.
        return Promise.resolve(bots.waitForJob(jobId)).then((job) => {
          if (!job || job.status === "done") {
            return tasks.done(task.id, { ...lead, handOns: afterLead(job) });
          }
          const bad = job.steps.find(
            (st) => st.status === "failed" || st.status === "stopped",
          );
          return tasks.failed(
            task.id,
            bad
              ? `${bad.botName} ${bad.status === "failed" ? "failed" : "was stopped"}${bad.summary ? `: ${bad.summary}` : "."}`
              : `The job ${job.status}.`,
            { runAt: lead.runAt },
          );
        });
      })
      .catch((err) => {
        if (jobId && bots.abandonJob) {
          bots.abandonJob(jobId, (err && err.message) || String(err));
        }
        return tasks.failed(task.id, (err && err.message) || String(err));
      });
  };

  /** Passphrase checks out → start; otherwise say what to do next. */
  const confirm = async (task, passphrase) => {
    const tasks = bots.tasks();
    const check = tasks.verify(passphrase);
    if (check.notSet) {
      return json({
        taskId: task.id,
        status: task.status,
        message:
          "The user hasn't set a task passphrase. They can set one in Dash: Settings › MCP Server › Task passphrase.",
      });
    }
    if (check.locked) {
      const why = check.wrong
        ? "That passphrase isn't right either, and that was 5 wrong ones"
        : "There were 5 wrong passphrases";
      return json({
        taskId: task.id,
        status: task.status,
        message: `${why}: tasks are locked until ${timeOf(
          check.locked,
        )}. The user can unlock them in Dash: Settings › MCP Server.`,
      });
    }
    if (check.wrong) {
      return json({
        taskId: task.id,
        status: task.status,
        message: `That passphrase isn't right. ${check.triesLeft} ${
          check.triesLeft === 1 ? "try" : "tries"
        } left before tasks lock for 15 minutes. Ask the user to say it again.`,
      });
    }
    return start(task);
  };

  /** Start a task now and wait a while for the team's answer. */
  const start = async (task, prefix = "") => {
    const tasks = bots.tasks();
    // Still allowed? The team could have been turned off or paused since.
    const blocked = teamBlocked(task.teamId, task.leadId, task.teamName);
    if (blocked) {
      tasks.failed(task.id, blocked);
      return json({ taskId: task.id, status: "failed", message: blocked });
    }
    const finished = startTask(task);
    let timer;
    const wait = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), taskWaitMs);
    });
    let done;
    try {
      done = await Promise.race([finished, wait]);
    } finally {
      clearTimeout(timer);
    }
    const now = done || tasks.get(task.id) || task;
    return json({
      ...taskView(now),
      message: `${prefix}${
        done
          ? STATUS_MESSAGE[now.status](now)
          : `${task.teamName} has started. It's still working — check with get_task_status(taskId).`
      }`,
    });
  };

  // Why this team can't take a task now, or null.
  const teamBlocked = (teamId, leadId, name) => {
    if (!takesTasks(teamId)) {
      return `${name} doesn't take tasks via MCP. The user can turn on "Takes tasks via MCP" in that dashboard's Bots view.`;
    }
    const lead = bots.list().find((b) => b.id === leadId);
    if (!lead) {
      return `${name} has no team lead. The user can turn one on in that dashboard's Bots view.`;
    }
    const avail = bots.leadAvailability(leadId) || {};
    if (avail.otherProfile) {
      return `${name} isn't in the profile Dash has open. The user can switch profiles in Dash.`;
    }
    if (avail.allPaused) {
      return "All bots are paused in Dash. The user can resume them there.";
    }
    if (avail.paused) {
      return `${name}'s team is paused. The user can resume it in the dashboard's Bots view.`;
    }
    if (avail.overBudget) {
      return `${name}'s team is over its budget. The user can raise it in Settings › Bots.`;
    }
    const tasks = bots.tasks();
    if (
      asksPassphrase(teamId) &&
      tasks.passphraseSet &&
      !tasks.passphraseSet()
    ) {
      return `${name} asks for a passphrase first, and none is set. The user can set one in Dash: Settings › MCP Server.`;
    }
    return null;
  };

  return {
    async give_task(args = {}) {
      const text = String((args && args.task) || "").trim();
      if (!text) return json({ message: "give_task needs a 'task'." }, true);
      // Never cut: a longer task is refused, with the limit (DASH-23).
      const { MAX_TASK_CHARS } = require("../bots/mcpTasks");
      if (text.length > MAX_TASK_CHARS) {
        return json({
          status: "invalid",
          message: `The task is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_TASK_CHARS.toLocaleString("en-US")}. Shorten it or split it into separate tasks — nothing was cut or started.`,
        });
      }
      const tasks = bots.tasks();
      if (tasks.mentionsPassphrase && tasks.mentionsPassphrase(text)) {
        // Never kept: not in a task, the routing log or the lead's prompt.
        return json({
          status: "invalid",
          message:
            "The task text has the passphrase in it. Give the task without it, and the passphrase separately as 'passphrase'.",
        });
      }
      const workspaces = getWorkspaces();
      const teams = summarizeTeams({
        workspaces,
        bots: bots.list(),
        lastRunAt: () => null,
      }).filter((t) => takesTasks(t.id));
      const names = teams.map((t) => `${t.name} (id ${t.id})`).join(", ");
      if (!teams.length) {
        return json({
          status: "needs-team",
          message: `No team takes tasks via MCP yet. The user can turn on "Takes tasks via MCP" in a dashboard's Bots view.`,
        });
      }
      let ws;
      let routedBy = null;
      if (!args.team) {
        // No team named: the Dash Lead picks the one that fits.
        const route = await bots.routeTask(text, teams, {
          from: args.from || null,
        });
        if (route.error) {
          return json({
            status: "needs-team",
            message: `${route.error} Ask the user which team: ${names}. Then call give_task again with 'team'.`,
          });
        }
        if (route.none) {
          return json({
            status: "no-team",
            message: `None of the user's teams does that kind of work. Teams that take tasks: ${names}. If the user wants a team for it, they can ask the Dash team in Dash to make one.`,
          });
        }
        if (route.ambiguous) {
          return json({
            status: "needs-team",
            message: `Which team: ${route.ambiguous
              .map((t) => `${t.name} (id ${t.id})`)
              .join(
                " or ",
              )}? Ask the user, then call give_task again with 'team'.`,
          });
        }
        ws = workspaces.find((w) => sameId(w.id, route.team.id));
        routedBy = "dash-team";
      } else {
        const found = resolveDashboard(
          workspaces.filter((w) => teams.some((t) => sameId(t.id, w.id))),
          args.team,
        );
        if (found.none) {
          return json({
            status: "needs-team",
            message: `No team that takes tasks matches "${args.team}". Teams that take tasks: ${names}.`,
          });
        }
        if (found.ambiguous) {
          return json({
            status: "needs-team",
            message: `Several teams match "${args.team}": ${found.ambiguous
              .map((w) => `${w.name} (id ${w.id})`)
              .join(
                ", ",
              )}. Ask the user which one, then call again with its id.`,
          });
        }
        ws = found.match;
      }
      const name = ws.name || "Untitled";
      const lead = bots
        .list()
        .find((b) => b.role === "lead" && sameId(b.workspaceId, ws.id));
      const blocked = teamBlocked(ws.id, lead && lead.id, name);
      if (blocked) return json({ status: "blocked", message: blocked });
      const needsPassphrase = asksPassphrase(ws.id);
      const locked = needsPassphrase && tasks.lockedUntil();
      if (locked) {
        return json({
          status: "locked",
          message: `Tasks are locked after 5 wrong passphrases until ${timeOf(
            locked,
          )}. The user can unlock them in Dash: Settings › MCP Server.`,
        });
      }

      const task = tasks.create({
        task: text,
        team: { id: ws.id, name, leadId: lead.id },
        from: args.from,
        routedBy,
        needsPassphrase,
      });
      const picked = routedBy ? `The Dash team picked ${name}. ` : "";
      // No passphrase asked for: it starts now.
      if (!needsPassphrase) return start(task, picked);
      if (args.passphrase) return confirm(task, args.passphrase);
      return json({
        ...taskView(task),
        message: `${picked}${name} will do: "${text}". Ask the user for their task passphrase, then call confirm_task(taskId, passphrase). It expires at ${timeOf(
          task.expiresAt,
        )}.`,
      });
    },

    async confirm_task(args = {}) {
      const task = bots.tasks().get(String((args && args.taskId) || ""));
      if (!task) {
        return json({ message: "No task with that taskId." }, true);
      }
      if (task.status !== "waiting") {
        return json({
          ...taskView(task),
          message: STATUS_MESSAGE[task.status](task),
        });
      }
      return confirm(task, args.passphrase);
    },

    async get_task_status(args = {}) {
      const task = bots.tasks().get(String((args && args.taskId) || ""));
      if (!task) {
        return json({ message: "No task with that taskId." }, true);
      }
      const job = task.jobId && bots.getJob ? bots.getJob(task.jobId) : null;
      // Waiting on the user: reported as "needs" (the task itself is still
      // running), with what it waits on.
      // With answer_approval off, nothing can be answered from here.
      const canAnswer = isOn("answer_approval");
      const needs = (job ? jobNeeds(task) : []).map((n) =>
        canAnswer || !n.remote ? n : { ...n, remote: false },
      );
      if (needs.length) {
        const remote = needs.some((n) => n.remote);
        return json({
          ...taskView(task),
          status: "needs",
          jobId: job.id,
          steps: stepsView(job),
          approvals: needs,
          message: `${needsLine(needs)}${
            remote
              ? " One marked remote can be answered with answer_approval and the user's task passphrase; the user can also answer in Dash."
              : " The user can answer in Dash."
          }`,
        });
      }
      const going = task.status === "running" && job ? stillGoing(job) : "";
      return json({
        ...taskView(task),
        ...(job ? { jobId: job.id, steps: stepsView(job) } : {}),
        message: `${STATUS_MESSAGE[task.status](task)}${going ? ` ${going}` : ""}`,
      });
    },

    async answer_approval(args = {}) {
      if (!isOn("answer_approval")) {
        return json(
          {
            error: "turned_off",
            message:
              "answer_approval is turned off in Dash (Settings › MCP Server › Tools).",
          },
          true,
        );
      }
      const decision = String((args && args.decision) || "");
      if (decision !== "allow_once" && decision !== "deny") {
        return json(
          {
            error: "bad_decision",
            message: "decision is 'allow_once' or 'deny'.",
          },
          true,
        );
      }
      const approvalId = String((args && args.approvalId) || "");
      const check = bots.checkRemoteApproval(approvalId);
      if (check.error) {
        const { approval: _a, job: _j, ok: _o, ...err } = check;
        return json({ approvalId, ...err }, true);
      }
      // Always the passphrase, even for a team whose tasks don't ask.
      const pass = bots.tasks().verify(args.passphrase);
      if (pass.notSet) {
        return json(
          {
            approvalId,
            error: "passphrase_not_set",
            message:
              "The user hasn't set a task passphrase, so nothing was answered. They can set one in Dash: Settings › MCP Server › Task passphrase.",
          },
          true,
        );
      }
      if (pass.locked) {
        const why = pass.wrong
          ? "That passphrase isn't right either, and that was 5 wrong ones"
          : "There were 5 wrong passphrases";
        return json(
          {
            approvalId,
            error: "locked",
            message: `${why}: answers over MCP are locked until ${timeOf(
              pass.locked,
            )}. Nothing was answered; the user can answer in Dash.`,
          },
          true,
        );
      }
      if (pass.wrong) {
        return json(
          {
            approvalId,
            error: "bad_passphrase",
            triesLeft: pass.triesLeft,
            message: `That passphrase isn't right, so nothing was answered. ${
              pass.triesLeft
            } ${pass.triesLeft === 1 ? "try" : "tries"} left before it locks for 15 minutes. Ask the user to say it again.`,
          },
          true,
        );
      }
      const allow = decision === "allow_once";
      const res = bots.answerApproval(approvalId, {
        allow,
        answeredBy: args.answeredBy ? String(args.answeredBy) : null,
      });
      if (!res || res.error) {
        const {
          approval: _a,
          job: _j,
          ok: _o,
          ...err
        } = res || {
          error: "unknown_approval",
        };
        return json({ approvalId, ...err }, true);
      }
      const a = res.approval || {};
      const tool = `${a.toolTitle || "the tool"}${a.provider ? ` on ${a.provider}` : ""}`;
      return json({
        approvalId,
        status: allow ? "allowed" : "denied",
        message: allow
          ? `Allowed once: ${a.bot || "the bot"} can use ${tool} this time.`
          : `Denied: ${a.bot || "the bot"} won't use ${tool}.`,
      });
    },

    async list_tasks() {
      // A list stays short: each task and summary trimmed — get_task_status
      // has the whole of one.
      const clip = (v) =>
        typeof v === "string" && v.length > LIST_CHARS
          ? `${v.slice(0, LIST_CHARS)}… (get_task_status has all of it)`
          : v;
      return json({
        tasks: bots
          .tasks()
          .list({ limit: 10 })
          .map((t) => ({
            ...taskView(t),
            // Waiting on the user: "needs" (get_task_status has what).
            ...(jobNeeds(t).length ? { status: "needs" } : {}),
          }))
          .map((t) => ({
            ...t,
            task: clip(t.task),
            ...(t.summary ? { summary: clip(t.summary) } : {}),
            ...(t.handOns
              ? {
                  handOns: t.handOns.map((h) => ({
                    ...h,
                    summary: clip(h.summary),
                  })),
                }
              : {}),
          })),
      });
    },

    async list_teams() {
      const teams = summarizeTeams({
        workspaces: getWorkspaces(),
        bots: bots.list(),
        lastRunAt,
      }).map((t) => ({
        ...t,
        takesTasks: takesTasks(t.id),
        ...(takesTasks(t.id) ? { asksPassphrase: asksPassphrase(t.id) } : {}),
      }));
      return reply(
        JSON.stringify({
          teams,
          note: teams.length
            ? "Ask a team's lead with ask_team_lead(dashboard, question)."
            : "No dashboard has a team yet. Bots are added in a dashboard's Bots view.",
        }),
      );
    },

    async ask_team_lead(args = {}) {
      const question = String((args && args.question) || "").trim();
      if (!question) return reply("ask_team_lead needs a 'question'.", true);

      const workspaces = getWorkspaces();
      const found = resolveDashboard(workspaces, args.dashboard);
      if (found.none) {
        const teams = summarizeTeams({
          workspaces,
          bots: bots.list(),
          lastRunAt,
        });
        return reply(
          `No dashboard matches "${args.dashboard || ""}". Teams: ${
            teams.map((t) => `${t.name} (id ${t.id})`).join(", ") || "none yet"
          }.`,
        );
      }
      if (found.ambiguous) {
        return reply(
          `Several dashboards match "${args.dashboard}": ${found.ambiguous
            .map((w) => `${w.name} (id ${w.id})`)
            .join(", ")}. Ask the user which one, then call again with its id.`,
        );
      }
      const ws = found.match;
      const name = ws.name || "Untitled";
      const lead = bots
        .list()
        .find((b) => b.role === "lead" && sameId(b.workspaceId, ws.id));
      if (!lead) {
        return reply(
          `${name} has no team lead. The user can turn one on in that dashboard's Bots view (the Dashboard | Bots switch next to its name → "Team lead is off · Turn on").`,
        );
      }
      const avail = bots.leadAvailability(lead.id) || {};
      if (avail.paused) {
        return reply(
          `${name}'s team lead is paused, so it can't answer. The user can resume it in the dashboard's Bots view.`,
        );
      }
      if (avail.overBudget) {
        return reply(
          `${name}'s team lead is over its budget, so it can't answer right now. The user can raise the budget in Settings › Bots.`,
        );
      }
      if (!cap.take()) {
        return reply(
          `Already asked ${capLimitOf(cap)} team leads in the last couple of minutes — each ask is a real run. Summarize what you have, or ask the user before asking more.`,
        );
      }

      const result = await bots.askLead(lead.id, question, {
        via: "mcp",
        shown: question,
        from: "mcp",
      });
      if (result && result.skipped) {
        return reply(
          `${name}'s team lead is busy answering another question. Try again in a moment.`,
        );
      }
      if (!result || result.status === "failed" || result.error) {
        return reply(
          `${name}'s team lead couldn't answer: ${
            (result && result.error) || "unknown error"
          }`,
        );
      }
      // Asked to make something, the lead hands it to the Dash team
      // (Phase 2c-2): said in words here — the marker is for Dash's UI.
      const handoff = extractHandoff(result.output);
      const handoffNote = handoff
        ? `\n\nThe lead suggests planning this with the Dash team: in Dash, open Create and ask for "${handoff.request}" on ${name}.`
        : "";
      return reply(
        `Team: ${name} (lead: ${lead.name})\n\n${withoutHandoff(result.output) || "(no answer)"}${handoffNote}`,
      );
    },
  };
}

function capLimitOf(cap) {
  return cap && typeof cap._limit === "number" ? cap._limit : CAP_LIMIT;
}

/** Register the team tools with the Dash MCP server (app startup). */
function registerTeamTools() {
  const {
    registerTool,
    getServerContext,
    isToolOn,
  } = require("../controller/mcpDashServerController");
  const workspaceController = require("../controller/workspaceController");
  const botController = require("../controller/botController");

  const handlers = makeTeamToolHandlers({
    getWorkspaces: () => {
      const ctx = getServerContext();
      if (!ctx)
        throw new Error("MCP server is not running or has no active window");
      const result = workspaceController.listWorkspacesForApplication(
        ctx.win,
        ctx.appId,
      );
      return (result && result.workspaces) || [];
    },
    bots: {
      list: () => botController.list(),
      getRuns: (id, opts) => botController.getRuns(id, opts),
      leadAvailability: (id) => botController.leadAvailability(id),
      askLead: (id, q, opts) => botController.askLead(id, q, opts),
      takesMcpTasks: (id) => botController.takesMcpTasks(id),
      asksTaskPassphrase: (id) => botController.asksTaskPassphrase(id),
      tasks: () => botController.mcpTasks(),
      routeTask: (task, teams, opts) =>
        botController.routeMcpTask(task, teams, opts),
      takeTaskNotes: (leadId) => botController.takeTaskNotes(leadId),
      // Jobs (DASH-28): the task follows its whole chain.
      startTaskJob: (task) => botController.startTaskJob(task),
      waitForJob: (jobId) => botController.waitForJob(jobId),
      getJob: (jobId) => botController.getJob(jobId),
      abandonJob: (jobId, why) => botController.abandonJob(jobId, why),
      // Approvals over MCP (DASH-32).
      jobApprovals: (jobId) => botController.jobApprovals(jobId),
      checkRemoteApproval: (id) => botController.checkRemoteApproval(id),
      answerApproval: (id, opts) => botController.answerApproval(id, opts),
    },
    isOn: (name) => isToolOn(name),
  });

  for (const tool of TEAM_TOOLS) {
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.defaultOff ? { defaultOff: true } : {}),
      handler: (args) => handlers[tool.name](args),
    });
  }
}

module.exports = { TEAM_TOOLS, makeTeamToolHandlers, registerTeamTools };
