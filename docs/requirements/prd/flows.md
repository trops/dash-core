# PRD: Flows — Checks, Step Outputs, the Graph, Real Work, Criteria, Sharing

**Status:** In Progress — being replaced by [bot-checks.md](./bot-checks.md): checks move onto the bots themselves
**Last Updated:** 2026-11-17
**Owner:** John Giatropoulos
**Tickets:** DASH-3 (phase 2), DASH-4 (3), DASH-5 (4), DASH-6 (5), DASH-7 (6), DASH-8 (7) — epic DASH-1, "Loops and graphs: bots that finish work without you"
**Location:** dash-core (engine, checks, IPC, Graph tab, Goals updates), dash-react (FlowGraph, DiffView), dash-registry (flow package type), dash-electron (IPC registration)
**Related PRDs:** [goals-ledger.md](./goals-ledger.md) (phase 1), [bot-teams.md](./bot-teams.md)

Architecture PRD, use cases and mockups: "Loops and graphs in Dash" (claude.ai artifact FDGmPi9ckYeEBL5CQkFegr), Build plan › Phases 2–7; mockup frames 3, 5–7, 9–36 on the design canvas page "Goals and graph (proposed)".

---

## Executive Summary

A **flow** is the steps a piece of work goes through on a dashboard: a source that starts goals, AI steps that do the work, **checks with no AI** that prove it, and **you** where a person must approve. Each goal follows one flow and keeps its own copy of it, so a flow that changes later never changes the rules halfway. Work moves by status on the goals ledger — no lead has to be running, and a check sending work back is a status change, never a bot calling another bot again. The dashboard gets a **Graph** tab; the Goals tab learns flows, criteria and "New goal"; flows publish to and install from the registry.

## Problem Statement

Phase 1 gave the ledger, but every step was still an AI's word: nothing re-checked a "passed", results had no shape, a reviewer couldn't send work back without tripping the event chain, the widget pipeline's plan → build → check loop couldn't be reused, nothing ran unattended without a lead, bots couldn't work in a real repo safely, and none of it could be shared.

## User Stories

