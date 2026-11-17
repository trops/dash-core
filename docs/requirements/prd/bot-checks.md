# PRD: Bot Checks — A Bot's Work Is Checked Before It's Handed On

**Status:** In Progress
**Last Updated:** 2026-11-17
**Owner:** John Giatropoulos
**Tickets:** DASH-9 (PR 1: the gate) — epic DASH-1, "Loops and graphs: bots that finish work without you"
**Location:** dash-core (engine, ledger, Bots tab, Jobs), dash-electron (dependency bump)
**Related PRDs:** [flows.md](./flows.md) (the checks, rounds and ledger this reuses), [goals-ledger.md](./goals-ledger.md), [bot-teams.md](./bot-teams.md)

Mockups: "Checks on the lines" (claude.ai artifact 5QuvX7byv8JTfE9s4H6QRN) — frame 1B (the Bots tab: a list of checks after each bot), frame 2 (a bot's checks as a timeline), frame 3 (the lead conversation), frame 4 (a job as a pull-request-style timeline), frame 5 (what stays the same).

---

## Executive Summary

Checks belong to a bot. Every time it runs — on its schedule, when its lead asks, when you ask — its finished work is held while its checks run, top to bottom: rules, a command, a script or a read-only tool (no AI), a reviewer bot, and you. A fail goes back to the bot with what failed (up to its tries, then to you), or straight to you, or stops it. Only work that passed is handed on: its next bots run, its widgets show it, its lead gets the answer. Each held run is a **job** on the dashboard's ledger.

This replaces flows as a separate track. The bot connections are the graph; checks sit between a bot and whatever comes next, and a bot can have checks with nothing after it (they prove its own work is done).

## Problem Statement

Flows (flows.md) were a separate track: work had to be put into a flow to be checked, and the lead talking to the same bots skipped every check. The user's own model: the lead and the bots work as they do, and the checks sit on what each bot hands on, so all work is checked however it started.

## User Stories

### CHK-001 (PR 1, DASH-9): The gate (P0)
- [x] AC1: A bot's `checks`: `{ steps: [check | reviewer | you], onFail: retry | you | stop, maxTries (1–10, default 3), handsOn: answer | summary | files }` (files hands on the answer until the Bots tab can name them, PR 2); validated with the bot; none → its work goes straight on, exactly as before.
- [x] AC2: A bot with checks that finishes a run (not failed or stopped) holds its work: no `completed` event, results it sent are kept (not saved as its latest, not sent), and a job is made on its dashboard's ledger, following a flow made from its checks (`botChecks.checksFlow`), already past the bot's own step with its answer as the first record.
- [x] AC3: The flow runner runs the checks; a fail with tries left runs the bot again with what it was asked, its last answer and what failed ("Fix that, then answer again in full."); Dash records its new answer for it (said by the bot). Past its tries, or with `onFail: "you"`, the job waits for the user; `onFail: "stop"` closes it.
- [x] AC4: A reviewer step is another bot judging the work (pass/fail with a fix list); a check after it reads the work, not the verdict. Its run isn't handed on or shown as its answer.
- [x] AC5: A you step waits in Jobs: Approve, or Send back with a reason (the bot answers again with it).
- [x] AC6: A job that passes hands its work on under the cause of the run that made it (so the chain's limits still count it): the held results (saved as the latest), then `completed` with the answer (or its first paragraph, `handsOn: "summary"`). One that stops hands nothing on.
- [x] AC7: The lead's ask waits for the job within its wait: it gets the checked answer, or hears that the work is being checked, waiting for the user's approval, waiting after a failed check, or stopped — with the job's name in Jobs.
- [x] AC8: Run records carry `checks: { goalId, state }` (checking, passed, replaced, stopped, review); the Bot results widget and the bot's last answers show only work that passed, with "New work being checked" while newer work is held.

### CHK-002 (PR 2): The Bots tab (P0)
- [ ] AC1: Frame 1B: a list card of checks after each bot (colour and icon by kind: blue rule/compare, teal command, amber reviewer, purple you), "+ Add checks" after a bot with none.
- [ ] AC2: Frame 2: clicking the card opens the bot's checks as a timeline: + between steps, the selected check in a side panel (name, kind, settings, if it fails, tries), "Hands on <what> to <bots/widgets>" (edits the bot's existing connections).

### CHK-003 (PR 3): Jobs and the lead conversation (P0)
- [ ] AC1: Frame 4: a job as a timeline (the waiting row shows the work being approved — the live test found the Approve card empty for a bot's job) — who asked, each try, each check's result and reason, Approve / Send back on the waiting row, where it goes next.
- [ ] AC2: Frame 3: the check results show in the lead's answer, with a link to the job.

### CHK-004 (PR 4): Flows retired (P1)
- [ ] AC1: The Flows tab goes; a saved flow with checks or approval steps is offered once as "Move onto my bots"; others are retired; jobs already in an old flow finish the old way.

## Out of Scope

- Different checks per outgoing line (checks are per bot for now).
- Webhooks, writing back to sources, the cross-dashboard watcher (flows.md).

## Implementation Notes

- **Main process:** `electron/bots/botChecks.js` (pure: clean/validate, `checksFlow`, job title/source, `retryPrompt`, `handedOn`), `electron/bots/checkJobs.js` (`afterRun`, `onChange`, `waitFor`, `stateOf`, `holdsRun`). `botController._run` starts the publisher with `hold` and, when a run ends, asks `checkJobs.afterRun` before publishing; `goalController.onChange` → `checkJobs.onChange`; `_leadAskBot` waits on the job. `BotEventPublisher`: `startRun(…, { hold })`, `holdRun`, `release`, `holding`, `saveResult` dep. `resultTools.sendResult` doesn't save a held result. `BotStore.patchRun`. `lastAnswers` skips held work. `teamTools.checkedAnswer`.
- **Ledger and runner:** `goalStore.createGoal({ startAfter })` (the task starts after a step already done, with its record), `writeStepRecord({ bot })` (a bot's answer recorded by Dash, said by the bot), `flowSnapshot` keeps `kind`, `botId`, `onFail`, `handsOn`. `flowRunner` runs a job's work step with `retryPrompt` and in the bot's own folder (no worktree). `flowModel.inputStep` skips reviewer steps.
- **Renderer:** `useTeamBots.lastShownRun` (runs read back: 10), reloads on the `checked` stream event; Bot results shows "New work being checked".
- **Decisions (after review):** a stopped run of a bot with checks hands nothing on, results included (it was never checked); a failed run goes out as before. A try that passes replaces the results of the tries before it. A reviewer needs a bot, never the bot itself. A bot with checks used as a step in a flow publishes as it always did. Command and script checks run in the bot's first folder. A job already handed on is never handed on again (its run is marked passed). A deleted job marks its first run stopped. A flow's own reviewer is still the input of the step after it; only in a bot's checks does the work pass through the reviewer.
- **Live test (2026-11-17, real bot, throwaway profile, 16 of 16):** a bot that ended with "banana" was held as a job; the "No bananas" rule failed; the bot answered again, told what failed, without it; the job waited for approval with nothing handed on and Bot results saying new work is being checked; Approve sent the checked answer out once and the widget showed it. A paused bot's job waits until it is resumed (a manual run of a paused bot still runs; its retries don't).
- **Known limits:** held work lives in memory: after a restart, a job that passes goes on without the results its first run sent, under a fresh cause. A run's `done` stream event can reach a view just before its run is marked held; the `checked` event that follows corrects it.
- **Tests:** `electron/bots/botChecks.test.js`, `electron/bots/checkJobs.test.js` (end to end through the real ledger, runner, checks and publisher), `src/Components/Bots/lastShownRun.test.js`.

## Revision History

| Date | Change |
|---|---|
| 2026-11-17 | Created for DASH-9 (PR 1, the gate). |
