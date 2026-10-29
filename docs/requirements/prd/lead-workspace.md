# PRD: Lead Workspace — Talk to Each Team Through Its Lead

**Status:** In Progress (release 1)
**Last Updated:** 2026-10-28
**Owner:** John Giatropoulos
**Location:** dash-core (framework feature; dash-electron hosts the notifications panel and picks up each release)
**Approved mockup:** https://claude.ai/artifact/LQogUdGVwvhr1w435jXkrS (page "CURRENT — Lead workspace", frames 1–37)
**Related PRDs:** [bot-teams.md](./bot-teams.md) (teams, leads), [app-navigation.md](./app-navigation.md) (Bots page, bot page), [bot-factory.md](./bot-factory.md) (bots, approvals)

---

## Executive Summary

A user talks to a **team of bots through its lead**, in one place: a large conversation workspace laid out like Claude Cowork — the lead switcher and that lead's conversations on the left, the conversation in the middle, and on the right **Outputs** (the plan, a built dashboard, a bot's results) and **Team in this conversation** (each bot's live line and its output). The Dash team gets its own **Dash Lead**; each dashboard keeps its lead. A bot on no dashboard is talked to directly. **Create** becomes a new conversation with the Dash Lead, its plan checklist moving into the right column. The right-edge robot rail becomes **one panel for every bot notification and approval**, and the **Bots page** becomes management only, organised by team.

## Problem Statement

After a week of iterating, talking to bots was still confusing (QA 2026-10-28):

- Clicking a Dash team role didn't open its conversation; a "To:" picker changed instead.
- Bots on a dashboard could each be chatted with, so a dashboard added one more conversation per bot, and the roles of the Dash team (Planner, Scout, Builder, Checker) had to be learned to use it.
- A plan jumped the user from the chat into a separate Create window.
- Approvals, plans and results were spread across the Bots panel, Create, the Bots page and each bot's page.

## Decisions (with the user, 2026-10-28)

1. A bot on a dashboard is talked to **only through that dashboard's team lead** — the liaison. A bot on no dashboard is chatted with directly.
2. The Dash team gets a **Dash Lead**; the Planner is a member, not the lead.
3. A lead is mostly a router, so it runs on a **fast model** by default (changeable per lead); the bots doing the work keep their own.
4. A conversation **always stays with the lead it was started with**. Asked to make something, a dashboard lead brings in the Dash team as a sub-agent group in the right column and relays the plan; the user approves to the same lead.
5. The workspace is a large modal (× to close, no back button). The **lead switcher** is at the top of the left column; switching swaps the whole workspace. Recents are per lead.
6. Approving is a **reply choice** under the lead's question ("Yes, build it" / "Change something"), never a button inside a card.
7. The right column shows each bot's **live line** (spinner + latest step) and its **outputs** you can open (Scout findings, Plan, Build log, Checker report; for custom bots: answer, results, actions taken, links, files, widget updates). It is **resizable** (drag the edge; Expand on an opened output).
8. Every "needs you" item **names the bot asking** ("Planner · Dash team").
9. The **notifications panel** (right-edge robot, on every screen): Needs you from every dashboard (tagged), quick answers inline (Allow/Deny/Reconnect/Retry), plans and questions open the right conversation, Activity (This dashboard / All), **Open conversation with** this dashboard's lead; it opens by itself when something new needs you. No lead button beside Edit.
10. The **Bots page** is management only, teams first: collapsed team rows with badges, Needs you on top, dashboards with no bots folded into one row; only leads and lone bots have Open conversation.
11. The dashboard's own Bots view **diagram stays** (for wiring); its chat tabs go, and the lead opens the workspace.

## User Stories (by release)

### Release 1 — leads can ask their bots (no new screens)

**LW-001: A dashboard lead asks one of its bots to run.**

- AC1: `team_ask_bot { bot, request }` runs a bot on the lead's own team with the request and returns its answer, fenced as untrusted data.
- AC2: Another dashboard's bot isn't found; a paused or busy bot isn't run, and the lead is told to say so.
- AC3: The bot runs as usual — its own tools, approvals, pause and budget — and its run records `via: lead:<leadId>` and keeps its own chat session (job slot).
- AC4: Counted with the lead's hand-offs per run; a run still going after 3 minutes (usually waiting on an approval) is reported as pending and finishes on its own.
- AC5: Lead instructions say to use it, pass the full request, and name which bot an answer came from; generated instructions upgrade, edited ones stay.

- AC6 (safety): a bot run this way always asks before anything that changes things (approvalPolicy "ask" for that run; tools the user chose to always allow stay allowed) — the request came through the lead, whose words team data can steer.
- AC7: a lead whose own run came from outside Dash (an MCP client, via "mcp") can't run its bots.
- AC8: stopping the lead stops the bots it is waiting on.

**LW-002: The Dash Lead.**

- AC1: A new Dash team role `dashlead` ("Dash Lead"), fast tier, no engine built-ins, never a dashboard lead (`role !== "lead"`).
- AC2: Tools: `ask_role` (planner, scout, builder, checker), `list_dashboards`, `list_providers`, `bot_results`, `bot_runs`. The Planner keeps `ask_role` (scout, builder, checker) until release 3 moves planning into the workspace.
- AC3: Hand-offs from the Dash Lead are answer-only, like the Planner's (no build or place tools).
- AC4: Until the workspace ships, the Dash Lead is reachable in the Dash team conversation's "To:" picker, and sends people to Create to build a plan.

### Release 2 — the workspace

Frames 1, 9–11, 16–19, 32, 34, 37. Conversation storage per lead (messages, hand-off steps, outputs); the switcher; Team in this conversation with live lines; outputs (answer, results, actions, links); Stop; approvals in the chat; resizable right column. Opened from the Bots page (leads, lone bots).

### Release 3 — making things in the workspace (Create folds in)

Frames 1–8, 13, 18, 30, 31, 33. Plan as an output; "Before it builds" with who-asks; build progress; live widget preview; before/after for changes; Try again / Leave it off / Reconnect; dashboard leads bring in the Dash team; Create opens a new Dash Lead conversation. Today's Create pieces are re-hosted, not rewritten.

### Release 4 — the notifications panel

Frames 22, 27–29.

### Release 5 — the Bots page, teams first

Frames 14, 15, 23–26.

### Release 6 — finishing

Smaller windows (35–36), light theme, carrying existing Dash team questions into Dash Lead conversations, removing old chat entry points.

## Risks

- Release 3 re-hosts about 4,000 lines of Create; keep its pieces (provider connect, approvals, build recovery) intact.
- Each hand-off adds a fast-model call; shown in the conversation's usage.
- A lead's ask can meet a member's scheduled run — one run per bot still applies; the lead reports "busy".
- A long wait on an approval inside a lead's tool call: capped at 3 minutes, then reported as pending.

## Implementation Notes

### Release 1 (2026-10-28)

- `electron/bots/teamTools.js`: `team_ask_bot` (deps.askBot).
- `electron/bots/leadAsk.js`: `askTeamBot` (via `lead:<id>`, approvalPolicy "ask", outside callers refused, 3-minute wait). `electron/controller/botController.js`: `_leadAskBot` (HandoffCap, `_runVia`, `_leadAsked` for stop).
- `electron/bots/teamLeads.js`: `ASK_BOTS` sentence prepended to the lead's action text; the previous action kept in `LEAD_ACTION_HISTORY`.
- `electron/bots/dashTeam.js`: `dashlead` role (appended to `ROLES`). `electron/bots/roleTools.js`: `ASK_TARGETS`, Dash Lead tools.
- `src/Components/Bots/DashTeamPage.js`, `src/Components/Create/AskStep.js`: the Dash Lead in the "To:" picker, asked with the words as typed.
- Leads already defaulted to the fast tier (`_resolveRunProfile`).

### Release 2 (2026-10-29)

- `src/Components/LeadWorkspace/`: `LeadWorkspace` (the window: switcher, per-lead Recents, conversation, resizable right column; loading and missing-lead states), `WorkspaceSide` (Needs you, Outputs, Team in this conversation with live lines; a lone bot's runs), `HandoffStep` + `handoffSteps.js` (steps from the lead's stream; per-question ids; stopped when the run ends without an answer), `workspaceContacts.js`.
- Opened by the `dash:open-workspace` event (`{ key: "role:dashlead" | "lead:<id>" | "bot:<id>" }`), hosted in `DashboardStage`; "Open conversation" on a lead's or lone bot's page, "Talk to the Dash Lead" on the Dash team page (both ask about unsaved edits first).
- `AskStep`: hand-off steps, Stop (only that lead or role, and what it asked — `botController` tracks `_askRole` runs for stop too), `onMessagesChange`, `approvalBots`, `hideTo`; a reopened thread picks up a newer saved copy.
- `createRecent` summaries carry `with` ("lead:<id>" | "role:<role>") for per-lead Recents.
- Approvals show in the chat and in the right column's Needs you, as in the approved mockup (frame 34).
- Not yet: a member's full run (actions, links, files) as an output — release 3 with the plan outputs; bots are matched to steps by name.
