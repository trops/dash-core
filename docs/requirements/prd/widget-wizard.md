# PRD: Widget Wizard — Built Step by Step, Held to Every Choice

**Status:** In Progress
**Last Updated:** 2026-11-13
**Owner:** John Giatropoulos
**Location:** dash-core (wizard UI, plan build, checks); dash-electron (Builder tools)
**Related PRDs:** [lead-workspace.md](./lead-workspace.md), [team-dashboards.md](./team-dashboards.md), [mcp-providers.md](./mcp-providers.md)

Mockups: design canvas pages "Pick the provider", "Widget, step by step", "Wizard steps read like a chat", "A widget you already have goes through its own steps" (all approved, shipped through dash-core 0.1.908) and "The build is held to your choices" (approved 2026-11-13).

---

## Executive Summary

A new widget is planned part by part before anything is built — **Reads from · What it does · Talks to · Looks · Review & build** — and the user chooses each part. Every step is **checked before it's asked**, so only options the provider really has are offered, and the finished widget is **checked against every answer**: a mismatch goes back to the Builder by itself until it matches. The user only steps in when a choice can't be done as chosen ("end of the line").

## Problem Statement

Widgets were "one and done": the AI picked the provider, the actions and the look, and editing afterwards meant a rebuild. Once the wizard collected the user's choices, they were only *told* to the Builder and Checker — nothing held the code to them, so a widget could call a tool that changes things after the user chose "only reads", or drop a setting, and still pass on the Checker's word. And the wizard could offer things that couldn't work (a Planner-proposed tool the provider doesn't have).

## User Stories

### WIZ-001: The widget is chosen step by step (P0) — shipped

- [x] AC1: Reads from — the user's providers whose tools can read it; the user picks (nothing pre-ticked); Claude connectors greyed for widgets.
- [x] AC2: What it does — actions from the provider's tools (each a button that asks first), settings with what they start as, how often it reads.
- [x] AC3: Talks to — Dash's own three events always sent; proposed events with what they carry; listens for the dashboard's bots' results.
- [x] AC4: Looks — previews drawn with dash-react from a real read of the provider; tweak live.
- [x] AC5: Review & build — every part on one card; nothing built until yes.
- [x] AC6: A widget the user already has goes through its own steps (Which one · Settings · Review), nothing built.

### WIZ-002: Every step is checked before it's asked (P0)

- [x] AC1: The wizard asks the chosen provider for its running tools (the app's own call — no widget permission, Issue or events) once the provider is picked; the side shows "Checked before asking" with what was checked.
- [x] AC2: What it does offers only actions the running provider has (its saved list until it answers); a tool the Planner proposed that the provider doesn't have is never offered.
- [x] AC3: When reading itself needs a tool that can change things (or doesn't say), step 2 says so; the widget only calls it to read and the Checker is told to check that.
- [x] AC4: A setting that goes into one of the read tool's inputs takes what that input takes — a choice list becomes a dropdown, a number range is shown and a value outside it holds Next.
- [x] AC5: Talks to proposes only event names a widget can send (no reserved names, no duplicates, no spaces or punctuation).
- [x] AC6: Looks offers only the looks the real data can fill (no Timeline for items without times); with the Planner's sample, all of them, fitting first.
- [x] AC7: Review & build checks the whole set again: a chosen tool the provider doesn't have, or a setting it can't take, is said there and holds Yes, build it.

### WIZ-003: The build is held to every choice (P0)

- [x] AC1: Dash checks each draft's code against what the user chose — the provider's connection declared, only chosen tools that change things called, each setting there with its chosen start, each event listed and sent, each listener's handler declared, the empty words in it, the look's dash-react parts used, a timer when it reads again on a schedule. A tool Dash can't tell reads or changes is left to the Checker, never failed.
- [x] AC2: The Builder hears a mismatch when it saves a draft (build_widget's answer, as advice — it never blocks installing), and again from the build's own check before the Checker runs — each one "what it does — the user chose: …".
- [x] AC3: A mismatch goes back to the Builder by itself until it matches, with no clicks. A fix that gets nowhere (the same mismatch in two checks one after another) starts afresh once; after that, or after 6 fixes, it's the end of the line. Only a widget built step by step (`chosen`) is held this way — other builds keep their 2 fixes and the Checker alone.
- [x] AC4: The Checker is told what Dash already checked and that it matches, and spends its check on what code can't settle.
- [x] AC5: The Builder says CAN'T (with the closest that works) instead of faking a choice that can't be done.
- [x] AC6: The chat says it plainly: "Checked — 2 things didn't match what you chose" while the Builder fixes them; "Builder fixed 2 things to match your choices · Checked — it matches every choice you made" once it does; the Check report lists each choice with ✓ or ✕.
- [x] AC7: End of the line: what can't be done, the closest that works ("Build it that way"), or "Stop here" — nothing is installed either way.
- [ ] AC8: Verified live on a real build (user's dev app, throwaway profile).

## Out of Scope (this round)

- Checking setting values against a provider's own lists that its tools don't declare (e.g. the user's calendars when the tool's input isn't an enum).
- Re-planning automatically when the Planner names a read tool the provider doesn't have — Review says so and asks the Planner.

## Implementation Notes

- Build side: `electron/bots/specChecks.js` (pure: `specCheck(piece, code, { events, live })` → rows, problems, unsure; `cantOf`), `electron/bots/planBuild.js` (`heldToChoices` in the check step, `holdBuilder` during the build step, `MAX_FIXES = 6`, `FRESH_AT = 3`, fresh start, `endOfLine`, `settle`), `electron/controller/botController.js` (deps `draftCode`, `liveTools`, `holdBuilder`; `fixPlanBuild` settles an end of the line with a closest; live tools keep their `annotations`).
- dash-electron `public/lib/teamWidgetTools.cjs`: `useChoices(fn)` adds "Doesn't match what the user chose: …" to build_widget's problems; `draftCode({ name })`.
- Chat: `src/Components/LeadWorkspace/workspaceBuild.js` (`heldOf`, `heldLines`, `heldRows`, fixing / end-of-line chat), `BuildViews.js` (`OffRows`, `EndOfLine`, step-line "See the check", Check report "What you chose").
- Before asking: `WidgetWizard/useLiveTools.js` (hidden internal `useMcpProvider`), `WidgetWizard/askChecks.js` (`offeredChanges`, `readNotice`, `missingReads`, `settingBounds`, `boundProblem`, `preflight`, `askRows`), `widgetSpec.changeTools(piece, providers, live)`, `proposedSends` name check, `StepDoes` / `SettingsEditor` bounds, `StepLooks` fit filter, `WorkspaceSide` "Checked before asking".
- The wizard marks its widget `chosen: true` (applyChoices); planBuild holds only those. build_widget's advice is added in botController (`_builderHold`, only for the builder role; letting go clears only its own), with the same live tools as the check step.
- The wizard waits 15 s for the provider's tools, then uses its saved list (`LIVE_TOOLS_WAIT_MS`); live tools are one provider's — a widget reading from two keeps the other's saved list.
- Pre-release review found 12 problems (false mismatches from `useScheduler`, Header: None, globs in strings, JSX entities, loose CAN'T matching; settle, repeat counting, a global Builder check, two providers, a provider that never answers, builds without choices, a restored end of the line) — all fixed with tests.

## Revision History

- 2026-11-13: Created with WIZ-001 (shipped), WIZ-002, WIZ-003.
