# PRD: Test a Bot — See What It Returns Before You Rely on It

**Status:** In Progress
**Last Updated:** 2026-11-18
**Owner:** John Giatropoulos
**Tickets:** DASH-15 (PR A: Test and the sample), DASH-17 (PR A2: Ask AI ends with a test; untested bots wait in Recent), DASH-16 (PR B: checks from the sample) — epic DASH-14, "Test a bot before you rely on it"
**Location:** dash-core (engine, store, bot form), dash-electron (the `bots-test` handler, dependency bump)
**Related PRDs:** [bot-checks.md](./bot-checks.md) (checks are written against the sample), [bot-factory.md](./bot-factory.md)

Mockup: "Test a bot" (claude.ai artifact 28rYaPJ7vmAPem8EAxWj6Y) — frame A1 (the bot form with Test and what came back), A2 (while it tests, a tool that asks first, a plain-text answer, a test that didn't finish), B1 (checks from the sample), B2 (Write it with AI: a script or a command), C1 (Ask AI ends with a test, then Save), C2 (no bot until a test finishes: it waits in Recent).

---

## Executive Summary

A **Test** button in the bot form runs the bot once, as the form stands — unsaved changes, or a bot never saved — and shows exactly what it returned: its answer, whether it's plain text or JSON and the JSON's fields, and each result it would have sent with its items' fields. Nothing is handed on. The last good test is kept as the bot's **sample**, and its checks are then written against it (PR B): suggested checks from its shape, trying a check on the sample, and Write it with AI for script and command checks, against the real format.

## Problem Statement

Today a bot is created, then run for real to find out what it answers — and that run hands its work on (events, results to widgets, its next bots, a checks job). Writing a check needs the answer's format, which the user has to guess. A test before saving shows the format first, and doesn't touch anything.

## User Stories

### TST-001 (PR A, DASH-15): Test from the form, keep the sample (P0)

- [x] AC1: The bot form (new and saved bots, not leads or Dash team roles) has **Test** next to Create/Save and a "Test it with (optional)" field (else what it's asked on its schedule). It runs the form's definition as it stands, once.
- [x] AC2: Test mode: tools run as in a real run and the bot's approval prompts appear in the test (Allow once / Deny; a test's Always allow isn't kept). Nothing is handed on: no completed/failed/tool events, `send_result` is checked and kept for the form (never saved or sent), no checks job, no job tools, no run record, no session, and memory is read but never changed. A bot paused on its own is still tested; Pause all, or a used-up budget (the saved bot's, its dashboard's or the global one), stops it, before it starts or at the gate. Its cost counts toward the saved bot it tests, else toward its dashboard and the totals. A test isn't listed as a bot running (quit dialog, tray); closing its window stops it.
- [x] AC3: While it tests: a spinner, what it's doing, its answer as it's written, and Stop.
- [x] AC4: When done: "Tested", how long and how many tools; its answer (pretty JSON, or Show as text) with its shape (each field, its kind, a list's count, a number's range, a field only in some items); the results it would have sent (name, item count, the items' fields, Show items). A plain-text answer says how to get fields (ask for JSON). A test that didn't finish says why, with Test again.
- [x] AC5: A completed test is the bot's **sample** (answer, results, their shape, when, what it was asked; the shape from the whole answer, before the 32 KB cut): kept at once for a saved bot with no unsaved changes; a new bot's goes with Create, a changed saved bot's with Save (so a discarded edit doesn't replace it). A later test that doesn't finish keeps the last good sample. Kept apart from the definition (never in a profile or package), sealed at rest, removed with the bot.
- [x] AC6: A new bot is created only once a test of the form as it stands finishes ("Test it first: Create turns on once a test finishes."; an edit after the test: "Changed since its test"). A saved bot can still be saved after an edit; it says "Changed since its last test." until tested again.

### TST-003 (PR A2, DASH-17): No bot until a test finishes (P0)

- [ ] AC1: Ask AI's bot build stops at a Test step before saving (frame C1): the test in the right-hand panel, then Change something, Test again, Save the bot (only after a test finishes; keeps it as the sample). The after-save "Run <bot> now" goes away.
- [ ] AC2: A test that can't finish says why with the next step (e.g. Set up <provider>); nothing is saved.
- [ ] AC3: An untested bot waits in Recent › Unfinished (frame C2): an Ask AI build, or a bot form closed before it was tested; opening one returns to its test or form as left.

### TST-002 (PR B, DASH-16): Checks from the sample (P0)

- [ ] AC1: The checks window shows the sample and its shape, with Test again.
- [ ] AC2: Suggested checks from the sample's shape, each saying whether the sample passes it now.
- [ ] AC3: Try it on the sample: any check runs on the stored sample only (the bot doesn't run, nothing is sent); passed/failed with its reason.
- [ ] AC4: Checks can read a JSON answer's fields (`input.answer` parsed; the text stays readable).
- [ ] AC5: Write it with AI for script and command checks, from what the user asks and the sample; then Try it.

## Out of Scope

- Testing a lead or a Dash team role (they're asked in their conversation).
- A test that resumes the bot's session or reads its private memory: a test starts fresh and its private memory is its own; team and dashboard memory are read, never changed.

## Implementation Notes

- **Engine:** `BotRunner.run(id, { bot, test: true, chargeTo })` runs the given definition; a test saves no session or record and returns the answer from its start (`answer`, cut at 32 KB, `answerCut`). Usage counts toward the saved bot it tests (`chargeTo`); a bot never saved has no budget.
- **Controller:** `botController.test(definition, { testId, prompt })` runs under a form-picked id (`test-…`) kept in `_testBots` while it runs; `startBlocker`, the gate's `isPaused`, `_resolveTools` (no goal tools), `_callTool` (results kept by `_keepTestResult`, goal tools refused, no `tool.*` events), `approve` (no grant) and `_botName` ("<name> (test)" in the audit log) check it. It doesn't go through `_run`, so no events, checks job, issues or notices. A saved bot is tested in its own folder; a new one in a temporary folder, removed after. Its private memory is forgotten after.
- **Shape:** `electron/bots/answerShape.js` (pure): an answer is JSON when it all parses as an object or list, or has exactly one ```json block.
- **Sample:** `BotStore.setSample/getSample`, sealed like results; `save()` takes a `sample` off the definition and keeps it.
- **IPC:** `bots-test` (`mainApi.bots.test(definition, { testId, prompt })`); events stream on `bot-stream` under the test id; Stop is `bots.stop(testId)`. The handler is in dash-electron `public/electron.js`.
- **UI:** `useBotTest` (state and stream), `TestResult` (frames A1/A2), `testResultText` (words); approvals reuse `DashTeamApprovals` (`allowAlways={false}`, a test's note).

## Revision History

| Date       | Change                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-18 | Created; TST-001 (PR A, DASH-15) built.                                                                                                                   |
| 2026-11-18 | Review fixes (budgets, long JSON shape, a changed bot's sample, tests not "running", memory read-only); AC6 Create after a test; TST-003 (DASH-17) added. |
