# PRD: Goals Ledger — What a Dashboard's Bots Are Working On

**Status:** In Progress
**Last Updated:** 2026-11-16
**Owner:** John Giatropoulos
**Ticket:** DASH-2 (epic DASH-1, "Loops and graphs: bots that finish work without you")
**Location:** dash-core (store, bot tools, IPC, Goals tab); dash-electron (IPC handlers)
**Related PRDs:** [bot-teams.md](./bot-teams.md), [team-dashboards.md](./team-dashboards.md), [issues.md](./issues.md)

Architecture PRD, use cases and mockups: "Loops and graphs in Dash" (claude.ai artifact FDGmPi9ckYeEBL5CQkFegr), Build plan › Phase 1. Mockup frames 1, 2, 4 and 8 on the design canvas page "Goals and graph (proposed)".

---

## Executive Summary

Each dashboard keeps a ledger of goals. A goal is the main thing being worked on (a ticket to ship, this week's newsletter). It holds tasks, and each task has a status, a round count and a history of **done records** (a status plus evidence). Bots work on tasks through six tools; the next bot starts from a task's status, never from a chat message. Runs and events carry the goal's id, so a goal's work can be found — and deleted — in one go. The dashboard gets a **Goals** tab next to Dashboard and Bots.

This is phase 1 of 7. Later phases add check steps that re-verify a done record's evidence (phase 2), declared step outputs (3), flows and the Graph tab (4), work folders and command lists (5), criteria (6) and publishing flows (7).

## Problem Statement

Bots hand work to each other through events and loose results. Nothing records what's being worked on, by whom, how many tries it's had or what proved each step. A bot that misses an event (cooldown, a skipped schedule) loses the handoff. Deleting a conversation removes its messages but not the bot runs it set off. Bot memory is private and free text; results replace each other.

## User Stories

### GOAL-001: A ledger of goals and tasks (P0)

- [x] AC1: A goal is a folder at `<userData>/goals/<goalId>/`: `goal.json`, `tasks/<taskId>.json`, `evidence/`, `work/`. Records are sealed at rest (secretBox) and written to a temp file, then renamed into place. A goal sealed by another keychain is kept, never overwritten.
- [x] AC2: A goal belongs to one dashboard, and remembers where it came from (a ticket, a note, a conversation, a bot) and the conversation that started it.
- [x] AC3: Task statuses: `new → claimed → built → checked → ready → done`, plus `needs-you` and `closed`. A passed record moves the task one step on. A failed record sends it back to `new` for the next round, or — at its round limit (default 3, at most 10) — to `needs-you`. Only the user moves `ready → done`, gives one more round, or closes. ("Failed" is a done-record status, not a task status: a failed task is back to `new` or waiting for you.)
- [x] AC4: Only one bot holds a task. A claim is let go when the bot writes its done record or its run ends.
- [x] AC5: At most 50 done records per task; evidence is up to 20 `{label, value}` pairs.

### GOAL-002: Bots work through the ledger (P0)

- [x] AC1: A bot on a dashboard gets `create_goal`, `add_task`, `list_tasks`, `read_task`, `claim_task` and `write_done`, allowed without a prompt (the ledger is the dashboard's own record). A bot on no dashboard gets none. A dashboard's lead (the only bot the user talks to there) gets `create_goal`, `add_task`, `list_tasks` and `read_task`: it starts the goal and hands its tasks to the team with `team_ask_bot`, and the asked bot's run is recorded under that goal. Only the team's bots claim tasks and write done records. Built-in instructions say so (lead: start a goal for work worth tracking; team bots: claim a named task and finish with `write_done`).
- [x] AC2: A bot sees only its own dashboard's goals.
- [x] AC3: `write_done` needs the task claimed by that bot. Each record is labelled "said by the bot" until a check re-verifies it (phase 2).
- [x] AC4: A bot that missed an event finds work by status (`list_tasks status:"built"`) on its next run.

### GOAL-003: Everything carries the goal id (P0)

- [x] AC1: A run that creates a goal or claims a task records `goalId` and `taskId` on its run record.
- [x] AC2: The events the run sends carry `goalId`/`taskId`, and a run started by such an event inherits them.

### GOAL-004: The Goals tab (P0)

- [x] AC1: Dashboard | Bots | Goals switch; Goals shows a count of goals waiting for you.
- [x] AC2: One row per goal: status, title, when it last moved, where it came from, what happened last, a pill per task in its status colour, and the round. Filters: All, Needs you, Working, Done.
- [x] AC3: A goal opens beside the list: where it came from, how many runs, each task with its done records (who, passed/failed, summary, evidence, "said by the bot").
- [x] AC4: A task that stopped shows its rounds with Give it one more round and Close this task. A ready task has Mark done.
- [x] AC5: Close the goal; Delete goal (confirmed) removes its tasks, runs, evidence and work files. A goal a bot is working on can't be deleted until that run ends.

### GOAL-005: Deleting (P0)

- [x] AC1: Deleting a conversation that started goals says so ("Delete this conversation and its goal?"), lists what's removed and what stays, and deletes them together. Refused while a bot is working on one of them.
- [x] AC2: Deleting a dashboard deletes its goals; the confirmation says how many.

## Out of Scope (later phases)

- Check steps and re-verified evidence (phase 2); "Builder said / Dash checked" (frame 3).
- Declared step outputs (phase 3); flows, the Graph tab and steps as pills (phase 4).
- "New goal" and acceptance criteria (phase 6); "Change what done means" and "Take it over in a conversation" on a stopped goal.
- A task-board widget reading the ledger.

## Implementation Notes

- **Main process:** `electron/goals/taskStatus.js` (pure moves), `goalStore.js` (folders, sealing, claims), `goalTools.js` (bot tools, server `bot-goals`), `controller/goalController.js` (store + IPC + `goals:changed` broadcast; runs found and removed through `BotStore.runsForGoal` / `removeRunsForGoal`, handed in by botController).
- **botController:** goal tools in `_resolveTools` for bots with a `workspaceId`; `GOALS_SERVER` in the gate's internal servers; `_callTool` routes to `handleGoalTool`. `_run` makes one goal holder per run and puts it on the run's cause, so `BotRunner` writes it on the run record and `BotEventPublisher` on its events (`buildBotEventMessage` → `causeFromEvent`). A run that started releases its claims when it ends. `onWorkspaceDeleted` → `goalController.forgetWorkspace`. `removeCreateRecent(id, { deleteGoals })`.
- **IPC:** `goals-list`, `goals-get`, `goals-for-conversation`, `goals-task-action`, `goals-close`, `goals-delete`; broadcast `goals:changed`. Handlers in dash-electron `public/electron.js`.
- **Renderer:** `src/Components/Goals/` (GoalsView, GoalRow, GoalDetail, goalText), `src/hooks/useGoals.js`, `src/__mocks__/mockGoalsApi.js`; DashboardHeader/DashboardStage (tab), RecentsList/LeadWorkspace (conversation delete), DashboardsPage (dashboard delete note).
- **After review:**
  - No run survives a restart, so on load every held task is let go (claimed → new).
  - A folder left without `goal.json` (a deleted goal re-made by a run still writing) is removed on load.
  - A run still working on a goal that gets deleted drops the goal's id (`forget`), so its record and events don't bring the goal back.
  - Deleting a bot lets go of the tasks it held.
  - A closed goal's tasks take no more moves.
  - Every change event names its dashboard, so other dashboards don't reload.
  - A goal's runs come over IPC slim: no answers or prompts.
  - The conversation delete waits for its goal lookup.
  - Delete reports a folder that couldn't be removed instead of half deleting.
- **Known limit:** a run that works on one goal and then starts another is recorded under the last one only.
- **Tests:** `electron/goals/*.test.js`, `electron/controller/goalController.test.js` (in `scripts/ci.sh`), `src/Components/Goals/*.test.js`, LeadWorkspace delete test.

## Jobs: one chain of work through a lead (DASH-28, DASH-31)

**Status:** Implemented 2026-11-21 — part 1 (tracking, MCP; core 0.1.945, app v0.0.1125) and part 2 (the Jobs page, the strip, the opt-in clear). Mockup: claude.ai artifact Rkz38aQKw6La19LVpoaZtw (approved 2026-11-21).

**Problem.** A job used to exist only for a bot with checks. A bot without checks handed its answer straight to the next bot, and nothing showed that the chain ran or finished. `give_task` was "done" when the lead answered, while bots it had set off were still working.

**What a job is.** Anything that goes through a team lead: you asking a lead in Dash, or a task given over MCP. The job follows the whole chain — the lead's run, the bots it asks, their checks, and every hand-on they set off — and ends only when none is still going. Runs outside a lead's chain (schedules, widget events, bots on no dashboard) make no job; they stay in each bot's Activity.

- [x] AC1: A lead's run starts a job (not a Dash team role's, nor a routing run with no tools). A bot it asks, a hand-on from that bot's events, and a check's retry or reviewer join the same job: the job's id rides the run's cause and its bus events.
- [x] AC2: Each run is a step: bot, status (queued, running, checking, needs-you, done, failed, stopped, skipped), why it started (the task or you; asked by the lead; started by a bot's event), times, and what it said. A bot's checks are a stage of its step, not a step of their own.
- [x] AC3: The job is running while any step is queued, running or being checked, and for a moment after the last one ends (hand-ons start a tick later). A hand-on waiting on a paused bot makes it **needs you**; turning the bot on starts that step. Then it's done, failed or stopped.
- [x] AC4: A hand-on that doesn't start says why in the job: its bot is busy, ran moments ago, or skips events while paused.
- [x] AC5: `give_task` makes its job before the lead starts, and the task stays `running` until the job ends; `get_task_status` lists the steps and what's still going. A job that fails fails the task, naming the bot. A lead that never started stops its job.
- [x] AC6: A lead asking a bot that a hand-on in the same job already started waits for that run's answer instead of hearing "busy".
- [x] AC7: Jobs are kept on the user's computer until the user deletes them; nothing is deleted on its own. After a restart, what was still going is stopped and says Dash closed.
- [x] AC8 (part 2): A Jobs page in the left nav, across every dashboard, with how many are running (amber when one needs you); status and dashboard filters; a job's timeline with Turn on, See checks, Open conversation, Stop job and Delete. The strip under a lead's answer follows its job and opens it. A dashboard's Jobs tab shows its jobs and the checked runs that aren't part of one. Settings › General › Jobs: "Delete finished jobs after 90 days", off unless turned on.

**Implementation notes (part 2).**
- `src/Components/Jobs/` (jobText; JobsPage with JobRow and JobDetail; JobStrip) and `src/hooks/useJobs.js` (useJobs with open, limit and skip; useJobCounts; useJob).
- The `jobs` nav item in appPages, its count colour through DashSidebar's `pageTone`; DashboardStage's counts and the `dash:open-page {page: "jobs", jobId}` link (it closes the lead's conversation).
- GoalsView lists the dashboard's jobs and hides checks jobs that are a stage of one (See checks still opens them).
- GeneralSection's Jobs group; backend `listJobs` light rows, the `clearOldJobs` setting, `jobTracker.clearEndedBefore`, a step's `waiting` (paused or budget).
- Checked live: asked a lead in its conversation; the strip ran to Done; See the job opened it on the Jobs page; the dashboard's Jobs tab listed it.

**Implementation notes (part 1).**
- `electron/jobs/jobStore.js` (one sealed file per job under `userData/jobs`), `jobTracker.js` (start, steps, settle, wait for the end, restart cleanup).
- botController `_run` starts or joins the job and ends its step (also on a rejected run); `handleEvent` / `_holdEvent` say a hand-on that didn't start or waits on the user; the checks job's `patchRun` moves the step's checks stage; `_leadAskBotRun` passes the lead's job and waits on a run already going in it (`_runsInProgress`). `causeFromEvent` / `buildBotEventMessage` carry `jobId`.
- MCP: `teamTools.startTask` (`startTaskJob`, `waitForJob`, `abandonJob`), `get_task_status` (`jobId`, `steps`), `mcpTasks.running(id, { jobId })`.
- IPC: `bots-list-jobs`, `bots-get-job`, `bots-stop-job`, `bots-delete-job`; broadcast `bot-jobs-changed`. Handlers in dash-electron `public/electron.js`.
- Tests: `electron/jobs/jobTracker.test.js`, `jobWiring.test.js` (the real `_run`), `electron/mcp/teamTasks.test.js`. Checked live: a real lead asked a Designer whose Completed event started a Drafter; one job followed all three and ended done after the Drafter.

## Revision History

| Date | Change |
|---|---|
| 2026-11-16 | Created for DASH-2 (phase 1). |
| 2026-11-21 | Jobs as chains through a lead (DASH-28, DASH-31), part 1. |
| 2026-11-21 | Part 2: the Jobs page, the strip, the opt-in clear (DASH-31). |
