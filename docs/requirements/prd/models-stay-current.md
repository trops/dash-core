# PRD: Models stay current

**Status:** In Progress
**Last Updated:** 2026-11-15
**Owner:** Dash
**Related PRDs:** [ai-assistant.md](./ai-assistant.md)
**Mockups:** canvas LQogUdGVwvhr1w435jXkrS, page "Models stay current (proposed)" (frames 1–9)

---

## Executive Summary

Dash's AI settings (each job's default, each bot's model, each Chat widget's
model) can follow the newest model of a family ("Latest Haiku") instead of one
exact version. The model list stays fresh without an app update: the app
checks Dash's published list at launch, daily and on wake, and Anthropic's
own list when an API key is saved. When a model is retired, every saved
setting still on it is shown and moved in one click — written into the saved
settings, not only swapped at run time.

---

## Context & Background

### Problem Statement

The model list was hardcoded in `electron/llm/modelProviders.js`: a new model
(Fable 5.2) needed an app release, and the live Models API ran only with an
API key that no caller passed. Defaults and bots saved exact ids. A retired id
was swapped in memory at run time (`migrateModelId`), so Settings kept showing
the retired model while something else ran; a retired job default was
silently ignored (`_modelPick` only accepted ids in the built-in list); and a
retired id with no known replacement failed the run with a 404. The Chat
sample widgets hardcoded 4.x models.

**Who experiences this problem?** Everyone who uses AI in Dash — on the Claude
subscription (no API key) most of all.

**What happens if we don't solve it?** New models don't show up, saved
settings drift from what really runs, and bots fail when a model is retired.

---

## Goals

1. New models appear in every picker without an app update.
2. A default, bot or widget can follow the newest of a family.
3. A retired model never fails a run, and the user can see and fix every
   saved setting still on it.
4. One model list everywhere: Settings › AI, a bot's Model, a widget's Model.

### Non-Goals

- Models from other vendors (OpenAI, xAI) — they keep their own live lists;
  "Latest" is offered only for families the list knows.
- Pricing changes from the list beyond what's published with each model.

---

## User Stories

**US-001: The model list stays fresh** (P0)

- [x] AC1: The app checks Dash's list at launch, every 24 hours while it
      runs, on wake when the last check is over a day old, and on Check now.
- [x] AC2: A failed check keeps the last good list (saved between launches)
      and tries again an hour later; Settings says "Last checked … · couldn't
      reach the list".
- [x] AC3: With an API key saved (and Settings › AI on it), Anthropic's
      Models API narrows the list to what the key can use.
- [x] AC4: Entries that don't check out are dropped; a list with none left is
      refused.

**US-002: Follow the newest of a family** (P0)

- [x] AC1: A saved choice can be "latest:<family>"; each run uses the newest
      model of that family that still runs.
- [x] AC2: Settings › AI shows "Latest Haiku · now Haiku 5.5"; the picker
      groups Follows the newest / Stays on one version, tags New and
      Retiring, and dims older models.
- [x] AC3: Once, Settings › AI asks "Keep your models up to date?" for the
      defaults set to one exact model (all ticked; untick to keep one).

**US-003: Retirement, visibly** (P0)

- [x] AC1: Settings › AI lists every saved choice of a retired model — job
      defaults, bots, the Dash team's older picks, widgets on every dashboard.
- [x] AC2: Move all writes the replacement ("Latest <family>") into the saved
      settings; Choose another model picks something else. Both say what moved.
- [x] AC3: A run whose model is gone checks the list again and runs once more
      on the replacement — before any tool ran.
- [x] AC4: With no known replacement it runs on the job's default and Issues
      says so, with a picker to choose what it uses from now on.

**US-004: One model list everywhere** (P0)

- [x] AC1: A bot's Model and a widget setting of type `"model"` use the same
      picker; the Chat sample widgets default to Latest Sonnet.

---

## Design

- `electron/llm/modelProviders.js` — the one list (built-in copy), family and
  status per model, `latest:<family>`, `migrateModelId` follows retirements
  until a model that runs, `setFreshList` for the fetched list.
- `electron/llm/modelList.js` — fetch, check, save, timers (pure; the host
  injects fetch, storage and the clock); `modelListHost.js` runs it in the app.
- `electron/llm/modelUsage.js` — where models are saved; the plan to move them.
- Renderer: `Settings/modelChoices.js` (pure), `ModelPicker`, `ModelField`,
  `NewModelNotice`, `RetiredModelNotice`, `FollowNewestModal`, Issues
  `IssueModelChoice`. dash-react `SelectInput` gained group headings, a second
  line per option, badges and dimmed options in its custom dropdown.
- The published list: dash-registry `GET /api/models` (`src/lib/modelList.ts`).

### Decisions Made

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-11-15 | Dash publishes the list (registry), plus Anthropic's list with an API key | Subscription users have no Models API |
| 2026-11-15 | Retired ids map to "latest:<family>" | A retired model moves to its family's newest |
| 2026-11-15 | Moves are written to saved settings, with a notice | Settings say what really runs |
| 2026-11-15 | Check at launch, daily, on wake, on a gone model, on Check now | The app may run for days |

---

## Testing Requirements

- Unit: `modelProviders.test.js`, `modelList.test.js`, `modelUsage.test.js`,
  `aiRunProfile.test.js`, `BotRunner.test.js`, `retryPolicy.test.js`,
  `issueSources.test.js`, `modelChoices.test.js`, `ModelField.test.js`,
  `AiAssistantSection.test.js`, `IssuesPage.test.js`; dash-react
  `SelectInput.test.js`; dash-registry `modelList.test.ts`.
- Live: Settings › AI in a test profile (each frame), a bot on Latest Haiku,
  the retired-widget move, a Chat widget's Model field.

---

## Revision History

| Version | Date       | Author | Changes       |
| ------- | ---------- | ------ | ------------- |
| 1.0     | 2026-11-15 | Dash   | Initial draft |
