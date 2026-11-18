# PRD: Bot Checks — A Bot's Work Is Checked Before It's Handed On

**Status:** In Progress
**Last Updated:** 2026-11-18
**Owner:** John Giatropoulos
**Tickets:** DASH-9 (PR 1: the gate), DASH-10 (PR 2: the Bots tab), DASH-11 (PR 3: Jobs and the lead conversation), DASH-12 (PR 4a: checks inside the bot box), DASH-13 (PR 4b: flows retired) — epic DASH-1, "Loops and graphs: bots that finish work without you"
**Location:** dash-core (engine, ledger, Bots tab, Jobs), dash-electron (dependency bump)
**Related PRDs:** [flows.md](./flows.md) (removed in PR 4b; the runner, rounds and ledger it built now run a bot's checks), [goals-ledger.md](./goals-ledger.md), [bot-teams.md](./bot-teams.md)

Mockups: "Checks on the lines" (claude.ai artifact 5QuvX7byv8JTfE9s4H6QRN) — frame 1B (the Bots tab: a list of checks after each bot), frame 2 (a bot's checks as a timeline), frame 3 (the lead conversation), frame 4 (a job as a pull-request-style timeline), frame 5 (what stays the same). "Bot box with checks" (claude.ai artifact GK36mz8V7mpmaQxfCVRuY3) — frame 1 (the diagram), 2 (every state of a box), 2b (while it works), 3 (flows retired).

---

## Executive Summary

Checks belong to a bot. Every time it runs — on its schedule, when its lead asks, when you ask — its finished work is held while its checks run, top to bottom: rules, a command, a script or a read-only tool (no AI), a reviewer bot, and you. A fail goes back to the bot with what failed (up to its tries, then to you), or straight to you, or stops it. Only work that passed is handed on: its next bots run, its widgets show it, its lead gets the answer. Each held run is a **job** on the dashboard's ledger.

This replaces flows as a separate track. The bot connections are the graph; checks sit between a bot and whatever comes next, and a bot can have checks with nothing after it (they prove its own work is done).

## Problem Statement

Flows (flows.md) were a separate track: work had to be put into a flow to be checked, and the lead talking to the same bots skipped every check. The user's own model: the lead and the bots work as they do, and the checks sit on what each bot hands on, so all work is checked however it started.

## User Stories

### CHK-001 (PR 1, DASH-9): The gate (P0)

- [x] AC1: A bot's `checks`: `{ steps: [check | reviewer | you], onFail: retry | you | stop, maxTries (1–10, default 3), handsOn: answer | summary | files }` (files hands on the answer until a bot can name its files: a later PR); validated with the bot; none → its work goes straight on, exactly as before.
- [x] AC2: A bot with checks that finishes a run (not failed or stopped) holds its work: no `completed` event, results it sent are kept (not saved as its latest, not sent), and a job is made on its dashboard's ledger, following a flow made from its checks (`botChecks.checksFlow`), already past the bot's own step with its answer as the first record.
- [x] AC3: The flow runner runs the checks; a fail with tries left runs the bot again with what it was asked, its last answer and what failed ("Fix that, then answer again in full."); Dash records its new answer for it (said by the bot). Past its tries the job fails (PR 4a, AC10 of CHK-005; it used to wait for the user); with `onFail: "you"` it waits for the user; `onFail: "stop"` fails it at once.
- [x] AC4: A reviewer step is another bot judging the work (pass/fail with a fix list); a check after it reads the work, not the verdict. Its run isn't handed on or shown as its answer.
- [x] AC5: A you step waits in Jobs: Approve, or Send back with a reason (the bot answers again with it).
- [x] AC6: A job that passes hands its work on under the cause of the run that made it (so the chain's limits still count it): the held results (saved as the latest), then `completed` with the answer (or its first paragraph, `handsOn: "summary"`). One that stops hands nothing on.
- [x] AC7: The lead's ask waits for the job within its wait: it gets the checked answer, or hears that the work is being checked, waiting for the user's approval, waiting after a failed check, or stopped — with the job's name in Jobs.
- [x] AC8: Run records carry `checks: { goalId, state }` (checking, passed, replaced, stopped, review); the Bot results widget and the bot's last answers show only work that passed, with "New work being checked" while newer work is held.

### CHK-002 (PR 2): The Bots tab (P0)

- [x] AC1: Frame 1B: a list card of checks after each bot (colour and icon by kind: blue rule/compare, teal command, amber reviewer, purple you), "+ Add checks" after a bot with none.
- [x] AC2: Frame 2: clicking the card opens the bot's checks as a timeline: + between steps, the selected check in a side panel (name, kind, settings, if it fails, tries), "Hands on <what> to <bots/widgets>" (edits the bot's existing connections).

### CHK-003 (PR 3): Jobs and the lead conversation (P0)

- [x] AC1: Frame 4: a job as a timeline (the waiting row shows the work being approved — the live test found the Approve card empty for a bot's job) — who asked, each try, each check's result and reason, Approve / Send back on the waiting row, where it goes next.
- [x] AC2: Frame 3: the check results show in the lead's answer, with a link to the job.

### CHK-005 (PR 4a, DASH-12): Checks inside the bot box (P0)

In use, the separate checks card read as another bot in the chain, lines left from it rather than the bot, and the bot's circle stayed hollow.

- [x] AC1: A bot and its checks are one box: its name and trigger on top, a divider, then its checks (up to 3 rows; 2 and "+N more" past 3); "Add checks" is a row in the box while the diagram can be changed. No separate card or arrow.
- [x] AC2: Every bot's box takes the height of the tallest, so rows and lines stay level; plain boxes when no bot shows checks. The lead keeps its own height.
- [x] AC3: Lines leave from the bot's box: across from its edge, down from the circle under its middle. The circle is filled once its work goes somewhere (a bot or a widget), hollow otherwise; shown (not draggable) while the diagram can't be changed.
- [x] AC4: What its checks are doing now: "Checking · try 1 of 3" with a spinner on the check being run (the others dimmed), "Sent back · try 2 of 3", "Checking 2 jobs", and "N needs you" in amber with an amber box (was a blue "N waiting" that didn't say who it waited on). No tick or cross after a run: the box is the bot, not one run; results are in Jobs.
- [x] AC5: A click opens the job that needs you, else the newest being worked on, in Jobs; with nothing happening, the checks window.
- [x] AC6 (found testing in the app): work sent back to a paused bot waits, and says so — the box "Paused · try 2 of 3 waits" (amber, nothing spins; Dash's own checks still run), the job "Waiting: <bot> is paused, so try 2 hasn't started" with Resume <bot> (Resume all bots when all are paused). It had spun on "trying again" for minutes.
- [x] AC7: the Jobs switch shows a grey count of jobs being worked on when none needs you (amber, as before, when one does).
- [x] AC8: the job's header counts the try in progress ("try 2 of 3" while the bot redoes its work; it said try 1).
- [x] AC9 (found testing in the app): a job already started finishes even when its bot is paused — its retries and a reviewer bot's check run like a run you start (`flowBotHooks.runBot` → `_asUserRun` for `flow:checks_*`). Pausing a bot only stops it starting work on its own; Pause all still stops everything (the waiting row of AC6 now shows only then). Try 2 had waited 40 minutes for a resume.
- [x] AC10: a job that runs out of tries fails — no "One more try": Dash closes it, nothing is handed on, and the bot's **`failed` event goes out** with why (`Didn't pass "<check>" on try 3: <reason>`), under the cause of the run that started it, so whatever listens for its failures runs (`BotEventPublisher.fail`, `checkJobs.failReason`). "It fails" (was "It stops") does the same at once; "It comes to you" waits, and your Close fails it too. The tries setting reads "3, then it fails"; the window says the Failed event goes out. A job that came to you offers "Send it back to <bot>" and "Close it (it fails)".
- [x] AC11: a finished job ends with the event it sent and who listens: "<bot>'s Failed event went out → Fixer runs on it", or "· nothing listens for it yet" (Completed likewise) — shown even with no listener, so you know it's there. Its badge reads **Failed** (red), and the list line "failed on try 3".

### CHK-004 (PR 4b, DASH-13): Flows removed (P1)

Scope changed 2026-11-18: the app has no users yet, so Flows go outright — no "Move onto my bots", no migration, no registry flow packages.

- [x] AC1: No Flows tab, and no New flow / Add a step / New job in the header. The flow editor, starters, proposals, flow publish and install, and their IPC are gone (`flowsApi` keeps only `writeScript`, `readOnlyTools` and `pickFolder`, which the checks window uses). Saved flows and old flow jobs no longer show or run: the runner runs only a bot's checks jobs.
- [x] AC2: `create_goal` has no `flow` argument; the lead can't propose or start flows. Plain goals (tasks the lead adds) stay.
- [x] AC3: The Jobs empty state says what a job is, with **Add checks to a bot** (opens the Bots tab).
- [x] AC4: A bot's Activity shows, under a run held for its checks, what they did — being checked, waiting for you, sent back, passed (and approved), a later try replaced it, failed (the check and the try), closed — with **Open the job** (`jobTimeline.runChecksLine`, from the run's `checks` mark and its job).
- [x] AC6: Old jobs that followed a flow are deleted once when the job runner starts (`flowController.dropOldFlowJobs`), and Jobs and its counts never list them (`goalText.shownGoals`). In Activity, a retry says Retry and a reviewer's run Review (they said Flow), and each held run says what happened to its own try ("Try 1 · didn't pass …: sent back").
- [x] AC5: In a failed job, the job card's pill for the check it failed on is red, and a job that was only closed shows grey — never the blue "running" (`flowText.stepPills` reads the step's own record, not the close after it).

## Out of Scope

- Different checks per outgoing line (checks are per bot for now).
- Webhooks, writing back to sources, the cross-dashboard watcher (flows.md).

## Implementation Notes

- **Main process:** `electron/bots/botChecks.js` (pure: clean/validate, `checksFlow`, job title/source, `retryPrompt`, `handedOn`), `electron/bots/checkJobs.js` (`afterRun`, `onChange`, `waitFor`, `stateOf`, `holdsRun`). `botController._run` starts the publisher with `hold` and, when a run ends, asks `checkJobs.afterRun` before publishing; `goalController.onChange` → `checkJobs.onChange`; `_leadAskBot` waits on the job. `BotEventPublisher`: `startRun(…, { hold })`, `holdRun`, `release`, `holding`, `saveResult` dep. `resultTools.sendResult` doesn't save a held result. `BotStore.patchRun`. `lastAnswers` skips held work. `teamTools.checkedAnswer`.
- **Ledger and runner:** `goalStore.createGoal({ startAfter })` (the task starts after a step already done, with its record), `writeStepRecord({ bot })` (a bot's answer recorded by Dash, said by the bot), `flowSnapshot` keeps `kind`, `botId`, `onFail`, `handsOn`. `flowRunner` runs a job's work step with `retryPrompt` and in the bot's own folder (no worktree). `flowModel.inputStep` skips reviewer steps.
- **Renderer:** `useTeamBots.lastShownRun` (runs read back: 10), reloads on the `checked` stream event; Bot results shows "New work being checked".
- **Bots tab (PR 2):** `TeamChart` gives each team bot a slot: the bot, a short arrow, and its `ChecksCard` (header "Checks · N", up to 3 rows — 2 and "+N more" past 3 — and "N waiting" from its open jobs). Lines across to the next bot leave from the checks card; right-to-left lines and lines to widgets leave from below it (`outX`). A bot with none gets "+ Add checks" only while the diagram can be changed (not while its Settings is open). `BotChecksModal` edits a draft (`checksView.js`: add / move / remove / change kind, `draftError`, `savedChecks` → null when empty) and saves `bots.save({ id, checks })`; hands-on changes go through the diagram's own saves (a completed trigger on the next bot; a Bot results widget's bot). Other widgets are connected by dragging, where their handler is picked. The per-kind editors moved to `Flows/CheckKindEditor.js`, shared with the Flows tab's check panel. `BotFlowSummary` lists the checks with Edit / Add checks.
- **After the PR 2 review:** the window saves the dashboard's widget changes in one save first (it can be refused while the dashboard is being edited — then nothing has changed), then the next bots' triggers, then the checks; the diagram reloads either way. "+ Add" offers only Bot results widgets showing no bot yet. A late answer (Write it with AI) lands on its own step by id. Room for checks is kept only when some bot shows a card; a line after "+ Add checks" leaves from its edge. Live test 18 of 18 in a throwaway profile (add, save, reopen, hands on × and + Add, Settings open).
- **Jobs and the lead (PR 3):** `Goals/jobTimeline.js` (pure) reads a bot's job into rows — asked, each try (its run's time and length), failed checks one by one with what happened next, passed checks together (a reviewer's words), your moves, it came to you, and where it is now with the work it hands on (`handedOnText`: the answer or its first paragraph). `Goals/BotJobDetail.js` shows them on a line, the waiting row with the work, Send back… (a reason) and Approve, and "Next: …" from the bot's hands-on targets (checksView). `GoalDetail` uses it for `flow.kind === "bot-checks"`; other flow jobs keep `FlowGoalDetail` until PR 4. The list line: `jobLine` ("Coordinator · the lead asked · waiting for you"), "Try N of M". The lead hears the same words, with `<job id="…"/>` at the end of the result (`teamTools.jobMarker`); `handoffSteps.withResult` keeps it as `step.jobId` and drops it from the words; `HandoffStep` shows `JobCheckCard` (each check on its try, `jobStateText`, Open in Jobs → `dash:open-job`, which DashboardStage turns into its Jobs tab on that job). "See its checks" in a job → `dash:open-bots-view` with `tab: "checks"` → the checks window.
- **After the PR 3 review:** the job marker sits after the fenced team data (a bot's words can't close the fence, so a bot can't point the card at another job); an error result has none. Where a failed check sent the work comes from its record (`to`), not the job's state now. With "It stops", Dash's close isn't shown as your move. Open in Jobs asks before leaving unsaved dashboard edits or bot settings, leaves edit mode, reads the latest state (a ref), and opens the job once. Links are dash-react buttons. A job's runs (`BotStore.runsForGoal`) now include its first run (marked with the job, not run for it), so each try shows its own length; a reviewer's runs are never taken for a try. Live test 15 of 15 (real bot, throwaway profile: both tries, the failed check, the work on the waiting row, Approve; asked through the lead: the card, Open in Jobs).
- **Checks inside the bot box (PR 4a):** `ChecksSection` (replaces `ChecksCard`) sits in the bot's box under its top part (`TOP_H` 80, as tall as a plain box: a two-line name and its trigger fit; the review caught 72 clipping them); `sectionHeight` sizes it, and `TeamChart` gives every member box the tallest (`boxH`), the lead its own 80 (`diagramLayout({ leadH })`), rows `ROW_H + boxH − 80` apart. Positions are plain `{ x, y, w }` again (no `botW` / `slotW` / `chkX` / `outX`); `routeWidgets` leaves from the middle. `checksView.liveChecks(goals, botId)` (replaces `waitingJobs`) reads each open bot job's last `jobTimeline` row: waiting / needs-you count, checking (the task's `stepId`, the try) or working (sent back), and the job a click opens; `BotsView` passes it as `liveFor` and opens jobs through `dash:open-job`. useGoals reloads on every goal change, so the box follows the job live. Live test of the engine changes 9 of 9 (throwaway profile, real bots: a paused writer with a check it can't pass made all 3 tries by itself, the job failed with nothing asked of you, its Failed event started a Fixer bot that was told the check and the reason, and the timeline showed it). The section's label reads its state out ("… — Sent back · try 2 of 3 — 1 needs you — open the job"). Live test 16 of 16 (throwaway profile, real bot: one box per bot at one height, filled / hollow circles, Add checks opens the window, Checking → Sent back → 1 needs you with an amber box, a click opens the job at Approve, back to the plain list after).
- **Decisions (PR 2):** what happens on a fail and the tries are the bot's (one setting for all its checks), shown under the list, not per check. Pass-rate stats ("passed 14 of the last 15") wait for PR 3 (job history); "Try it" on a bot's check is a follow-up.
- **Decisions (after review):** a stopped run of a bot with checks hands nothing on, results included (it was never checked); a failed run goes out as before. A try that passes replaces the results of the tries before it. A reviewer needs a bot, never the bot itself. A bot with checks used as a step in a flow publishes as it always did. Command and script checks run in the bot's first folder. A job already handed on is never handed on again (its run is marked passed). A deleted job marks its first run stopped. A flow's own reviewer is still the input of the step after it; only in a bot's checks does the work pass through the reviewer.
- **Live test (2026-11-17, real bot, throwaway profile, 16 of 16):** a bot that ended with "banana" was held as a job; the "No bananas" rule failed; the bot answered again, told what failed, without it; the job waited for approval with nothing handed on and Bot results saying new work is being checked; Approve sent the checked answer out once and the widget showed it. A paused bot's job waited until it was resumed (a manual run of a paused bot still ran; its retries didn't) — changed in PR 4a (AC9): a started job finishes.
- **Known limits:** held work lives in memory: after a restart, a job that passes goes on without the results its first run sent, under a fresh cause. A run's `done` stream event can reach a view just before its run is marked held; the `checked` event that follows corrects it.
- **Tests:** `src/Components/Bots/checksView.test.js`, `BotChecksModal.test.js`, TeamChart / diagramRouting / BotFlowSummary checks cases; `electron/bots/botChecks.test.js`, `electron/bots/checkJobs.test.js` (end to end through the real ledger, runner, checks and publisher), `src/Components/Bots/lastShownRun.test.js`.

## Revision History

| Date       | Change                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-11-17 | Created for DASH-9 (PR 1, the gate).                                                                                  |
| 2026-11-18 | CHK-004 done (DASH-13, PR 4b): Flows removed; Activity shows what a bot's checks did; the failed check's pill is red. |
| 2026-11-18 | CHK-005 done (DASH-12, PR 4a): a bot's checks inside its box, with what they're doing now.                            |
| 2026-11-18 | CHK-003 done (DASH-11, PR 3): a bot's job as a timeline in Jobs, and its checks in the lead conversation.             |
| 2026-11-17 | CHK-002 done (DASH-10, PR 2): checks card on the Bots diagram and the checks window.                                  |
