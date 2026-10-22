# PRD: Team Dashboards — Bots, Widgets and Dashboards Built to Work Together

**Status:** Implemented
**Last Updated:** 2026-10-22
**Owner:** John Giatropoulos
**Location:** dash-core (framework feature; Widget Builder guidance and app wiring in dash-electron)
**Related PRDs:** [bot-teams.md](./bot-teams.md) (teams, leads, TEAM-012 bot widgets), [bot-factory.md](./bot-factory.md) (bot events US-010/US-011, dashboard packages US-027), dash-electron `docs/requirements/prd/ai-assistant.md` (Widget Builder)

---

## Executive Summary

A user should be able to state a goal, such as "check my email, pick out the important messages and tell me about them", and get **one working setup**: the bots that do the work, the widgets that show what the bots found and let the user act on it, and a dashboard that holds them. Today each piece is built separately. The Assistant lays out dashboards, the Widget Builder makes one widget at a time, and a team lead drafts one bot at a time. The widgets that tie bots to a dashboard are generic ("Bot results", "Bot activity"), so a bot-driven dashboard looks like a bot report rather than a useful tool.

This PRD adds the connectors and then the planner:

1. **Bots send results.** A bot can declare named results (for example "Important emails") and send them as structured items that widgets display.
2. **Widgets start bots.** The Widget Builder makes action widgets (a "Check email" button) whose events start the bots wired to them.
3. **One plan for everything.** From a goal, the lead proposes the bots, the widgets, the layout and how they connect, as one plan the user approves, then builds it.

---

## Context & Background

### Problem Statement

A bot's output is free text. Widgets can listen to a bot's `completed` event, but all they get is the answer as prose, so the only thing that can show it is a text box. A widget that lists "important emails" has no data to show.

The reverse direction works but is undocumented. A bot can already run when a widget event fires ("Runs when…" in the bot form), but the Widget Builder doesn't know how to build a widget meant to start a bot, and a team lead's drafts can't use widget events as triggers.

Nothing plans the three pieces together, so the user has to design the wiring themselves.

### Current State (dash-core v0.1.722 / dash-electron v0.0.920)

- Bot events: `bot:<ref>[<botId>].completed|failed|tool.<providerType>.<tool>` on the dashboard bus (botEvents.js). Payload text capped at 8 KB.
- Widgets listen through Dashboard Config › Listeners, with a dashboard's bots offered as sources (getBotEmitters).
- Bots run on widget events through subscriptions (eventMatcher.js), with cooldown and loop guards.
- `publishes: []` exists in the bot schema but nothing uses it.
- Event replay for widgets opened later only exists in popout windows and only in memory.
- `window.mainApi.bots` (including `run`) is reachable from any widget code, not just Dash's own bot widgets.

---

## Goals & Success Metrics

- A user can go from a goal to a working dashboard (bots + task widgets + wiring) with one approval step.
- Task widgets show structured data from bots (lists, counts, links), not only bot prose.
- A widget can start a bot only through an event the user wired to that bot.

---

## User Stories

### TD-001: Bots send results (P0) — Release 1

**Status:** Implemented

**As a** user building a bot, **I want** my bot to send named, structured results **so that** widgets can show them as real data.

**Acceptance Criteria:**

- [x] AC1: A bot definition can declare `publishes: [{ name, label, description }]`. Names are short identifiers (letters, digits, underscores); duplicates and invalid names are rejected on save.
- [x] AC2: A bot that declares results gets a `send_result` tool. It takes a declared `name`, a list of `items` (objects with suggested fields `title`, `subtitle`, `detail`, `link`, `time`) and an optional `summary`. An undeclared name, a non-list, more than 200 items or more than 64 KB is refused with a clear message.
- [x] AC3: Sending a result publishes `bot:<ref>[<botId>].result.<name>` with `{ botId, ref, botName, name, label, items, summary, sentAt }`. It goes to widgets and subscribed bots like every other bot event, carrying the run's loop chain.
- [x] AC4: The bot form has a "Results" section to add, rename and remove results.
- [x] AC5: Results appear in Dashboard Config › Listeners and in the "Runs when…" trigger picker as "<bot> › <label> (result)" — never "sends", which reads like sending a message.

### TD-002: Widgets opened later show the latest result (P0) — Release 1

**Status:** Implemented

**As a** user, **I want** a results widget to show the latest result even if its dashboard wasn't open when the bot ran **so that** the dashboard is useful as soon as I open it.

**Acceptance Criteria:**

