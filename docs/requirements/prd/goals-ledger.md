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

## Revision History

| Date | Change |
|---|---|
| 2026-11-16 | Created for DASH-2 (phase 1). |
