# PRD: Bot Teams — Dashboard Teams, Team Leads, and Installable Teams

**Status:** Draft
**Last Updated:** 2026-10-01
**Owner:** John Giatropoulos
**Location:** dash-core (framework feature; team UI consumed by dash-electron)
**Related PRDs:** [bot-factory.md](./bot-factory.md) (bots, events, memory, templates, access review), [dashboard-marketplace.md](./dashboard-marketplace.md), [mcp-providers.md](./mcp-providers.md), dash-electron `docs/requirements/prd/ai-assistant.md`

---

## Executive Summary

Bot Teams turns the bots on a dashboard into a **team** the user can talk to, grow, and share. Every dashboard gets a **team lead**: a built-in bot that acts as the team's liaison. It knows what the team's bots are, what they did, and what they found, and the user (or the in-app **AI Assistant**) can ask it questions in plain language. The user can also ask the lead to **add a bot for them**. The lead drafts the bot, and the user reviews and approves it, because a lead can never grant access on its own. Teams are also a **registry asset**: a `.team.json` manifest lists the member bots by **role** and how they're wired together, so a user can install a complete working team (for example "Project Management Team") in one step instead of assembling each bot and its triggers by hand. Every member stays its own bot, with its own grants, approvals, and budget. Teams coordinate the way Bot Factory already decided they should: through the dashboard event bus and shared memory, not a central orchestrator.

---

## Context & Background

### Problem Statement

**What problem are we solving?**

Bots are individuals today. A user can build several bots and wire them together with events (one bot runs when another finishes or uses a tool), but nothing ties them into a group. There's no single place to see a dashboard's bots, nobody to ask "what has this team done today?", and building a multi-bot workflow means creating every bot, choosing every provider and tool, and wiring every trigger yourself. That's realistic for a maker-developer and out of reach for a business user.

Sharing has the same gap. Bot Factory lets a single bot be published as a template (US-026), and lets bots ride along inside a dashboard package (US-027). But a team that doesn't need a dashboard, such as a project-management team that watches Jira and Slack and reports in a chat, has no way to be packaged. A user who finds a good team has to rebuild it bot by bot.

Finally, the AI Assistant, the user's main conversational entry point, can't see bots at all. It can build dashboards and widgets, but it can't answer "what did my bots find this morning?" or "set up a bot that watches my inbox for client emails".

**Who experiences this problem?**

- Primary: Business users (project managers, SEs, team leads) who want automation outcomes without configuring each bot
- Secondary: Maker-developers who build multi-bot workflows and want to share them

**What happens if we don't solve it?**

Bots stay a power-user feature. Multi-bot workflows remain hand-assembled and unshareable, and the registry can only distribute single bots or whole dashboards, missing the most natural unit of automation: a team.

### Current State

**What exists today?** (shipped through dash-core v0.1.641 / dash-electron v0.0.836)