### FLOW-001 (phase 2): Checks with no AI (P0)
- [x] AC1: Four kinds: **rules** (ready-made: has a value, length, short enough, no banned words, all links work, every item used, matches, totals add up to the cent, nothing used twice), **command** (input as JSON on stdin and in `$DASH_INPUT`; exit 0 passes, or output contains/matches; a `{"reason","details"}` last line is the proof; time limit; always-blocked commands never run), **script** (sealed: own process, Node's permission model — no files, processes or workers — network modules taken away, code generation off, 64 MB, time limit), **tool call** (one read-only tool, inputs from the record, rules on the answer).
- [x] AC2: A check writes a done record "said by Dash" with `{pass, reason, details}` as proof; the bot's own record stays "said by the bot".
- [x] AC3: A fail with rounds left sends the work back along the check's fail edge with the reason as the fix list; at the limit the task waits for you ("stopped").
- [x] AC4: Every check can be tried on the last real record before it's saved.

### FLOW-002 (phase 3): What goes in and comes out of a step (P0)
- [x] AC1: Every step gets one standard input `{goal, input, from, files, fix?}`.
- [x] AC2: A step can declare output fields (name, kind, required); `write_done` with a passed status is refused while a required field is missing or the wrong kind — the bot is told what, in the same run.
- [x] AC3: Fields are suggested from a step's last runs; removing a field another step uses names that step first.

### FLOW-003 (phase 4): Flows and the Graph tab (P0)
- [x] AC1: A dashboard can have several flows (`userData/flows/<id>/flow.json`); each goal follows one, keeping its own copy (with version).
- [x] AC2: The flow runner moves work on by status — on ledger changes and a 20s tick: a bot step's bot is started with its input and told to claim and write a done record; a check step is run by Dash; a you step waits. A bot that ends twice without a record leaves the task for you; a paused bot is waited for.
- [x] AC3: A source bot's `create_goal` starts goals in its flow (with what it read as the first record); a ticket already in the flow isn't started twice.
- [x] AC4: Graph tab: the flow switcher, the graph (FlowGraph), where goals are now, a step opened beside it, + on every arrow (a check, a bot, you approve), setup warnings with fixes, a simple graph for a dashboard with no flows, New flow from starters (Ticket to PR; Draft, check, send; Daily brief; Blank) or the dashboard lead's proposal, "Make this flow" with Undo.

### FLOW-004 (phase 5): Real work on your files (P0)
- [x] AC1: A bot's folders (`projects`); in a flow, each task works in its own git worktree of the first folder, on `dash/<goal>`, inside the goal's work folder; a non-repo folder is worked in where it is. Deleting the goal prunes the worktree.
- [x] AC2: Shell commands: always blocked (force push, reset --hard, rm -rf, pushing to the main branch, publishing) — even under "allow" — plus the bot's own allowed list (runs without asking) and blocked list.
- [x] AC3: Limits per task (minutes, steps across its runs); over one, the task waits for you.

### FLOW-005 (phase 6): Criteria and the flow folder (P0)
- [x] AC1: Each flow has `scripts/`, `checks/`, `data/`; files copy in from this computer; a check can point to a file only on this computer (left out of publishing, shown as missing elsewhere).
- [x] AC2: New goal (Goals tab): a flow, a title, criteria each with how it's proven (test, a check, the Reviewer · judgment, you); vague ones flagged with a measurable rewrite; it can't start while one has no way to be proven.
- [x] AC3: A ticket's criteria come in with the goal; any that can't be proven hold it in Needs you (rewrite, leave out, I'll decide, Start goal).
- [x] AC4: A stopped goal offers one more round, change what done means, take it over in a conversation, close.

### FLOW-006 (phase 7): Publish, install, update (P0)
- [x] AC1: Registry `flow` package type (dash-registry 1.11.0): a validated summary (steps, bots, checks, files, needs); dashboards may list the flows they need by version range.
- [x] AC2: Publish: name, version (fix / new feature / big change), what's new, what's in it, what it needs, what's left out (goals, memory, keys, folder paths, local-only files), and the checks first; a key or token in a file stops it.
- [x] AC3: Install: the dashboard, providers matched by type, the folder, and each script read before Install turns on; bots arrive on Ask.
- [x] AC4: Update: what changes, changed scripts line by line (approved again), your own changes kept or replaced, running goals finish on their version, skip this version.

## Out of Scope

- Writing back to each source (G8), webhooks (G11), the cross-dashboard watcher (UC7), moving the widget pipeline onto flows (rest of G7).
- "Suggest criteria" with AI and "Ask on the ticket" (frames 29–30): left for later.

## Implementation Notes

- **Main process:** `electron/flows/` — `flowModel` (shape, chain, insert/remove), `flowMoves` (where a task goes), `flowStore` (folders, versions, files), `flowRunner` (moves work on), `flowWarnings`, `starterFlows`, `proposals`, `workFolder`, `flowPackage`, `flowShare`, `flowBotHooks`, `flowHandlers` (one IPC map). `electron/checks/` — `stepInput`, `checkRunner`, `commandRules`, `linkStatus`, `kinds/{rules,command,script,sealedRunner,toolCall}`. `electron/goals/criteria.js`. `controller/flowController.js`.
- **Ledger:** `goalStore` keeps a flow's copy on the goal, a task's `stepId`/`retryStepId`, records' `stepId`/`output`/`details`; `writeStepRecord` for Dash's records; `findBySource`, `startGoal`, `setCriteria` (before start, or while stopped).
- **Leads:** a dashboard lead keeps its team tools plus `create_goal`/`add_task`/`list_tasks`/`read_task`; its asks carry the goal.
- **Sealed scripts:** `--permission` on Node ≥ 22.13 (Electron), `--experimental-permission` on Node 20 (CI). The runner is copied next to the bundle (`dist/checks/`) and out to a temp folder at run time (real path — macOS `/var` is a symlink).
- **Renderer:** `src/Components/Flows/` (GraphView, FlowSwitcher, SidePanel, StepPanel, CheckPanel, WhatItGets, FieldsPanel, WarningsPanel, AddStepMenu, NewFlowModal, ProposalCard, SimpleGraph, Publish/Install/UpdateFlowModal, flowText), `src/Components/Goals/` (FlowGoalDetail, CriteriaEditor, NewGoalModal), `src/hooks/useFlows.js`; header Graph option + stage button; bot Settings: folders and shell commands.
- **Classes:** only ones in the prebuilt CSS (no `p-2.5`, `pt-1.5`, `col-span-1/4/8`, violet rings).
- **Tests:** `electron/flows/*.test.js`, `electron/checks/**/*.test.js`, `electron/goals/criteria.test.js`, engine command tests; renderer `src/Components/Flows/*.test.js`, `FlowGoalDetail.test.js`; dash-react `FlowGraph.test.js`, `DiffView.test.js`; registry `validate.test.ts`, `packageTypes.test.ts`.

## Revision History

| Date | Change |
|---|---|
| 2026-11-16 | Created for DASH-3..DASH-8 (phases 2–7). |
| 2026-11-17 | Flows as a separate track are being replaced by checks on each bot (bot-checks.md, DASH-9); the runner, checks and ledger here carry on underneath. |
