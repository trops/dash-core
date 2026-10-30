# PRD: Lead Workspace — Talk to Each Team Through Its Lead

**Status:** In Progress (release 3)
**Last Updated:** 2026-10-29
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

- **Teams first:** the Dash team, each dashboard's team (its lead, then its bots), "Dashboards with no bots" folded into one group, and "On no dashboard" (also leads whose dashboard is gone). Teams start closed; the picked team and any that needs you start open. Team rows show "N bots · Lead" and "N need(s) you" / "N running".
- **Needs you on top** of the tree: what each bot wants and its team; a click opens that bot inside its team.
- **Search** ("Search bots and teams…") and **status** (All / Needs you / Running / Paused) open only the teams that match; the Team filter is gone.
- **A team** shows its overview: Open conversation (its lead), Open dashboard, what needs you ("Answer in the conversation ›"), and Bots on this team (How it runs, Status, This month). The Dash team's adds Dash team settings. "Dashboards with no bots" lists those dashboards.
- **A bot** is management only: Activity, Log, Spending, Settings. Leads and bots on no dashboard keep Open conversation; a team member says "You talk to this team through X". A Dash team role shows its Activity and the team's Settings.
- **Each run links to the conversation it came from:** a lead-asked run records `conversationId` (the asking conversation, via `askLead` → the lead's run entry → `team_ask_bot`), and Activity's Open conversation opens that exact one; older runs open the lead's conversations.
- **Fixed on the way:** `team_ask_bot` read the lead's run entry object as its `via`, so a lead asked from outside Dash (MCP) could still run its bots; now `leadRunInfo` reads `via`.

### Release 6 — finishing

Smaller windows (35–36), light theme, carrying existing Dash team questions into Dash Lead conversations, removing old chat entry points. Split in three (approved 2026-10-29):

- **6a — smaller windows and light theme.** Below 1100px wide (`NARROW_AT`) the left column folds to "☰ <lead>" (a drawer over the conversation that closes when a conversation or lead is picked), and Outputs becomes an "Outputs N" button that slides over the conversation, with a dot when something needs you (a waiting approval for this conversation's bots, a provider the build waits for, or a preview to look at). Its × closes the outputs; the window's × moves to the header. No resize handle or Expand while folded. Growing the window brings the columns back. The drawers open under the header (☰ and Outputs stay in reach and say they're open), take focus and give it back; clicking beside one or Escape closes it — Escape never closes the window then. While one is open the window's × waits. `WorkspaceSide` reports `{ count, needsYou }` (`onSummary`).
- **6b — one way to talk.** A bot's page has no Conversation tab anywhere (Manage › Bots, the bot page from a notification, a dashboard's Bots view): Activity first; a lead or a bot on no dashboard has Open conversation, a team member says it's talked to through its lead; an old "conversation" request opens Activity. The Dash team page has no chat: its Activity and Settings, and Open conversation opens the Dash Lead (`openDashTeam()` too); its modal opens on Settings. The Dash Lead's Recents include questions once asked of a Dash team role (`role:planner`, …), so nothing asked before is lost — follow-ups go to the Dash Lead (a host's recipient wins over the saved one on reopen), and earlier answers keep who gave them (`by`, else the saved recipient). Any `role:*` conversation request opens as the Dash Lead's. In a dashboard's Bots view only the lead has "Ask the lead" (its conversation); members' "Conversation" actions are gone, and the view opens bots on Activity. A member on a dashboard with no lead says how to give it one. Moved to 6c: the dock's Create panel, which the Create window still folds plans into. `BotContacts` (the old dock list) is no longer mounted anywhere; its removal is left for a cleanup.
- **6c — the last Create doors** (frames 38–42, approved 2026-10-29; New Theme, frame 43, is left for a later round). Four PRs:
  - **6c-1 — New buttons and registry dashboards (frames 41, 42).** New Widget, New Bot and New Dashboard on their pages, and the Widgets page's "Describe it to the Dash team", open a new Dash Lead conversation that says what's made ("Making: a widget — from the Widgets page"), with that kind's greeting and starters and no Start from (New Dashboard has it since 6c-4) (`dash:open-workspace` `making: { kind, from }`, `workspaceStart.makingStart`). The first question tells the Dash Lead what's being made (AskStep `prepareFirst`); the chat shows it as typed. New conversation starts an ordinary one. Start from › A dashboard from the registry lists the registry's public dashboards on the right (`RegistryOutput`: who publishes it, its widgets and bots, what it needs; Use this). Picking one reads its package and opens it as a plan in a new conversation, as Open as a plan does (`registrySeed`, through Create's `starterToPlan`): "Read Home", then the lead asks whether to set it up. Nothing is installed until Yes, build it. The registry out of reach, or a package that can't be read, says so.
  - **6c-2 — an empty cell (frames 38, 39).**
    - **The door:** an empty cell's Build with AI, on the grid and in the Edit panel, opens a conversation with that dashboard's lead, or with the Dash Lead when it has none (`dash:open-workspace` `cell: { workspaceId, gridItemId, cellNumber, pageId, scope, span }`, no key; LeadWorkspace finds the lead once the leads are in).
    - **The conversation:** "For: Kitchen Sink — the empty cell in row 2, column 1" (with its size when it spans), "What should go in this cell?", the lead's greeting and starters (`cellStart`).
      - Its `about` is saved with the conversation, cell included. The note tells the lead to plan exactly one widget for that cell and to tell the Planner so.
      - A reopened conversation is still about its cell.
    - **The plan** is for that dashboard and cell (`planForCell`):
      - The card reads "Plan · 1 added, in the cell you picked" and the choice is **Yes, add it**.
      - The opened plan reads "Only the cell you picked changes", then Now and After on that grid and page, with only that cell filled.
      - Its rows: "Weather — in the empty cell, row 2", then "Everything else — unchanged".
    - **The build** is the cell build (`buildKind` "cell", `{ cell: true }`; the plan goes without `dashboard` and `cell`, `cellBuildPlan`):
      - It installs or builds, checks, and shows the preview in the conversation ("…before it goes in the cell you picked").
      - Once it's done, the editor puts it in the cell as an unsaved change (`dash:place-widget-in-cell`, as Create did). It isn't blocked by the dashboard's unsaved edits.
      - It's put in once it's done as the chat says it: finished, with anything failed left off, or waiting only for a provider.
      - Only an empty cell is ever filled (`cellPlacement.cellProblem`), so trying again never replaces a widget.
      - The editor says whether it went in through LayoutBuilder's new `onPlaced`: `true`, or why not — "preview" (not being edited), "gone", "taken", "unknown-widget" or "failed". No answer within 8 seconds counts as "no-answer" (the dashboard, or its page, isn't open).
      - The lead says "Weather is in the cell you picked. Save Kitchen Sink to keep it." and offers **Put it in again**, for edits that were cancelled. Otherwise it says why, and offers **Put it in the cell** where it can still go in.
      - A finished build that is reopened isn't put in again by itself; it offers Put it in the cell.
    - **A plan that doesn't fit one cell** (more widgets, a bot, a theme): the card says "Plan · doesn't fit one cell" and the opened plan lists each piece. It's checked as the cell build will check it (`validatePlan` with `cell`), so instead of Yes, add it there's **Ask the Planner to fix it**.
    - **Not done:** with no lead, the dashboard's name comes from the saved dashboard, which loads after the window opens. A question sent in that moment saves "Your dashboard" in its "For:" line.
  - **6c-3 — Change with AI (frame 40).**
    - **The doors:** every Change with AI door (the widget's ⋮ menu, the Edit panel and Ask AI, the error box, the Widgets page) opens a conversation about that widget instead of Create › Change. One event (`dash:edit-widget-with-ai`) sends `dash:open-workspace`'s `widget`. A widget on a dashboard is talked over with that dashboard's lead, or the Dash Lead when it has none. From the Widgets page, it's the Dash Lead.
    - **Which widget it is** is worked out as Create › Change did (`useWidgetTarget`): its component and package, its name, and the dashboards it's on.
      - The change goes in place ("update") when it's the user's own widget, from a package that can change in place. Otherwise it's saved as a new widget ("new").
      - A widget that isn't installed any more says so.
    - **The conversation:** "Changing: Weather — on Kitchen Sink", "What should change in Weather?", and the lead's greeting, which says where the change goes. From the error box, its one starter is "Fix the error so it works again".
      - The note tells the lead to read the widget, and to plan only that widget. On a dashboard, a change to only its settings is one piece with source **"settings"** and the settings that change. Otherwise the piece is source "update" (in place) or "new" (taking that copy's place).
      - What it's about is saved with the conversation (`about.widget`), with its settings now and their names.
    - **The plan** says which widget (`planForWidget` → `widgetChange`):
      - The card reads "Weather — changes", "Plan · 2 settings change" or "Plan · a change to what it does", and the button is **Yes, change it**.
      - The opened plan lists each setting as "Units — f → c" (a setting), then "Place and size — unchanged". A code change instead lists "What it does — the Builder changes it", then in place (where it's used) or a new widget (taking this copy's place).
      - A plan that's more than that widget says so, and is checked as its build will be, so instead of Yes there's **Ask the Planner to fix it**.
    - **A settings change** (new in this release; `teamPlan` source "settings", context `settings`; `planBuild` `opts.settings`, one "settings" step; `botController._planSetWidgetSettings`):
      - It sets only the settings the widget has on that item of its dashboard, as saved (`setWidgetPrefs`), and saves it. Nothing is built and no AI runs.
      - Unsaved edits on that dashboard come first.
      - The lead says "Weather's settings are changed on Kitchen Sink: Units and Forecast. Only this copy changed."
    - **A change to what it does** is Create's edit build (`opts.edit`): the Builder, the Checker, and the preview in the conversation ("…before Weather changes everywhere it's used" or "…before it's saved as a new widget").
      - Once it's done here: in place, `dash:widget-changed` and `dash:widgets-updated` ("Weather is updated — everywhere it's used shows the change").
      - A new widget made from one on a dashboard goes into that one's place through the editor (`dash:swap-widget-in-cell` with `onPlaced`, now answered by LayoutBuilder; only while editing). The lead says "Weather Hourly is in Weather's place on Kitchen Sink. Save Kitchen Sink to keep it." Otherwise it says why, and offers **Put it in its place**.
      - From the Widgets page, a new widget goes in your widgets.
    - **Review fixes:**
      - A settings change writes one copy only: that page's item (and the top-level mirror when it's the page shown), or the pinned sidebar's (`placeWidget.setItemPrefs`). It also matches a dashboard saved with the bare component name.
      - Only settings the widget has, with plain values (text up to 2,000 characters, a number, on/off), are set. Nothing is set when its settings can't be read. The plan flags a setting it doesn't have.
      - A settings change from the Widgets page doesn't fit, and asks the Planner to fix it.
      - A setting that looks like a key, token or password keeps its value out of the note and the saved conversation.
      - A choice setting shows its label.
      - When a change can go either way, the plan has a Switch, "Change Weather everywhere it's used". Off, it's saved as a new widget.
      - Signed out, with a widget the user may have published: "Sign in to change it in place", then the widget is worked out again.
      - **Edit the code yourself** (the Widget Builder by hand) is on the start of the conversation.
      - A widget with no settings isn't promised a settings change.
    - **Not done:** Create's code diff of the change (the preview runs it), and the Scout's "what it does now" card (the lead reads the widget).
  - **6c-4 — the Create window and the dock's Create panel removed.**
    - **Gone:** `CreateModal` and the screens only it used (plan, build, Scout, Change, Auto type, plan menu, starter cards, unfinished plans, plan sketch and preview, the bot form helpers, team context). Also gone: `CreateDockPanel` and its exports (`CreateDockPanel`, `openCreate`, `foldCreate`), and DashboardStage's `dash:open-create` listener and handlers.
    - **Kept and moved:** the Build log's Remove summary and Try the bots (`LeadWorkspace/BuildParts.js`), the unsaved-edits check (`LeadWorkspace/dirtyDashboard.js`), and `withoutPlan` (`askThread`). `themeFromPrompt` is kept for the theme round.
    - **The Create window's no-AI starts:** a blank dashboard and a dashboard file are on the conversation's Start from ("A blank dashboard", "A dashboard file"), and New Dashboard shows Start from too. DashboardStage's `handleStartWithoutAi` does them. Registry dashboards were already there (6c-1). Widget installs, the Widget Builder by hand, and themes are on the Widgets and Themes pages.
    - **A lead's hand-off from before release 3c** ("Plan this with the Dash team", `planWithDashTeam`): it opens a new Dash Lead conversation with the request, and the lead's note, in its reply box (`dash:open-workspace` `draft`). A bot is what's being made. The Widget Builder's "Ask the Dash team" does the same (dash-electron).
    - **Review fixes:**
      - The hand-off says which dashboard it's for.
      - The Planner points a new theme at Themes › New Theme; the text before is in its history.
      - User-facing text no longer names Create.
      - The Build-log parts are tested.
      - The no-AI starts nothing sends any more are gone (`handleStartWithoutAi` keeps blank and file; `createRouting` keeps `draftAge`).
      - New Dashboard's Start from leaves out Edit a widget.
    - **Unfinished Create plans (follow-up, 2026-10-30):**
      - The Dash Lead's Recents list the plans started in the Create window and never finished, tagged "From Create" with what became of them: a draft, or a build that stopped, was interrupted, had problems, or waits for a connection or a look. Built and removed ones are done (`isUnfinishedCreatePlan`, `questionThreads` `fromCreate`).
      - Opening one carries it on as a Dash Lead conversation (`saveCreateRecent` `carryFrom` → `CreateRecent.carryOver`): what was said, the plan on the right, and its build with its own choices (Try again, Leave it off, Carry on building). The build record moves to the new conversation, and the old entry goes once that's saved. Not while it's still building.
      - **Review fixes:**
        - The carry is one write (`carryOver`), and the plan's memory (what the team noted) moves with it.
        - One closed before it was planned carries what was asked, and offers to plan it.
        - A failed carry says why, even with another conversation open.
        - A second click doesn't carry it twice.
        - The carried plan keeps its date, so it isn't news in the notifications panel.
        - **A build nothing runs any more** (saved before a restart, or carried from Create): `getPlanBuild` says `restored`, and where its own controls can't run — Try again, Looks good, a provider connected — the chat offers **Carry on building**. This also fixes it for workspace builds after a restart.
    - **Not carried over:** theme from a description (kept for the theme round), the starters gallery (the registry list covers it), and the bot form for a bot on no dashboard (a dashboard's Bots view › Add bot has it).

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

### Release 3a — the plan in the conversation (2026-10-29)

- The Planner's plan rides on its hand-off step (`handoffSteps.withResult` keeps `plan`, shows its words without the JSON). The latest one is the conversation's plan (`workspacePlan.js`); `useWorkspacePlan` holds it with the user's changes (remove, Swap, a provider picked) and Before it builds, saved with the conversation as `conversation.workspacePlan` (Recents tag it "Plan" — `createRecent` `planned`).
- In the chat (`PlanViews.js`): the plan's card under the Planner's step (opens it on the right); under the lead's answer, the Planner's questions as taps or **Yes, build it** / **Change something** (the reply box). A typed reply takes the plan as it stands and the changes along (`withPlanContext`), so a change reaches the Planner whole.
- On the right: the plan as an output (`PlanOutput`: pieces with Swap / remove, sketch, what to expect) and **Before it builds** (Create's checklist and dialogs; each item says "Planner · Dash team"); the Planner's row opens the plan.
- Shared with Create: the plan's pieces, checklist rows and What to expect moved to `Create/PlanParts.js` (CreatePlanStep uses them; its tests unchanged).
- The Dash Lead's instructions: the plan shows beside its answer with Yes, build it — summarise and ask, don't repeat it; changes go back to the Planner with the plan. Release 1's text is in its history, so a generated Dash Lead upgrades.
- Until 3b: **Yes, build it** opens Create's build with the plan, what's already done (`seed.checks`) and the user's words (`seed.messages`); the workspace closes so one window shows at a time. The conversation remembers it was sent (`workspacePlan.sent`, saved at once): reopened, it says "Sent to Create to build" instead of offering it again.
- Review fixes: while the lead is still answering the plan can't be changed (a new one may come — `stillAnswering`); the plan on the right has its own Yes, build it, so a chat ending on "Stopped." or an unrelated answer doesn't strand it; the choices show only under the answer to the same question as the plan; a plan that arrives after the window closed keeps what was done before building; the Planner's questions say who asks; a broken plan is described in plain words and its problems go to the lead unseen; the last change is saved when the window closes; step ids stay unique across reopens.

### Release 3a — matching the mockup (2026-10-29)

A screenshot-to-mockup check after merging found the workspace off the approved frames; fixed:

- The switcher's list scrolls inside the window, each lead with its avatar and the current one ticked; under the name at the top, who's on the team (`workspaceContacts` `line`).
- A new Dash Lead conversation (frame 13): the mockup's words and starters (outlined), a New conversation row in Recents, and **Start from** on the right — Describe it (the box), a dashboard from the registry (Create's starters until release 6), copy a dashboard (the Dashboards page) and edit a widget (the Widgets page), via `onOpenPage`.
- The right column in the mockup's order: Outputs, Before it builds (a warn-bordered box, a row per item with its mark, who asks and its action — `PlanChecklistRows rows`), approvals, output cards (icon tile and kind — `OutputCard`), a divider, the team (Scout, Planner, Builder, Checker; ready / done / waiting with each role's line; Findings ›, Plan › in the link colour), and Providers.
- The opened plan is read only (frame 6): a line ("2 widgets · uses Home Assistant") and a row per widget or bot with a warning row per provider to connect; changes are asked for in the chat. An earlier plan keeps its card in the chat and opens read only.
- Change something is a bordered button; Expand is "⇤ Expand"; expanded, the column is 760 wide (at most half the screen); the close is a plain ×; the reply box says "Reply" with no hint line.
- Left as they are: the lead's reply keeps dash-react's ChatMessage box, the composer keeps its Ask button and the drag edge has no grip (dash-react primitives).
- A second check found: the cards' fill and tile, the link colour (Aurora role classes), the Planner's line ("drafted a plan — 2 widgets", not its first words), the Scout "not needed" when the plan came without it, hollow ○ for what's still to do, and the chat now follows its newest message (AskStep) so the reply choices are never below the fold.

### Release 3b — building in the conversation (2026-10-29)

Frames 3, 4, 7, 8, 31, 33.

- **Yes, build it** builds the plan in the conversation; the workspace stays open. What's left to review (installs, the Planner's approvals) opens first, one window at a time, as in Create (`BuildWalk`). A provider still to connect doesn't hold it up: what needs it waits, and it shows under **Needs you** with Connect (`BuildNeedsYou`). Once it's connected, here or anywhere, the waiting steps carry on by themselves.
- Which build a plan gets (`workspaceBuild.buildKind`): one new widget and nothing else is built like Create's widget on its own (`cell` + `standalone`) and waits on its live preview (frame 31: Looks good in the chat, or the preview on the right with Change something); one bot alone is a bot build; anything else builds a dashboard. A dashboard build doesn't stop for previews (decided for release 3).
- The build is the main process's plan build, kept on the conversation (`recentId`), so a reopened conversation, or one opened after a restart, picks it up. The conversation keeps its builds in `workspacePlan.builds` (`{ buildId, stepId, at, kind, leftOff }`): each shows after the message it started from, and earlier ones (a plan changed since) stay as they ended. A changed plan's build reuses what the earlier one made (`resumeFrom`), or starts fresh when it can't.
- In the chat (`BuildInChat`): "Yes, build it", the build's step line, its card (the dashboard, the widget or the bot), and the Dash Lead's words, written from the build's state, with no AI call per update. The reply choices:
  - Open <dashboard> when it's built;
  - Try again / Let the Builder fix it / Leave it off when a step fails (frame 33);
  - Looks good / Change something at a preview;
  - Carry on building when it stopped or the app closed mid-build.

  **Leave it off** is the conversation's own: the failed piece, and what was skipped because of it, count as left off, and the build reads as built ("Built · Camera strip left off").
- While it builds, the reply box says what's going on ("The team is working · the Builder is building 2 widgets"), and its Stop stops the build (AskStep `working`; `follow` keeps the chat on the newest step).
- On the right:
  - the plan's line follows the build ("Building · 3 of 7 done", "4 of 7 done · 1 failed", "Built");
  - the built dashboard is an output;
  - the Builder and Checker follow the build: working with their live line, failed with why, done with their tokens. Build log › opens a time and a line per step, then the new bots to try (Create's `TryBots`) and Remove what was built. Report › opens the Check report.
  - Before it builds goes once it builds; Providers says connected only when a provider really is (a skipped connect isn't).
- Shared with Create: the build subscription and its actions (`usePlanBuild`, now used by CreateBuildingStep too), Try the bots (`TryBots`), the unsaved-edits check (`dirtyDashboardId`).
- Recents tag a conversation by its build ("Building", "Built", "Built, with problems"…): `createRecent` `built`.
- The Dash Lead's instructions: it says the plan changed only when the Planner's answer has a new plan in it, and that a yes builds right there. 3a's text is kept in its history, so a generated Dash Lead upgrades.
- Seen live and in review, fixed: "Checker checked it" for one widget; the Build log in words (no draft or package ids); the Check report's first sentence only; the Planner's step says "drafted a plan"; the Checker "stopped" (and no Report ›) when a build stops before it checks; at a preview the Builder is "waiting for you" with Preview › (frame 31); the Builder's live line skips its memory notes; an opened output keeps ← Outputs and Expand in place and starts at its top; Yes, build it can't start two builds ("Starting the build…"); a build that started as the user switched conversation isn't added to the new one; each build keeps how it ended (`last`), so an earlier build still shows after a restart; a waiting provider resumes the build once per change in what's connected (never in a loop, and only for real provider types); after Remove what was built, **Build it again**; stopped before anything was built, "Start it again"; Recents count what was left off as built, and say Removed.
- Found live, not 3b: an AI-built widget that throws when it renders passes the Checker, and its preview stays on "Preview ready." with no error (CellPreview / the preview host — Create's widget preview too); the Planner, asked by the Dash Lead, says it can't use its memory tools.
- Not in 3b: the Bots' own rows during a build (a bot waiting for a provider shows under Needs you, not as a team row), and the mockup's per-piece counts ("2 of 5"), which count steps instead.

### Release 3c — leads bring in the Dash team; Create opens here; changes before and after (2026-10-29)

Frames 13, 18, 30.

- **A dashboard's lead brings in the Dash team** in its own conversation (frame 18):
  - It has a new team tool, `team_ask_dash_team` (the Planner or the Scout). botController `_leadAskDashTeam` asks the role through `_askRole`: the role only answers, and the call counts with the lead's other hand-offs. The lead's dashboard goes with the request, so the plan goes on it (`plan.dashboard`), and stopping the lead stops the role (`_leadAsked`).
  - The lead's instructions say to bring the team in, not to end with a `<handoff>` for Create. The release 1 text is kept in its history, so generated leads upgrade; old conversations keep their button.
  - The step reads "Brought in the Dash team · asked the Planner" (`handoffSteps`, `dashTeam`).
  - On the right, under the lead's own bots (now "not needed" for that plan), a group "Dash team · brought in by Kitchen Sink Lead" with the Scout, Planner, Builder and Checker indented.
  - The plan, Yes, build it and the build are 3a's and 3b's, and stay in the lead's conversation and Recents.
- **Making something starts a new Dash Lead conversation** (frame 13): the sidebar's Create, the rail's +, New Dashboard (the empty screen and the palette) and ⌘N / Ctrl+N (`openDashLead`).
  - **Open as a plan**, from the Dash team's chats on the Bots page and a bot's page, carries the plan on as a new Dash Lead conversation (`dash:open-workspace` with a `seed`; `workspacePlan.seedConversation`: the user's words, the Planner's answers as steps, the last one bringing the plan, and the lead asking whether to build).
  - An empty cell, Change with AI, the pages' own New buttons and Start from's registry dashboards still open Create, until release 6.
- **A plan for a dashboard the user has shows what changes** (frame 30, additions only for now):
  - **The opened plan:** "Planner · the changes", "Kitchen Sink — changes", "Nothing changes until you say yes"; then the dashboard's grid **Now** and **After** (`planChanges`, read through `useDashboard`), with each addition in the next free cell of the page it shows, or a new row when the grid is full, as the build places it. Then a row per addition and one for what's unchanged.
  - **The plan card** reads "Plan · 1 added · on Kitchen Sink", and the choices say **Yes, make the changes**.
- **Fixed after live testing and review:**
  - The Planner's plan for a lead always goes on the lead's dashboard: one that leaves `dashboard` out gets it (`leadAsk.withPlanDashboard`).
  - Stop reaches only a role the lead really started.
  - The group lists only the roles in it (asked, building, or the Builder waiting for the yes), matched by their Dash team steps; the Planner's link says **Changes ›**, and the chat's card "Kitchen Sink — changes".
  - The grids keep spanned cells in place, and treat a cell as empty exactly as the build does.
  - A change that fills no cell (a new bot, a theme) has its rows and no grids, and its card says what it makes.
  - Once it's built, the plan shows no before and after (the dashboard has it now).
  - The grids say "added" and "empty cell" to screen readers.
  - A plan from Open as a plan that can't be saved says so.
  - The dock's **Make something new…** starts a Dash Lead conversation too.
  - Leads don't name the button to press.
- **A choice made here:** frame 18 shows a new widget on a lead's dashboard as a plain plan, and frame 30 shows a change with before and after. Every plan for a dashboard the user has gets the before and after, the approved release 3 default.

### Release 4 — the bot notifications panel (2026-10-29)

Frames 22, 27–29.

- **The right rail's robot opens one panel for every dashboard** (`Bots/BotNotifications/BotNotificationsPanel`, hosted by dash-electron's `AssistantDock` in place of the old bot list):
  - The header is the shown dashboard's lead, with **Open conversation with <lead>**. Off a dashboard, it reads "Bot notifications".
  - **Needs you · N** (`needsYou.js`), newest first. Each item says which bot is asking and which dashboard it's on (tagged when it isn't the shown one), when, and NEW since the user last looked:
    - **Approvals:** Allow once / Deny.
    - **A bot whose latest run failed** in the last 7 days (not leads, not the Dash team, not while it runs again): **Retry**, or **Reconnect**, which opens the Providers page on its provider when it has one (a connection problem, read from the error as Bots does).
    - **A plan waiting for a yes** (a conversation with a plan and no build, in the last 7 days): **Review in conversation** opens that conversation (`dash:open-workspace` with `recentId`). It says which conversation.

    Details opens the lead's conversation, or a lone bot's page.
  - **Activity** (`activityLog.js`): a line per run, from this dashboard by default or **All**, each tagged; a lead's run opens its conversation.
  - **Nothing pending:** "Nothing needs you right now."
- **The panel opens by itself** when something new needs the user (not while editing a dashboard, never in a popout). The rail's robot shows a dot while anything does.
- **Small doors:** `dash:open-page` (`{ page: "providers", providerName? }` | `{ page: "bots" }`) for the panel; the workspace opens on a conversation (`request.recentId`).
- **Unchanged:** OS notifications; clicking one opens the panel, and the bot's conversation or page.
- **Fixed after live testing and review:**
  - It opens by itself only for what arrives after the dock mounted (not as its lists load, nor after leaving Edit).
  - A bot running again isn't listed as failed (`listRunning`'s ids).
  - A plan's time is when it came in (`workspacePlan.madeAt`, Recent's `plannedAt`), not the conversation's last change, and its title is the plan's name (`planName`).
  - Approvals say what the bot wants to do; "Reconnect Gmail" when the provider is known.
  - Failure text drops the engine's wrapper and is kept short; a failed bot's Details opens its page.
  - Under All, only other dashboards are tagged.
  - One Dash team read instead of a second set of every list; NEW is a pill; the footer is a link; `dash:open-page` is subscribed once.