- **Bots** with providers, per-tool selection, schedules, approvals, and remembered approvals ("Always allow") — Settings › Bots, Bot Activity panel
- **Event triggers** — a bot runs on a widget's declared event (Dashboard › Widget › Event) or on another bot's event (`bot:<ref>[<botId>].completed | failed | tool.<providerType>.<tool>`), with dashboard scoping, a chain/depth loop guard, and untrusted-payload fencing
- **Stable bot identity** — every bot has an immutable `ref` (`local/<slug>` or a template's registry id)
- **Scoped memory** — `memory_*` tools with workspace scope
- **`bot.workspaceId`** — exists in the schema but is empty for bots created in Settings
- **AI Assistant** — talks to the Dash MCP server (dashboard, widget, theme, provider, layout tools in `electron/mcp/*Tools.js`)

**Limitations:**

- No team object: a dashboard's bots aren't grouped or managed together
- No one to ask: run results are scattered across the Activity feed
- Bots are created only in Settings, never from the dashboard they serve
- The AI Assistant has no bot or team tools
- Multi-bot setups can't be packaged on their own; templates are single-bot

---

## Goals & Success Metrics

### Primary Goals

1. **Every dashboard has a team you can talk to** — The user can ask a dashboard's lead what the team did and get an answer grounded in real runs and memory.
2. **Build a team by asking** — The user can describe a bot they need and get a ready-to-review draft, without knowing how bots are configured.
3. **Install a team in one step** — A published team installs with one review screen, one grouped access review, and its wiring intact.
4. **Stay in control** — No lead grants access, installs servers, or runs members beyond what the user approved; every team action is visible.
5. **Cost-safe by default** — Leads cost nothing until the user engages them.

### Success Metrics

| Metric                                                      | Target                                 | How Measured                       |
| ----------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Time from "install team" to first successful team run       | < 5 minutes (excluding provider setup) | Manual QA timing, E2E test         |
| Lead answers grounded in team data (runs/memory cited)      | ≥ 90% of answers on a QA question set  | Eval set over seeded team activity |
| Access granted by a lead or an install without user consent | 0                                      | Permission tests, audit log review |
| Model spend by idle leads (never engaged)                   | $0                                     | Usage records per lead bot         |
| "Add a bot for me" drafts saved without manual edits        | ≥ 60% in dogfood                       | Draft-vs-saved diff                |
| Team installs with all wiring resolved                      | 100% when all members install          | Install integration test           |

### Non-Goals

- **A central orchestrator** — Teams coordinate through events and memory (Bot Factory decision 2026-09-27). The lead is a liaison, not a scheduler that drives members (decided 2026-10-01; TEAM-010 stays exploratory).
- **Leads acting outside their dashboard** — A lead sees and acts only on its own dashboard's team.
- **Self-granting** — No lead, template, or manifest can grant tools; only the user can.
- **Multi-user or cloud teams** — Teams are local to one user's Dash, like bots.
- **Replacing the AI Assistant** — The Assistant stays the front door; leads are what it talks to about teams.

---

## User Personas

### Team Owner (business user)

**Role:** Project manager / SE / team lead who owns outcomes, not tooling

**Goals:**

- Get a working automation team without configuring each bot
- Ask simple questions ("what's blocked?", "what did the bots find?") and get straight answers

**Pain Points:**

- Bot setup (providers, tools, triggers) is too technical
- Results are scattered across runs and feeds

**Technical Level:** Beginner–Intermediate

**Success Scenario:** Installs "Project Management Team" from the registry, fills in the Jira project and Slack channel once, approves each bot's access on one screen, and the next morning asks the Assistant "what did my PM team find overnight?"

### Maker-Developer

**Role:** Builds MCP servers and multi-bot workflows (see bot-factory.md)

**Goals:**

- Package a proven multi-bot workflow so others can install it
- Grow a team quickly by describing new bots to the lead

**Pain Points:**

- Teams can only be shared inside a dashboard package today
- Rewiring triggers by hand after every install

**Technical Level:** Advanced

**Success Scenario:** Publishes "Engineering Review Team" as a `.team.json`; installers get the reviewer, notifier, and lead with their wiring intact.

---

## User Stories

### Must-Have (P0)

**TEAM-001: A dashboard has a team**

> As a team owner,
> I want each dashboard's bots grouped as that dashboard's team, and managed from the dashboard itself,
> so that I can see and change the automation for a dashboard where I'm working.

**Priority:** P0
**Status:** In Progress (slice 1 — everything except the lead, which is TEAM-002)

**Acceptance Criteria:**

- [x] AC1: A dashboard's team is the set of bots whose `workspaceId` is that dashboard. Bots with no `workspaceId` stay **unassigned** (global) and keep working as today.
- [x] AC2: Dashboard Config gains a **Bots** tab listing the team: the lead pinned first, then members with status (idle, running, needs setup, paused), last run, and trigger summary. _(Slice 1: members with status and trigger summary. The pinned lead arrives with TEAM-002; "last run" waits for a run-history API.)_
- [x] AC3: **+ Add bot** in the Bots tab opens the existing bot form with `workspaceId` preset; the event picker opens on this dashboard's widgets.
- [x] AC4: An unassigned bot can be **moved into** a team (sets `workspaceId`), and a member can be moved out. Moving warns that event subscriptions scoped to another dashboard won't fire from this one.
- [x] AC5: The Bot Activity panel gains **+ New bot** (scoped to the current dashboard) and can filter/group its feed by team.
- [x] AC6: Settings › Bots stays the all-bots view, grouped by team (dashboard) with an Unassigned group.

**Edge Cases:**

- Dashboard deleted → its team's bots become unassigned and paused (never deleted silently); the lead is deleted.
- Dashboard duplicated → bots are not duplicated; the copy gets its own (idle) lead and an empty team.

**Implementation notes (slice 1, 2026-10-01):**

- **Membership:** `bot.workspaceId` (ids compared as strings) — `electron/bots/teams.js` (main) and `src/Components/Bots/teamUtils.js` (renderer). The event matcher already scoped a team bot to its own dashboard's events; it now compares ids as strings.
- **One bot editor everywhere:** `BotEditorModal` (exported from dash-core) wraps `BotDetail`; used by Dashboard Config › Bots and dash-electron's Bot Activity panel. Settings › Bots keeps its inline form. `BotDetail` gained a **Team** field (Unassigned + dashboards, same-named ones numbered), `defaultWorkspaceId`, the picker preselect, and the off-team warning.
- **Bots tab** (`src/Components/Dashboard/BotsTab.js`): saves immediately (unlike the other staged tabs) and says so; **Remove from team** only unassigns.
- **Current dashboard for the dock:** `DashboardStage` wraps the assistant dock in `WorkspaceContext` (`workspaceData` = current dashboard, `workspaces` = all).
- **Dashboard delete:** `workspaceController.deleteWorkspaceForApplication` emits `workspaceEvents.emitWorkspaceDeleted` (covers the app and the MCP `delete_dashboard` tool); `botController` unassigns + pauses that team (`teams.unassignTeam`).

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-002: Every dashboard gets a team lead**

> As a team owner,
> I want each dashboard to come with a team lead that introduces itself,
> so that I always have someone to ask and a natural place to start building a team.

**Priority:** P0
**Status:** Implemented (slice 2a) — `propose_bot` follows with TEAM-005

**Acceptance Criteria:**

- [x] AC1: When a dashboard is created (or first opened, for existing dashboards), Dash creates its **lead**: a bot with `role: "lead"`, named "<Dashboard> Lead", in that dashboard's team.
- [x] AC2: The lead is **idle by default**: no schedule, no subscriptions, and no model calls until the user (or the Assistant) asks it something. An untouched lead costs $0.
- [x] AC3: The lead introduces itself once, non-blockingly, in the Bots tab and the Activity panel: what it is, what it can do ("Ask me what the team is doing, or ask me to add a bot"), and how to turn it off. _(The "add a bot" line arrives with TEAM-005.)_
- [x] AC4: The lead's tools are **read-only team tools** served in-process (like `memory_*`): `team_list_bots`, `team_get_bot`, `team_recent_runs` (summaries, statuses, errors), `team_memory_read`, plus `propose_bot` (TEAM-005). It has no provider (MCP) tools unless the user explicitly adds them. _(v1: a lead gets only its team tools — providers on a lead are ignored — and no engine built-ins.)_
- [x] AC5: The user can rename the lead, change its model, or **turn it off**. Turning it off removes the lead from that dashboard and stops auto-creating it there; it can be turned back on from the Bots tab.
- [x] AC6: A dashboard has at most one lead.

**Edge Cases:**

- No AI provider configured → the lead exists but shows "Add a model source to talk to your lead", with a link to the provider setup.
- Lead deleted from Settings › Bots → treated as turned off for that dashboard.
- Global setting "Create team leads automatically" (default on) → off means leads are created only on demand from the Bots tab.

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-003: Ask the team lead**

> As a team owner,
> I want to ask my dashboard's lead questions and keep the conversation going,
> so that I can find out what the team did and why without digging through runs.

**Priority:** P0
**Status:** Implemented (slice 2a)

**Acceptance Criteria:**

- [x] AC1: The Bots tab and the Activity panel offer **Ask the lead**: a chat with the lead that continues across messages (the lead's engine session is resumed for follow-ups and reset on "New conversation").
- [x] AC2: Answers are grounded in team data from the team tools (runs, outputs, memory). The lead cites what it used ("From Inbox Watch's 9:02 run…") and says so when it doesn't know.
- [x] AC3: Data the lead reads from runs and memory is presented to its model as **untrusted data**, using the same fencing as event payloads (bot-factory US-011 AC4), because it can contain email or web text.
- [x] AC4: Every question and answer is logged in the Activity feed as a lead run (trigger "ask").

**Implementation notes (slice 2a, TEAM-002 + TEAM-003, 2026-10-02):**

- **Lead creation:** `DashboardStage` calls `bots.ensureLead(id, name)` when a dashboard opens; `electron/bots/teamLeads.js` decides (`planEnsureLead`: one per dashboard, never when turned off or auto-create is off unless forced). Leads default to the user's default AI provider, else Claude Code. Deleting a lead in Settings counts as turning it off.
- **Read-only by construction:** `botController._resolveTools` gives a lead only `TEAM_TOOLS` (`electron/bots/teamTools.js`, served under the internal `bot-team` server, scoped to the lead's dashboard, results fenced in `<team_data>`); the runner sets `builtinTools: "none"`, which the Claude Agent engine maps to the SDK's `tools: []` with a deny backstop in `canUseTool`. Lead answers don't go on the event bus.
- **Run answers:** `BotRunner` keeps each run's final text (last 8 KB) on the run record — what `team_recent_runs` reads — and `BotStore` **seals it at rest** with the OS keychain (`secretBox.js` over Electron `safeStorage`, injected by `host.js`; plain-text fallback where unavailable; undecryptable answers read as unavailable).
- **UI:** `AskLead` (chat; follow-ups resume the session) and `TeamLeadSection` (lead, one-time intro, Turn off/on) in Dashboard Config › Bots and the Bot Activity panel; **Create team leads automatically** in Settings › Bots.
- **Edge-case deviation:** with no AI provider configured, the lead uses Claude Code (no API key needed) rather than showing "Add a model source".

**Example Scenario:**

```
User (Sales dashboard → Bots → Ask the lead): "Anything urgent today?"
Lead: "Inbox Watch flagged 2 client emails at 9:02 (Acme renewal, Globex
pricing question). CRM Sync failed at 10:15 — the Salesforce token expired.
Want me to draft a bot that follows up on renewals?"
```

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-004: The AI Assistant talks to team leads**

> As a team owner,
> I want to ask the AI Assistant about any of my teams,
> so that I have one place to ask questions instead of opening each dashboard.

**Priority:** P0
**Status:** Implemented (slice 2b)

**Acceptance Criteria:**

- [x] AC1: The Dash MCP server gains team tools (new `electron/mcp/teamTools.js`): `list_teams` (dashboards with a lead or members: name, member count, last activity) and `ask_team_lead(dashboard, question)`, which runs that dashboard's lead with the question and returns its answer.
- [x] AC2: The Assistant relays the lead's answer and names which team it came from. Questions spanning teams ("what did all my teams do today?") fan out to each lead, with a cap on how many are asked per question (default 5).
- [x] AC3: `ask_team_lead` obeys the lead's approval policy and budget like any run; a paused or over-budget lead returns that status instead of an answer.
- [x] AC4: Assistant-originated lead runs are labelled "via Assistant" in the Activity feed.

**Edge Cases:**

- Dashboard has no lead (turned off) → `ask_team_lead` returns "This dashboard has no team lead" with how to turn it on.
- Ambiguous dashboard name (duplicates) → the Assistant asks which one, listing the disambiguated names (as in the event picker).

**Implementation notes (slice 2b, 2026-10-02):**

- `electron/mcp/teamTools.js` registers `list_teams` and `ask_team_lead` on the Dash MCP server (the in-app Assistant reaches them as `mcp__dash__…`). Pure helpers in `electron/bots/teamDirectory.js`: `summarizeTeams`, `resolveDashboard` (id → exact name → unique partial; duplicates are returned so the Assistant asks which), `AskCap` (5 leads per 2 minutes).
- `ask_team_lead` checks `botController.leadAvailability` first — pause and budgets only block tool calls, so a paused/over-budget lead would otherwise "answer" with its tools refused — then runs `askLead(…, { via: "assistant" })`. Answers come back as "Team: <name> (lead: <lead>)\n\n<answer>"; failures and a busy lead are relayed as text.
- Runs record `via: "assistant"`; the Bots view shows "Asked via the AI Assistant" above the question.
- The fan-out cap is enforced by the tool (rolling window), and the tool description tells the Assistant to ask each relevant lead once.

**Definition of Done:**

- [x] Code implemented and reviewed
- [x] Unit tests pass
- [ ] Integration tests pass
- [x] Acceptance criteria verified
- [ ] Documentation updated

---

### Should-Have (P1)

**TEAM-005: The lead adds bots for you**

> As a team owner,
> I want to describe a bot I need and have the lead draft it for me,
> so that I can grow my team without knowing how bots are configured.

**Priority:** P1
**Status:** Backlog

**Acceptance Criteria:**

- [ ] AC1: The lead's `propose_bot` tool produces a **draft**: name, instructions, providers and tools (from the user's existing Dash providers only), schedule, and event subscriptions (from the picker's catalogs, never invented event names).
- [ ] AC2: A draft is never saved or run by the lead. It opens the bot form prefilled (with Bot Builder's Chat pane when available, bot-factory US-017), with the lead's reasoning shown, for the user to edit and **Save**.
- [ ] AC3: Tools in the draft appear as **pending suggestions** the user accepts individually (bot-factory US-017 AC5). Saving the bot doesn't grant tools beyond what the user accepted; runtime approvals still apply.
- [ ] AC4: If the request needs a provider the user doesn't have, the draft says so and links to Settings › Providers (or the capability ladder, bot-factory US-025). It never installs anything.
- [ ] AC5: The AI Assistant can trigger the same flow ("ask the Sales lead to add a bot that…"). The draft still opens for the user's review.

**Edge Cases:**

- Request duplicates an existing member → the lead points to that bot and offers to adjust it instead.
- Request would wire bots into a loop → the draft is flagged with the chain the loop guard would refuse.

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-006: Publish a team (`.team.json`)**

> As a maker-developer,
> I want to publish a dashboard's team to the registry,
> so that others can install the whole team instead of rebuilding it.

**Priority:** P1
**Status:** Backlog

**Acceptance Criteria:**

- [ ] AC1: A `.team.json` manifest schema is defined (see Team Manifest Schema): metadata, shared install variables, the lead's brief, members by **role**, wiring between roles, memory keys, and a suggested budget.
- [ ] AC2: Members are referenced as registry bot templates (`{ ref, version }`, bot-factory US-026) or embedded templates. Roles are team-local names (`planner`, `tracker`, `reporter`) and are the only way members refer to each other.
- [ ] AC3: Wiring is expressed between roles and portable events: `{ role: "tracker", on: { role: "planner", event: "completed" } }`, `{ on: { role: "watcher", event: "tool.gmail.search_emails" } }`, or a widget event by package and widget name. It never contains bot ids, dashboard ids, or provider names.
- [ ] AC4: **Export team** in the Bots tab builds the manifest from the current team, converting each member to a template (bot-factory US-026) and each bot-event subscription between members into role wiring, using the `source.ref` and `source.event` the event picker already stores. Install variables are suggested for values like project keys and channels.
- [ ] AC5: Teams publish with `type: "bot-team"` through the existing publish workflow, gated by `shareable`. Publishing validates the manifest and flags high-risk combinations per member (bot-factory US-026 AC5).
- [ ] AC6: A manifest never contains credentials, sessions, memory values, run history, grants, or local ids.

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-007: Install a team**

> As a team owner,
> I want to install a published team in one step and approve everything on one screen,
> so that I get a working team without configuring each bot.

**Priority:** P1
**Status:** Backlog

**Acceptance Criteria:**

- [ ] AC1: Installing a team targets a dashboard: an existing one, or a new empty dashboard named after the team.
- [ ] AC2: One **review screen** shows the team: each role with its bot's instructions, tier, schedules and triggers, the wiring as a simple diagram ("Planner → Tracker → Reporter"), providers needed, and estimated monthly cost.
- [ ] AC3: Shared install variables are asked **once** for the whole team and substituted into every member.
- [ ] AC4: One **access review**, grouped by member (bot-factory US-029): the user checks tools per bot, and grants stay per bot. Unchecking a required tool marks that member Limited or not runnable without blocking the rest.
- [ ] AC5: On install, each role becomes a **new, unique bot** (new id; `ref` = the member template's registry id) in the dashboard's team, **in setup state**. Wiring is resolved from roles to the new bots' event names (`bot:<ref>[<newBotId>].<event>`) and to this dashboard's widget instances.
- [ ] AC6: The team's lead brief is applied to the dashboard's lead (created if needed). An installed team never replaces an existing lead's settings without asking.
- [ ] AC7: A setup checklist (bot-factory US-027 AC5) completes setup. Members activate individually or all at once.
- [ ] AC8: The installed team records its source (`teamRef`, version) and which bot fills which role.

**Edge Cases:**

- A member template fails to resolve → the review shows it as unavailable; the team installs without that role and its wiring is reported as dropped.
- Installing into a dashboard that already has members → new members join the team; no existing bot is changed.
- Same team installed into two dashboards → two independent teams; nothing is shared.

**Example Scenario:**

```
User installs "Project Management Team" (lead + Planner, Tracker, Reporter)
into a new "PM" dashboard. Variables: jiraProject = "WEB", slackChannel =
"#web-standup". Access review: Tracker gets Jira read; Reporter gets Slack
send (external effect, approval required). After setup, Planner runs at 9am;
when it completes, Tracker runs; Reporter posts a standup draft awaiting
approval. User asks the Assistant: "How's the PM team doing?" → the PM lead
answers from today's runs.
```

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-008: Team controls**

> As a team owner,
> I want to pause, budget, and remove a team as a unit,
> so that I can manage it without touching each bot.

**Priority:** P1
**Status:** Backlog

**Acceptance Criteria:**

- [ ] AC1: **Pause team / Resume team** pauses or resumes every member and the lead (enforced at the permission gate, like per-bot pause).
- [ ] AC2: An optional **team budget** caps the combined monthly spend of the team's bots, on top of per-bot and global budgets; reaching it auto-pauses the team.
- [ ] AC3: **Remove team** offers: remove the installed members (and their grants and remembered approvals), or keep them as ordinary bots on the dashboard.
- [ ] AC4: The Activity feed groups runs by team and can show one team's chain of events ("Planner completed → Tracker ran → Reporter awaiting approval").

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**TEAM-011: Bots view — a dashboard's team, full screen**

> As a team owner,
> I want to switch a dashboard into a Bots view where I can see its whole team, pick a bot, talk to it, see what it did, and change it,
> so that working with bots has room to breathe instead of being squeezed into a modal tab or a side panel.

**Priority:** P1 (next after slice 2a; supersedes the slice 1–2a Bots tab and the side panel's chat)
**Status:** Implemented (B1–B3 + gaps; two small follow-ups noted below)
**Design:** clickable mockup — https://claude.ai/artifact/DmugteBVtFYEUBrAuo5KCE (Aurora look from `docs/design/dark-shell.html`)

**Acceptance Criteria:**

- [x] AC1: **Switch.** The dashboard header has a **Dashboard | Bots** segmented control next to the title. Bots replaces the whole stage (page tabs and widgets hidden) without leaving the dashboard; Dashboard brings them back. The Bots side shows a count of items that need the user (pending approvals, failed last runs). Not shown in popped-out widget windows.
- [x] AC2: **Team list (left).** The lead pinned first (marked "Lead"), then members — each with name, a one-line summary (providers · how it starts), and a status dot with a text label for screen readers (Idle, Running, Paused, Needs approval, Failed). **+ Add bot** opens a new bot in the selected-bot pane's Settings tab (inline, not a modal), already on this dashboard's team. A turned-off lead shows as "Team lead is off · Turn on".
- [x] AC3: **Selected bot (right).** A header with name, status chip, and a detail line, plus actions: **Run now** (not for the lead), **Pause / Resume**, and a ⋯ menu (lead: Turn off; members: Remove from team, Delete). Three tabs: **Conversation** (titled **Ask the lead** for the lead), **Activity**, **Settings**.
- [x] AC4: **Conversation tab.** The lead: Ask the lead (TEAM-003). Other bots: start a run with a prompt, then **reply to continue** it (the run's session is resumed — the reply-to-continue capability). Messages show compact tool-call rows (tool · provider · ok/failed), errors with a next step ("Reconnect Salesforce", "Run again"), the "triggered by …" chain, and **approvals inline** (Allow once · Always allow · Deny). Answers are plain text, never rendered as HTML.
- [x] AC5: **Composer and scrolling.** The input is pinned to the bottom of the pane; the conversation scrolls above it, newest at the bottom. It jumps to the newest message on send and on a new reply, unless the user has scrolled up — then a **"↓ New messages"** pill appears. Enter sends; Shift+Enter adds a line.
- [x] AC6: **Activity tab.** The bot's runs, newest first: when, trigger, status, and the answer's first line; opening a run shows the full answer, its tool calls, approvals, and any error. Answers stored with a key this app can't read show as unavailable.
- [x] AC7: **Settings tab.** The full bot form (the existing `BotDetail`) inline, with Save / Discard. Switching bots or views with unsaved changes asks first.
- [x] AC8: **Live.** Statuses, the conversation, and the Activity tab update as runs stream and approvals arrive — no manual refresh.
- [x] AC9: **Bot Activity side panel → global monitor.** The panel keeps: **Needs you** (approvals across all dashboards, each labelled with its dashboard), **Running now**, and **Recent** results, with **Open in Bots view** (switches that dashboard to Bots with the bot selected). The lead chat and the "Run a bot" form move out of the panel into the Bots view.
- [x] AC10: **Dashboard Config › Bots** becomes a short summary of the team with **Open in Bots view**.
- [x] AC11: **Narrow windows.** Below ~900 px the team list collapses into a bot picker above the selected bot.

**Edge Cases:**

- A dashboard with no members → the lead plus an empty state with **+ Add bot**.
- An unassigned bot isn't listed; the empty state links to moving one onto the team (its Team setting).
- A bot deleted elsewhere while selected → the selection falls back to the lead.
- Several approvals pending for one bot → shown in order in its conversation; the switch's count includes them all.

**Technical Notes:**

- Renderer components in dash-core (`src/Components/Bots/`): `BotsView`, `TeamList`, `BotConversation`, `BotRunHistory`; reuse `AskLead`, `BotDetail`, and the approval card. `DashboardStage` holds the Dashboard | Bots mode per dashboard.
- **Run history API:** `bots.getRuns(botId, { limit })` — decrypted run records (the store already seals answers at rest).
- **Conversations for non-lead bots** need more than the answer on each run record: the run's prompt and a compact tool-call summary (tool, provider, ok/failed — never raw results), both sealed at rest like answers. Reply-to-continue reuses `continueSession`.
- Design: list-left / detail-right, hairline glass cards, underline tabs, one primary action per view. The same design is planned for Dashboard Config later (out of scope here).

**Implementation notes (B2, Bots view UI, 2026-10-02):**

- `useTeamBots(workspaceId)` loads the team (lead + members), running, pause state, approvals and each bot's last run, and keeps them live from `onRunActive` / `onApprovalPending` / `onStream`. `DashboardStage` calls it once and feeds both the header badge and `BotsView`; `BotsTab` (Dashboard Config) uses it for its summary.
- Mode is per dashboard and only applies in preview: entering edit mode returns to Dashboard; popouts never offer it. Dashboard Config's **Open in Bots view** closes the modal and leaves edit mode through the existing unsaved-edits guard.
- Components shipped as `BotsView` (team list + selected bot), `BotChat` (conversation; named to avoid clashing with `botConversation.js` on case-insensitive filesystems) and `BotRunHistory`. The team list is inline in `BotsView` rather than a separate `TeamList`.
- `BotDetail` gained `onDirtyChange` for the Settings tab's unsaved-changes guard.
- Existing leads' generated instructions are upgraded in place (to point at the Bots view) by `ensureLead`; instructions the user edited are left alone.
- Gaps closed in the follow-up below.

**Implementation notes (B3, Bot monitor, 2026-10-02):**

- The Bot Activity panel is now a frame around dash-core's `BotMonitor` + `useBotMonitor`: **Needs you** (approvals on every dashboard, labelled "Bot · Dashboard"), **Running now** (with how long, and Stop), **Recent** (the last 10 runs across all bots, from the new `bots.listRecentRuns` IPC). The "Run a bot" form, live feed and lead chat were removed from the panel.
- **Open in Bots view** switches in place when it's the dashboard you're viewing; otherwise it opens that dashboard as a **popout** in the Bots view on the bot (Recent → Activity tab; Needs you / Running → Conversation). An already-open popout is focused and re-targeted. So the dashboard you're on — and any unsaved edits — is never touched. Bots on no dashboard offer **Open in Settings** instead.
- Popouts now offer the Dashboard | Bots switch and load team data; the lead is still only ensured in the main window. Popout options are validated in the main process (view, bot id, tab) before reaching the window URL.
- `BotsView` takes a `focus` request (`{ botId, tab, seq }`), applied once the team loads and through the unsaved-changes guard.
- Seen while testing (pre-existing, not B3): closing any dashboard popout drops MCP connections the main window's widgets share ("Connection closed").

**Implementation notes (gaps, 2026-10-02):**

- **Triggered by:** event runs record `source` ({ eventType, label, originBotId, chain }) — the label is the bot's own subscription label; the conversation and Activity show "Triggered by Gmail › new email" (and "· A → B" for a bot chain, with names). Runs from before this show the old "Triggered by an event".
- **Approvals per run:** the runner wraps its single approval channel (used by both the permission gate and the agent engine) and records each decision as `{ tool, provider, decision: allowed | allowed-always | denied }` — names only, never inputs. Remembered grants don't prompt, so they aren't listed. Note: the Agent SDK auto-approves read-only shell commands (e.g. `echo`) without asking, even under "ask".
- **Next steps on failures:** Run again (Ask again for a lead; a fresh run with the same prompt) always; **Open Settings › Providers** when the error points at a provider (an MCP server that couldn't start, an AI provider's key/credit/auth). This generalises AC4's "Reconnect <provider>".
- **Discard + leave guard:** the inline form has **Discard changes**; leaving the Bots view (header Dashboard switch or the edit button) with unsaved bot edits asks first.
- **Live Activity:** reloads when the bot's run finishes.
- **Follow-ups:** (1) ~~the team list doesn't refresh when a bot is created/deleted elsewhere~~ — fixed: the store announces definition changes and the main process broadcasts `bot-list-changed` (coalesced), so team lists, the monitor and the Bots view reload; (2) ~~switching/closing dashboard tabs with unsaved bot edits isn't guarded~~ — fixed: switching to another tab, closing the current tab, and opening another dashboard from the sidebar/recents/Settings ask first (the Assistant's open/close commands stay unguarded, like layout edits).

**Definition of Done:**

- [ ] Code implemented and reviewed
- [x] Unit tests pass
- [ ] Integration tests pass
- [x] Acceptance criteria verified
- [ ] Documentation updated

---

### Nice-to-Have (P2)

**TEAM-009: Team updates**

> As a team owner,
> I want to update an installed team when its publisher ships a new version,
> so that I get improvements without reinstalling.

**Priority:** P2
**Status:** Backlog

**Acceptance Criteria:**

- [ ] AC1: An update shows a per-role diff: added or removed roles, instruction changes, new wiring, and newly requested tools.
- [ ] AC2: Newly requested tools need consent (bot-factory US-029 AC9); local edits are preserved or shown as conflicts.
- [ ] AC3: Member template versions are pinned by the manifest, so a member template's own update never changes the team silently.

---

**TEAM-010: Lead coordination (exploratory)**

> As a team owner,
> I want the lead to hand work to the right member when I ask for something,
> so that I can treat the team as one assistant.

**Priority:** P2
**Status:** Backlog (exploratory; v1 leads answer and propose only)

**Acceptance Criteria:**

- [ ] AC1: With the user's opt-in per team, the lead may **ask a member to run** (`team_run_bot(role, prompt)`), which goes through the member's own grants, approvals, budget, and the chain/depth loop guard.
- [ ] AC2: The lead can never change a member's settings or grants; it can only propose changes (TEAM-005).

---

## Feature Requirements

### Functional Requirements

**FR-T01: Team model**

- **Description:** A team is a dashboard's bots (`bot.workspaceId`) plus an optional team record for metadata: lead, roles, installed source, budget.
- **Priority:** P0
- **Validation:** Unit tests for membership, moving bots in and out, dashboard delete and duplicate handling.

**FR-T02: Team lead**

- **Description:** Auto-created, idle-by-default lead bot per dashboard with read-only in-process team tools; at most one per dashboard; can be turned off.
- **Priority:** P0
- **Validation:** Unit tests for creation rules and tool scoping; integration test proving a never-engaged lead makes zero model calls.

**FR-T03: Team tools**

- **Description:** `team_list_bots`, `team_get_bot`, `team_recent_runs`, `team_memory_read`, `propose_bot` served in-process to leads, scoped to the lead's own dashboard; returned data fenced as untrusted.
- **Priority:** P0 (read tools), P1 (`propose_bot`)
- **Validation:** Unit tests for scoping (a lead can't read another team) and fencing.

**FR-T04: Assistant ↔ lead bridge**

- **Description:** Dash MCP tools `list_teams` and `ask_team_lead` (`electron/mcp/teamTools.js`).
- **Priority:** P0
- **Validation:** Tool handler tests; E2E: the Assistant answers a team question from a seeded run.

**FR-T05: Team manifest, export, and publish**

- **Description:** `.team.json` v1 schema and validation, Export team, registry `type: "bot-team"`.
- **Priority:** P1
- **Validation:** Schema tests; export round-trip (export → install → identical wiring by role).

**FR-T06: Team install**

- **Description:** Review screen, shared variables, grouped access review, role → bot resolution, wiring rewrite, setup state, checklist.
- **Priority:** P1
- **Validation:** Integration test installing a 3-role team end to end; wiring resolves to the new bots' event names.

**FR-T07: Team controls**

- **Description:** Team pause/resume, team budget, remove team, Activity grouping and chain view.
- **Priority:** P1
- **Validation:** Unit and integration tests mirroring bot-level pause and budget tests.

### Non-Functional Requirements

**NFR-T01: Consent**

- No lead, manifest, or install path writes grants the user didn't check. Remembered approvals ("Always allow") remain per bot.

**NFR-T02: Cost**

- Idle leads make zero model calls. Assistant fan-out to leads is capped per question.

**NFR-T03: Untrusted data**

- Everything a lead reads from runs, memory, and events is fenced as untrusted data.

**NFR-T04: Portability**

- Team logic in dash-core does not import Electron (bot-factory NFR-006), so teams work in the future headless runner.

---

## User Workflows

### Workflow 1: Install a team and ask about it

**Trigger:** User finds "Project Management Team" in the registry

**Steps:**

1. User clicks Install and chooses "New dashboard".
2. Review screen shows the lead and the Planner, Tracker, and Reporter roles, the wiring, and the cost estimate.
3. User fills in the shared variables once and checks tools per bot in the access review.
4. The team installs in setup state; the user completes the checklist and activates all members.
5. Next morning, the user asks the Assistant "what did the PM team do?"; the Assistant asks the PM lead and relays its answer.

**Success State:** Team runs on schedule and wiring; the lead answers from real runs.

**Error Scenarios:**

- A member's provider isn't configured → that member stays in setup; the others activate.
- Reporter's Slack send is unchecked → Reporter is not runnable; the lead mentions it when asked.

### Workflow 2: Grow a team by asking

**Trigger:** User asks the Sales lead "add a bot that follows up on renewal emails"

**Steps:**

1. Lead calls `propose_bot` and drafts a bot: Gmail search + read, subscribed to Inbox Watch's `tool.gmail.search_emails`.
2. The bot form opens prefilled, with the Gmail tools as pending suggestions.
3. User accepts the tools, tweaks the instructions, and saves.

**Success State:** New member on the Sales team, wired to Inbox Watch, with only the tools the user accepted.

---

## Design Considerations

### UI/UX Requirements

- **Dashboard Config › Bots** is the team's home: lead pinned first, then members, with **+ Add bot**, **Ask the lead**, **Export team**, **Pause team**.
- **Bot Activity panel**: **+ New bot** for the current dashboard, team grouping and filter, **Ask the lead**.
- **Settings › Bots**: all bots grouped by team, plus Unassigned.
- The lead's introduction is a dismissible card, never a modal.
- Everything uses `@trops/dash-react` primitives and the current design.

### Architecture Requirements

**Team record (v1)** — stored with bots; one per dashboard that has a lead or an installed team.

```json
{
  "id": "team_01J...",
  "workspaceId": "1774291410862",
  "leadBotId": "bot_...",
  "leadEnabled": true,
  "roles": {
    "planner": "bot_...",
    "tracker": "bot_...",
    "reporter": "bot_..."
  },
  "source": {
    "teamRef": "@trops/pm-team/ProjectManagementTeam",
    "version": "1.0.0"
  },
  "budget": { "monthly": 25 }
}
```

**Team Manifest Schema (`.team.json`, v1)**

```json
{
  "schemaVersion": 1,
  "type": "bot-team",
  "name": "Project Management Team",
  "version": "1.0.0",
  "author": "trops",
  "description": "Plans the day, tracks Jira, and posts a standup draft.",
  "tags": ["project-management", "jira", "slack"],
  "shareable": true,
  "variables": [
    { "key": "jiraProject", "label": "Jira project key", "type": "string" },
    { "key": "slackChannel", "label": "Standup channel", "type": "string" }
  ],
  "lead": {
    "brief": "You lead a PM team for {jiraProject}. Members: Planner, Tracker, Reporter."
  },
  "members": [
    {
      "role": "planner",
      "template": { "ref": "@trops/pm-bots/Planner", "version": "^1.0.0" }
    },
    {
      "role": "tracker",
      "template": { "ref": "@trops/pm-bots/JiraTracker", "version": "^1.2.0" }
    },
    {
      "role": "reporter",
      "embedded": {
        "type": "bot",
        "name": "Standup Reporter",
        "...": "bot template (bot-factory)"
      }
    }
  ],
  "wiring": [
    {
      "role": "tracker",
      "on": { "role": "planner", "event": "completed" },
      "prompt": "Update tracking for today's plan."
    },
    {
      "role": "reporter",
      "on": { "role": "tracker", "event": "completed" },
      "prompt": "Draft the standup for {slackChannel}."
    }
  ],
  "memory": { "keys": ["pm/*"] },
  "budget": { "suggestedMonthly": 20 }
}
```

- **Role resolution at install:** each role becomes a new bot. `on.role` + `on.event` becomes the subscription `{ eventType: "bot:<memberRef>[<newBotId>].<event>", source: { kind: "bot", ref, instanceId, event } }`, which is exactly the shape the event picker saves today.
- **Leads** are bots with `role: "lead"`; team tools are served in-process like `memory_*`, so they work on every engine.
- **Assistant bridge**: `electron/mcp/teamTools.js` alongside `dashboardTools.js`, `widgetTools.js`, etc.

### Dependencies

- bot-factory **US-012** (workspace memory), **US-014** (Activity Manager), **US-017** (Bot Builder chat, for TEAM-005's best experience), **US-026** (bot templates), **US-027** (setup checklist), **US-029** (access review)
- Shipped: event picker and bot events (`bot:<ref>[<botId>].<event>`, chain guard, dashboard scoping)

---

## Open Questions & Decisions

### Open Questions

None open. The six questions raised in the first draft were resolved on 2026-10-01 (see the last six rows of Decisions Made):

1. One team per dashboard, or several? → **One team per dashboard** (v1).
2. Create leads automatically? → **Yes, for every dashboard, idle until engaged.**
3. Can a lead direct members? → **No, answer and propose only** for v1; TEAM-010 stays exploratory.
4. Lead's default model? → **The user's default model source, fast tier.**
5. Assistant reach? → **All teams, with a capped fan-out per question.**
6. Unassigned (global) bots? → **Stay global** and keep working; they can be moved into a team.

### Decisions Made

| Date       | Decision                                                                            | Rationale                                                                 | Owner |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----- |
| 2026-10-01 | A team is a dashboard's bots; the dashboard is the team boundary                    | Matches bot-factory's workspace-as-team decision and event scoping        | John  |
| 2026-10-01 | Every dashboard gets a team lead (liaison), idle until engaged                      | One place to ask; zero cost until used                                    | John  |
| 2026-10-01 | The AI Assistant talks to team leads                                                | The Assistant stays the front door; leads hold team context               | John  |
| 2026-10-01 | Leads propose, users approve; leads never grant, install, or save bots              | Same declared-vs-granted model as templates and access review             | John  |
| 2026-10-01 | Teams are a registry asset (`.team.json`, `type: "bot-team"`)                       | Installing a whole team is far easier than assembling bots one by one     | John  |
| 2026-10-01 | Manifests refer to members by role; events by `ref` + portable event name           | Survives install (new bot ids) and works across users' providers          | John  |
| 2026-10-01 | Members stay unique bots with their own grants, approvals, and budgets              | Revoking one bot never affects its teammates                              | John  |
| 2026-10-01 | Bots can be created from the dashboard (Bots tab, Activity panel)                   | Bots belong to the dashboard they serve; Settings stays the all-bots view | John  |
| 2026-10-01 | One team per dashboard in v1                                                        | Simple; matches the dashboard boundary bots and events already use        | John  |
| 2026-10-01 | Leads are created automatically for every dashboard, idle until engaged             | Discoverable without setup; idle leads cost nothing                       | John  |
| 2026-10-01 | Leads answer and propose only in v1; directing members (TEAM-010) stays exploratory | Keeps choreography (events + memory) as the coordination model            | John  |
| 2026-10-01 | A lead defaults to the user's default model source, fast tier                       | Answering from team data is light work; no extra setup                    | John  |
| 2026-10-01 | The Assistant can reach every team, with a capped fan-out per question              | Cross-team answers are useful; the cap bounds cost and reach              | John  |
| 2026-10-01 | Unassigned (global) bots stay global and can be moved into a team                   | No forced migration; existing bots keep working                           | John  |

---

## Out of Scope

- Multi-user, shared, or cloud-hosted teams
- Leads acting on other dashboards' teams
- A team marketplace separate from the existing registry
- Automatic team creation from usage patterns

---

## Implementation Phases

### Phase 1: Teams you can talk to (P0)

**Stories:** TEAM-001, TEAM-002, TEAM-003, TEAM-004

**Deliverables:**

- [ ] Team model, Bots tab in Dashboard Config, + New bot in the Activity panel
- [ ] Lead auto-creation (idle), read-only team tools, Ask the lead
- [ ] `list_teams` / `ask_team_lead` on the Dash MCP server

### Phase 1.5: Bots view (P1)

**Stories:** TEAM-011

**Deliverables:**

- [ ] Dashboard | Bots switch; full-stage team list + selected bot (Conversation / Activity / Settings)
- [ ] `bots.getRuns`; run prompt + tool-call summary stored (sealed) for conversations; reply to continue
- [ ] Bot Activity side panel slimmed to a global monitor; Dashboard Config › Bots → summary + Open in Bots view

### Phase 2: Grow, share, and install teams (P1)

**Stories:** TEAM-005, TEAM-006, TEAM-007, TEAM-008

**Deliverables:**

- [ ] `propose_bot` and the prefilled bot form
- [ ] `.team.json` schema, Export team, publish
- [ ] Team install (review, shared variables, grouped access review, role wiring)
- [ ] Team pause, budget, remove; Activity grouping

**Depends on:** bot-factory US-026, US-027, US-029

### Phase 3: Evolve teams (P2)

**Stories:** TEAM-009, TEAM-010

---

## Testing Requirements

### Unit Tests

- [ ] Team membership from `workspaceId`; move in/out; dashboard delete/duplicate rules
- [ ] Lead creation rules (one per dashboard, turn off, global setting)
- [ ] Team tools scoped to the lead's own dashboard; data fenced as untrusted
- [ ] Manifest validation; role → bot resolution; wiring rewrite to `bot:<ref>[<botId>].<event>`
- [ ] `propose_bot` drafts only use existing providers and catalog events

### Integration Tests

- [ ] A never-engaged lead makes zero model calls across schedules and events
- [ ] Export → install round-trip preserves wiring by role
- [ ] Team pause stops every member at the gate; team budget auto-pauses

### E2E Tests

- [ ] Install a 3-role team into a new dashboard, complete setup, trigger the chain, see the Reporter's approval
- [ ] Ask the Assistant about a team and get the lead's answer
- [ ] Bots view: switch to Bots, pick a member, run it with a prompt, reply to continue, approve inline, see the run in Activity, edit and save in Settings

### Manual Testing

- [ ] Bots view: the composer stays pinned while a long conversation scrolls; "↓ New messages" appears when scrolled up
- [ ] Bots view at narrow widths (team list collapses to a picker)
- [ ] Lead introduction is clear and dismissible
- [ ] "Add a bot for me" produces a sensible, reviewable draft
- [ ] Access review for a team is understandable at a glance

---

## Revision History

| Version | Date       | Author | Changes                                                       |
| ------- | ---------- | ------ | ------------------------------------------------------------- |
| 1.0     | 2026-10-01 | John   | Initial draft                                                 |
| 1.1     | 2026-10-01 | John   | Resolved the six open questions (proposed answers accepted)   |
| 1.2     | 2026-10-02 | John   | Added TEAM-011 Bots view (from the approved mockup)           |
| 1.3     | 2026-10-02 | John   | TEAM-011 B2 (Bots view UI) implementation notes               |
| 1.4     | 2026-10-02 | John   | TEAM-011 gaps closed (triggers, approvals, next steps, guard) |
| 1.5     | 2026-10-02 | John   | TEAM-004 implemented (slice 2b: Assistant ↔ team leads)       |