- [x] AC1: The latest result per bot and name is saved (sealed at rest, like run answers) and survives restarts. Deleting the bot deletes its saved results.
- [x] AC2: When a widget subscribes to a result event, it receives the saved latest result (marked `replay: true`) unless a live one already arrived.
- [x] AC3: Only result events replay this way; other events keep today's behaviour.

### TD-003: The Widget Builder builds results widgets (P0) — Release 1

**Status:** Implemented

**As a** user, **I want** to ask the Widget Builder for "a widget that lists the important emails my triage bot finds" **so that** I get a widget made for the task.

**Acceptance Criteria:**

- [x] AC1: The Widget Builder guidance documents result events: the payload shape, the handler, `replay`, and rendering items with dash-react components.
- [x] AC2: Links in items open only `http(s)` URLs, through the app's external-link path.

### TD-004: Action widgets start bots (P0) — Release 2

**Status:** Implemented

**As a** user, **I want** a "Check email" button on my dashboard that starts my email bot **so that** I can run it when I want, from the dashboard.

**Acceptance Criteria:**

- [x] AC1: The Widget Builder guidance documents action widgets: declare the event in `events`, publish it on click, and tell the user to wire the bot with "Runs when…". _(Built, 2026-10-14: Widget Builder skill: "Action widgets")_
- [x] AC2: The widget shows that the run started and when it finished (by listening to the bot's `completed`/`failed`). _(Built, 2026-10-14: the skill's action widgets listen for completed / failed and show status)_

### TD-005: Only wired events start bots (P0) — Release 2

**Status:** Implemented

**As a** user, **I want** widgets to start only the bots I connected them to **so that** an installed widget can't run my bots on its own.

**Acceptance Criteria:**

- [x] AC1: Widget code can't call `mainApi.bots` run/ask methods directly. Dash's own bot widgets keep their Run now. _(Built, 2026-10-14: scanWidgetBotCalls at widget install/load (a name built at run time can still get through))_
- [x] AC2: The AI widget validator rejects generated code that calls `mainApi.bots`. _(Built, 2026-10-14: validateNoBotCalls in the Widget Builder)_

### TD-006: The lead's drafts can run on widget events (P1) — Release 2

**Status:** Superseded by the lead's hand-off to the Dash team (consolidation Phase 2c-2, 2026-10-20). The lead no longer drafts bots. It hands the request to the Dash team, whose plans wire widget events to bots and declare results (TD-008). See bot-teams TEAM-005. The original ACs are in the Appendix.

### TD-007: One plan from a goal (P1) — Release 3

**Status:** Implemented

**As a** user, **I want** to describe a goal and get one plan for the bots, widgets, layout and wiring **so that** I approve it once instead of designing it myself.

The Dash team's **Planner** writes the plan, in Create (dash-electron create-entry.md, CRE-003 and CRE-011). It ends its answer with the plan as JSON inside `<plan></plan>` (`electron/bots/teamPlan.js`).

**Acceptance Criteria:**

