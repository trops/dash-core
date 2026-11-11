# PRD: Issues — See What Went Wrong in Widgets, Bots and Providers

**Status:** Implemented
**Last Updated:** 2026-11-11
**Owner:** John Giatropoulos
**Location:** dash-core (store, capture, UI); dash-electron (IPC handlers, Debug Console logging)
**Related PRDs:** [team-dashboards.md](./team-dashboards.md), [bot-teams.md](./bot-teams.md), [mcp-providers.md](./mcp-providers.md)

Mockup: design canvas page "Issues" (frames 1–8), approved 2026-11-11.

---

## Executive Summary

When a widget, bot or provider fails, Dash records what failed, where, and why — the exact call, what it was asked with (secrets hidden) and the error — and shows it where the user looks: a red dot on the asset, a "What went wrong" section in its panel, an Issues page in the left menu, real health on the Providers page, and a bot's Activity. Each issue offers Retry, Reconnect, Fix with AI (which hands the error to the Dash team) and Mark resolved.

## Problem Statement

A widget that says "notes aren't available right now" left no trace the user could find. A failed provider call was logged as a success in the Debug Console (the call answers `{ error: true }` instead of throwing). Bot warnings (a server that couldn't start, a connector that wasn't connected) were shown once and lost. Run records kept only `{tool, provider, ok}`. MCP providers showed "Connected" even after a start failure. Toasts vanished, with no history. Debugging meant guessing.

## User Stories

### ISS-001: Failures are recorded with where and why (P0)

**Acceptance Criteria:**

- [x] AC1: A widget's provider call that fails — an error answer, an MCP `isError` result, a timeout — is recorded against that copy of the widget (component, layout item, dashboard) with the provider, tool, what it was asked with (secret-named fields hidden, clipped) and the error. The same call working again resolves it.
- [x] AC2: A widget that crashes while showing, or is stopped for failing again and again, is recorded with its message.
- [x] AC3: A bot run's warnings are saved on the run; a failed call keeps what it was asked with and why (sealed at rest like the answer); a failed or warning run becomes an issue; a clean run resolves the bot's open issues.
- [x] AC4: A provider that couldn't start, or whose sign-in expired, is recorded; starting again resolves it.
- [x] AC5: Repeats group into one issue per asset and failing call ("12 times since 7:30", the last 5 kept); a resolved issue that happens again opens again. At most 500, resolved ones kept 30 days. The list is saved in the app's data folder, sealed at rest.
- [x] AC6: Each issue gets a likely cause in plain words when the error shows one (server not answering, address not found, timeout, sign-in expired, refused, rate limited, not connected, tool not allowed).
- [x] AC7: The Debug Console logs a handler that answered with an error as an error, with its message.

### ISS-002: The user sees it where they look (P0)

- [ ] AC1: A widget with open issues shows a red "N problem(s)" chip; hovering shows the newest with See what went wrong and Retry.
- [ ] AC2: The widget's panel has a Problems section: the call, what it was asked with, the error, the likely cause, earlier failures; Retry, Open provider, Fix with AI, Show in Debug Console.
- [ ] AC3: An Issues page in the left menu with an open count: newest first, filter by kind and dashboard, open/resolved; one issue opens beside the list with where, the call, the error, a timeline, and Reconnect, Retry, Fix with AI, Open the widget, Mark resolved.
- [ ] AC4: A bot's Activity shows a run's warnings and why each failed call failed.
- [ ] AC5: The Providers page shows "Couldn't start" / "Sign-in expired" with the error and Reconnect / Sign in.
- [ ] AC6: Fix with AI on a widget opens its Change with AI conversation with the error; on a bot, Create's Ask AI with the bot and the error.

## Out of Scope (this round)

- The Debug Console's list + detail layout (fast follow, roadmap Phase A2).
- Issues for flows (roadmap Phase D).

## Implementation Notes

- `electron/issues/issueStore.js` (pure: group, count, reopen, prune, redact), `electron/issues/issueSources.js` (failure → issue, likely cause), `electron/controller/issueController.js` (file + seal + broadcast `issues:changed`), `electron/api/issuesApi.js` (`mainApi.issues`), `electron/events/issueEvents.js`.
- Capture: `src/hooks/useMcpProvider.js` (a widget's calls, via `src/utils/issues.js`), `src/Widget/WidgetFactory.js` + `WidgetGuardViews.js` (crashes, stops), `electron/bots/BotRunner.js` (warnings, sealed `toolErrors`), `electron/controller/botController.js` (`_recordRunIssues`, warnings through the run's `emit`), `electron/controller/mcpController.js` (start failure, sign-in, started again).
- The renderer sends facts tagged `from: "widget-call" | "widget-crash"`; the main process words them (`issueSources`) so wording lives in one place.
- dash-electron: `public/electron.js` registers the IPC handlers and flushes on quit; `public/lib/ipcResult.cjs` decides when a handler's answer is a failure for the Debug Console (`{ error: true }` or an MCP `isError` result; not `success: false`, which some handlers use for normal outcomes).
- After user testing: provider JSON errors read as their message, with the provider's own suggestion as the likely cause; "Show raw" shows the full answer (`readableError`, main and renderer). Widgets are named by their title or display name, not their code name (`setWidgetNamer`). Reconnect shows only when the provider is at fault (`cause`). Deleted bots, providers and dashboards take their issues with them; a saved dashboard sweeps issues of removed widgets. A successful call reaches the main process only when it fixes an open issue.
- Next: "Mute errors like this" (per widget + tool + same error), mockup first.
- Found while building: dash-core's `ci.sh` lists node tests by hand and three test files from TD-009 were missing — added; 29 older electron test files are not run by CI at all (38 failing, one hangs) — raised as a separate follow-up.

## Revision History

| Version | Date       | Author            | Changes                                                     |
| ------- | ---------- | ----------------- | ----------------------------------------------------------- |
| 1.0     | 2026-11-11 | John Giatropoulos | Initial PRD from the approved mockup; ISS-001 built         |
| 1.1     | 2026-11-11 | John Giatropoulos | Readable errors + Show raw, names, whose fault; implemented |