- [x] AC1: The Planner's plan lists each bot (purpose, providers, triggers, results), each widget (what it shows, what it listens to, what it sends), the layout and a setup checklist (providers the user must add). _(Built, 2026-10-14: teamPlan.js — bot, widget and layout pieces plus Before building)_
- [x] AC2: The user reviews the plan on one screen and can drop or change parts before building. _(Built, 2026-10-14: Create's plan step: remove a piece, edit a note)_

### TD-008: Build from the plan (P1) — Release 3

**Status:** Implemented

**Acceptance Criteria:**

- [x] AC1 (create-entry 4d-1 + 4d-2, dash-core electron/bots/planBuild.js): Approving the plan saves the bots, generates the widgets, places them on the dashboard and wires listeners and triggers. Bots are saved as planned (not drafts) after a draft-style check; a bot whose provider isn't connected waits ("needs a provider", create-entry CRE-004 AC5 — this replaces "fails that step"). Widgets the Builder makes are drafts until the Checker passes them; only then are they installed and placed (consolidation Phase 1b, create-entry CRE-004). Wiring is checked against the widget's .dash.js, and a widget publishing with the raw `api.publishEvent` (unprefixed, so nothing hears it) fails the step — the Widget Builder and `build_widget` reject it earlier.
- [x] AC2: Anything that needs the user (provider sign-in, grants) is listed, never done for them. _(Built, 2026-10-14: Before building (connect / install / approve) in Create's checklist; a step whose provider isn't connected waits for it ("needs a provider") and resumes once it is, as in AC1 and create-entry CRE-004 AC5)_
- [x] AC3 (create-entry 4d-1): Widget generation runs without opening the Widget Builder window, with progress shown.

---

## Design Considerations

- **Event name:** `result.<name>` sits beside `tool.<providerType>.<tool>`, so result names can never collide with `completed`/`failed`.
- **Untrusted data:** result items can contain text from emails and web pages. Bots that subscribe get them inside the existing untrusted-data fence (composeEventPrompt). Widgets render them as text, never HTML.
- **Size:** 64 KB per result, 200 items, so a list of emails fits but a bot can't flood the bus.
- **Storage:** latest result only, per bot and name, sealed with the same secretBox as run answers.

## Known Limitations

- A widget can only start a bot while its dashboard is open (bot-factory Known Limitations).
- Providers a bot needs (Gmail, Slack…) are always set up by the user.

## Out of Scope

- Result history (only the latest is kept).
- Widgets writing to bot memory (bot-factory Open Question 4).

---

## Implementation Notes

### Release 1 (TD-001 – TD-003)

- `electron/bots/botSchema.js`: `publishes` validation (`RESULT_NAME_RE`).
- `electron/bots/resultTools.js`: `send_result` tool (`RESULTS_SERVER = "bot-results"`, auto-allowed like memory tools), `resultToolsFor(bot)`, `checkResult`.
- `electron/bots/botEvents.js`: `resultEventName`, `resultPayload`, `parseResultEventType`.
- `electron/bots/BotEventPublisher.js`: `sendResult` publishes with the run's cause.
- `electron/bots/BotStore.js`: `setResult` / `getResult`, removed with the bot.
- `electron/bots/engines/agentToolBridge.js`: nested objects keep their unlisted fields (`passthrough`). Found in live testing: under Claude Code (CLI), `send_result` items arrived as `{}` because zod dropped every key the schema didn't list. Affected any MCP tool with open-ended object arguments.
- `electron/controller/botController.js`: wires the tool and `getLatestResult(eventType)`; IPC `bots-get-latest-result`.
- `src/DashboardPublisher.js`: replays the saved latest result to result-event subscribers.
- `src/Components/Settings/details/eventCatalog.js`: result events in Listeners and "Runs when…".
- `src/Components/Settings/details/BotDetail.js`: "Results" section.
- dash-electron `.claude/skills/dash-widget-builder/SKILL.md`: results widgets.

**Verified live (2026-10-10):** a bot declaring "Important emails" sent 3 items under Claude Code (CLI); the Widget Builder built an ImportantEmails widget from the new guidance; wired in Configure › Listeners, it showed the saved result on open (replay) and switched to a new list live when the bot ran again.

**Listeners grouping:** a bot's events are grouped under "When it runs" (Completed, Failed), "Its results" and "Tools it uses" (`groupBotEvents`), so results don't read as run events.

**Wording:** results are labelled "<label> (result)" and the form section "Results" — never "sends", which reads like the bot sending a message.

### Follow-ups found in Release 1

- ~~Team export (teamManifest) and bot packages don't carry `publishes` or result wiring yet.~~ Done in create-entry 5a-1: members keep `publishes`; wiring may be on `result.<name>`; teams exported with a dashboard carry `triggers` (widget event → role) and `listeners` (role's result → widget handler), re-pointed on import.
- Widgets built by the Widget Builder have no name in `.dash.js`, so Add Widget lists them as "My Workspace".
- The install permission review labels `shell.openExternal` as "SHELL", which reads like shell access; it only opens http/https links in the browser.

---

## Revision History

| Version | Date       | Author            | Changes                                                                                                                                                             |
| ------- | ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-10-10 | John Giatropoulos | Initial PRD; Release 1 (TD-001 – TD-003) in progress                                                                                                                |
| 1.1     | 2026-10-22 | John Giatropoulos | Consolidation Phase 5: status Implemented; TD-006 superseded (ACs moved to the Appendix); TD-007 names the Planner; TD-008 AC2: a missing provider waits, not fails |

---

## Appendix: history

### TD-006: The lead's drafts can run on widget events (retired)

Retired in consolidation Phase 2c-2, when the lead stopped drafting bots (`propose_bot` was removed). The original ACs:

- [ ] AC1: `propose_bot` accepts triggers on widgets of the lead's own dashboard, validated against the dashboard's widget event catalog. (Plan builds do this — create-entry 4d-2: a planned bot's `on` becomes a subscription to the placed widget's exact event, checked against its .dash.js.)
- [~] AC2: `propose_bot` accepts declared results (TD-001). _(Partial, 2026-10-14: drafts support publishes and the Dash team's draft tool sets it; the lead's propose_bot couldn't)_
