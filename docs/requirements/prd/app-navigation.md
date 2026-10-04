# PRD: App Navigation — Manage pages in the left nav

**Status:** In Progress (slices 1–2 implemented)
**Last Updated:** 2026-10-03
**Owner:** John
**Related PRDs:** [bot-teams.md](./bot-teams.md) (Bots view, TEAM-011), [command-palette-navigation.md](./command-palette-navigation.md), [widget-installation-model.md](./widget-installation-model.md), [scoped-widget-ids.md](./scoped-widget-ids.md)

**Design:** clickable mockup — https://claude.ai/artifact/AuwfuE2BWJcqzPBRBKQToF (approved 2026-10-03; Aurora look from dash-electron `docs/design/dark-shell.html`)

---

## Executive Summary

Dash's left sidebar lists only dashboards; every other first-class area — Bots, Providers, Widgets, Themes, and dashboard management — is hidden inside the Settings modal. This PRD adds a **Manage** group to the sidebar (Dashboards, Bots, Providers, Widgets, Themes). Each opens **full-screen in the main area as a tab** beside open dashboards, with a consistent **list + detail** layout, search and filters. Settings keeps only true settings.

---

## Context & Background

### Problem Statement

Bots, providers and widgets are now core workflows — bots use providers, run on schedules and events and wait for approvals; widgets are installed, updated and published — yet they live behind the user menu → Settings, in a modal. Users can't keep them open next to a dashboard, links from the Bots view ("Open Settings › Providers") open a modal on top of a full-screen view, and nothing in the sidebar shows that anything needs attention.

**Who experiences this problem?**

- Primary: people building and running dashboards with bots (need Bots, Providers often).
- Secondary: widget authors (install, update, publish packages).

**What happens if we don't solve it?** The big areas stay undiscoverable, modal-in-modal flows multiply as features grow, and attention states (a bot waiting for approval, a provider needing sign-in) are invisible until the user goes looking.

### Current State

- `Navigation/DashSidebar.js`: Search, "+ New Dashboard", Recents, dashboards by folder; Settings only via the user menu. Collapsed, only Search and New show.
- `Navigation/DashTabBar.js` + `Dashboard/DashboardStage.js`: tabs are always dashboards (`{ id: workspace.id, name, workspace }`); restore drops ids that aren't dashboards; much of the stage assumes a dashboard is selected; the tab bar only renders when one is.
- `Settings/AppSettingsModal.js`: 12 hard-coded sections. Most use `Settings/SectionLayout.js` (list + detail) and don't depend on the modal (no close callback), so they can render full-screen.
- ~10 callers use `openAppSettings(section, …)` (Bots view next steps, Draft banner, command palette, Bot Activity panel, `dash:open-settings-create-provider`).

**Limitations:** no non-dashboard full-screen view; the Settings modal is the only home for app areas; no attention indicators in the nav.

---

## Goals & Success Metrics

### Primary Goals

1. **Big areas are one click away** — Dashboards, Bots, Providers, Widgets, Themes are in the sidebar, expanded and collapsed.
2. **Work side by side** — pages open as tabs next to dashboards and survive restart.
3. **One consistent layout** — every Manage page is list + detail with search and filters that scale to many items.
4. **Settings is settings** — General, Account, Notifications, MCP Server, AI Assistant, Privacy & Security only.

### Success Metrics

| Metric                                                                           | Target                                 | How Measured                       |
| -------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Clicks from a dashboard to Providers                                             | 1 (was 3: menu → Settings → Providers) | Manual walkthrough                 |
| "Open Settings › X" links that open a modal over a full-screen view              | 0                                      | Audit of `openAppSettings` callers |
| Manage pages using list + detail with full-height, independently scrolling panes | 5 / 5                                  | Screenshots                        |

### Non-Goals

- Redesigning the Settings modal itself (it keeps its current look; slimmer).
- Changing dashboard editing, the per-dashboard Bots view, or Dashboard Config.
- Publishing bots to the registry (naming only is prepared here; publish is its own PRD).

---

## User Stories

### Must-Have (P0)

**NAV-001: Manage group in the sidebar**
As a user, I want Dashboards, Bots, Providers, Widgets and Themes in the left nav so I can reach them in one click.

**Acceptance Criteria:**

- [ ] AC1: The sidebar shows a **Manage** group (Dashboards, Bots, Providers, Widgets, Themes) below the Dashboards group (New dashboard + Recents + folders, unchanged).
- [ ] AC2: Collapsed, every Manage item stays visible as an icon with its label as a tooltip.
- [ ] AC3: Bots shows an amber dot + count when bots need approval; Providers when providers need setup or sign-in.
- [ ] AC4: The item for the active page tab is highlighted, like the active dashboard.
- [ ] AC5: Built from dash-react `Sidebar` primitives and theme tokens (no bare colours).

**NAV-002: Pages open as tabs**
As a user, I want a Manage page to open as a tab beside my dashboards so I can switch between them.

**Acceptance Criteria:**

- [ ] AC1: Tabs carry a kind: `{ kind: "dashboard" | "page", id, name, workspace? }`; page ids are `page:<key>` (`page:bots`, …).
- [ ] AC2: One tab per page: clicking a Manage item opens its tab, or switches to it if open.
- [ ] AC3: Page tabs close like dashboard tabs and are saved/restored with the session (unknown page keys are dropped).
- [ ] AC4: The tab bar shows whenever any tab is open (not only when a dashboard is); page tabs show the page's icon.
- [ ] AC5: Dashboard-only behaviour (header, page tabs, dashboard theme, Bots view mode, team lead, recents, missing-widget/config banners) runs only for dashboard tabs.
- [ ] AC6: Switching tabs with unsaved dashboard edits asks first (closes today's gap where switching wasn't guarded).

**NAV-003: Full-screen page host**
As a user, I want Manage pages to use the whole main area in a consistent layout.

**Acceptance Criteria:**

- [ ] AC1: A page host renders the page in the **app theme** (outside `DashboardThemeProvider`).
- [ ] AC2: Page header: small "Manage" label, title, one-line description, and the page's primary action (New provider, New bot, Install widget, New theme, New dashboard / New folder).
- [ ] AC3: List + detail pages: the filter bar stays fixed; the list and the detail panel fill the remaining height and scroll independently; the detail panel doesn't change size with its content.

**NAV-004: Settings keeps only settings; links follow the move**
**Acceptance Criteria:**

- [ ] AC1: The Settings modal lists General, Account, Notifications, MCP Server, AI Assistant, Privacy & Security.
- [ ] AC2: `openAppSettings("bots" | "providers" | "widgets" | "themes" | "dashboards" | "folders")` opens the matching page tab instead (provider deep links — name/type/class, create — still work).
- [ ] AC3: The command palette gains "Go to Dashboards / Bots / Providers / Widgets / Themes".

**NAV-005: Dashboards page**
**Acceptance Criteria:**

- [ ] AC1: List of dashboards grouped by folder (colour, page and widget counts, attention dot); search across dashboard and widget names; **Folder** filter (see NAV-010).
- [ ] AC2: Detail: folder and theme, attention line, a layout preview of the first page, pages, widgets (with their package), bots (team, with status), providers used.
- [ ] AC3: Actions: Open (as a tab), Bots view, Dashboard Config; page actions New dashboard, New folder; folder management (rename, delete, move) replaces Settings › Folders.

**NAV-006: Bots page**
**Acceptance Criteria:**

- [x] AC1: List grouped by team (dashboard), each bot with an avatar (generic for now), name, trigger summary and status dot; search; **Team** filter (NAV-010); status chips (Needs approval, Running, Paused).
- [x] AC2: Detail: avatar, name, widget-style name (`local/<slug>` now; `@org/<slug>` once publishing exists), team, schedule/events, providers + tools, last run, pending approval inline.
- [x] AC3: Actions: Open in the team's Bots view, Run now (not for leads), Edit; New bot.

**NAV-007: Providers page**
**Acceptance Criteria:**

- [x] AC1: Today's Providers section full-screen (list + detail), with status (Connected / Needs a token / Sign in again). _(Needs setup / Connected / Starts when used / Saved; "Sign in again" deferred — not detectable without connecting.)_
- [x] AC2: Deep links from the Bots view and elsewhere open the provider selected (and the create flow when asked).

**NAV-008: Widgets page**
**Acceptance Criteria:**

- [x] AC1: The list mirrors the hierarchy **org → package → widgets**: org headings; package rows (widget count, version, Yours marker, amber dot for update available / unpublished changes) that expand to their widget rows.
- [x] AC2: Search matches package and widget names; **Org** filter (NAV-010); chips In use / Not used / Mine.
- [x] AC3: Package detail: full name, version and source, description, its widgets (each selectable), used on (dashboards, Open), needs providers, permissions; actions Update to vX (others' packages) and Uninstall.
- [ ] AC4: Widget detail: link back to its package, used on, needs providers, permissions; Add to dashboard. _(Done except Add to dashboard — deferred to the live-preview slice.)_

**NAV-009: Themes page**
**Acceptance Criteria:**

- [x] AC1: List with a colour strip per theme, mode, and App theme / used-by count; search; Dark / Light chips. _(Chips are In use / Not used; Dark / Light is the app-wide switch plus a preview toggle — every theme has both variants.)_
- [x] AC2: Detail: a dashboard preview drawn in the theme, the palette (roles + hex), used by (dashboards, Open).
- [x] AC3: Actions: Use as app theme (or "Active"), Edit theme (opens the theme editor), Duplicate; New theme.

### Should-Have (P1)

**NAV-010: Filter menu primitive (dash-react)** — open-ended filters (Org, Team, Folder) are one dropdown button with a searchable, multi-select menu with counts; the button reads "Org: @acme" / "Org: 3 selected" with a clear button. Small fixed sets stay as chips. Added to dash-react first, then used by dash-core.

**NAV-011: Live widget preview** _(slice A implemented 2026-10-04; Add to dashboard is slice B)_ — the widget detail renders the selected widget live in an isolated frame (the AI Widget Builder's `evaluateBundle` path with error isolation), using the user's providers; a widget whose provider isn't set up shows "Needs a <type> provider to show live data".

**NAV-012: Authoring actions** — for packages the user authored: AI-built drafts get **Publish…** and **Edit in Widget Builder**; published packages get **Publish vX.Y.Z** when changed since the last publish (else **Publish new version…**) and **Edit in Widget Builder**; the widget detail gets **Edit in Widget Builder**. Requires `deriveWidgetOwnership` to recognise packages owned by an org the user belongs to (known gap).

### Nice-to-Have (P2)

**NAV-013: Collapsible org sections** on Widgets when the list is long.
**NAV-014: Bot avatars** chosen by the user (image or icon + colour) instead of the generic one.

---

## Design Considerations

### UI/UX Requirements

- Matches the approved mockup and the Bots view: theme tokens via `useConfigTokens`-style hooks, dash-react `SectionLabel`, `Button`/`Button3`, hairline cards; respect the Tailwind safelist (no opacity modifiers or arbitrary values).
- Pages render in the app theme; dashboards keep their own theme.

### Architecture Requirements

- Tab model generalised in `DashboardStage` (kind + id); a `pages` registry (key, label, icon, component, primary action, attention source) so the sidebar, tab bar, palette and `openAppSettings` share one list.
- Pages reuse the existing Settings section components first (slice 1), then get the list + detail redesign per page.

### Dependencies

- dash-react: `Sidebar` primitives (exist); new filter menu (NAV-010).
- `deriveWidgetOwnership` org-membership fix (NAV-012).

---

## Open Questions & Decisions

### Open Questions

1. Does "Use as app theme" replace the current theme picker in the user menu's Light/Dark toggle, or sit alongside it?
2. Bot avatar storage (NAV-014): on the bot definition, or derived?

### Decisions Made

- Pages open as tabs (one per page), not as a separate view mode. (2026-10-03)
- All five Manage pages use list + detail (Bots: list only, no card view). (2026-10-03)
- Open-ended filters are a searchable multi-select dropdown; fixed small sets are chips. (2026-10-03)
- Widgets list shows org → package → widgets; packages are the publish/install unit, widgets the placeable unit. (2026-10-03)
- Dashboards and Folders leave Settings for the Dashboards page. (2026-10-03)

---

## Out of Scope

- Publishing bots to the registry; a Home page; restyling the Settings modal.

---

## Implementation Phases

### Phase 1 (slice 1): Navigation + page tabs

NAV-001, NAV-002, NAV-003, NAV-004 (AC1–AC2), with Bots / Providers / Widgets / Themes rendering today's Settings sections full-screen; Dashboards page shows today's Dashboards + Folders sections until slice 2.

**Implementation notes (slice 1, 2026-10-03):**

- `Navigation/appPages.js` is the one list of Manage pages (key, label, icon, description, which Settings sections moved there); `Navigation/tabModel.js` has the pure open / close / restore helpers.
- Page tabs live in `openTabs` beside dashboards as `{ id: "page:<key>", kind: "page", pageKey, name }` with **no `workspace`**, so `workspaceSelected` is null while a page is active and everything dashboard-only (header, page tabs, dashboard theme, Bots view, team lead, banners, widget sidebar) switches off without per-site checks. Name-based closes (`dash:close-dashboard`) only match dashboard tabs; workspace reloads match tabs by numeric id, which page ids never hit.
- `AppPages/AppPage.js` hosts a page outside `DashboardThemeProvider` (app theme): Manage label, title, description, primary action (New Bot / Provider / Widget / Theme / Dashboard / Folder), then the existing Settings section full-height. Dashboards has a Dashboards / Folders switch until slice 2.
- `DashSidebar` gets the **Manage** group after Recents (before folder groups, so it stays near the top). The attention dot sits on the icon so it shows collapsed; the count shows as the badge when expanded. Bots' count comes from `Bots/usePendingApprovalCount` (re-reads `listApprovals` on approval / run / bot-list / stream-end events). Providers' dot needs a provider-status source — deferred to the Providers redesign.
- `DashTabBar` renders whenever any tab is open (moved out of the dashboard branch); page tabs show their icon.
- Session save keeps page ids; restore uses `restoreTabs` (drops missing dashboards and unknown pages). Fixed a pre-existing bug found in the live check: the save effect ran on first render with no tabs and overwrote the saved session before restore read it (restore waits for dashboards to load), so tabs never came back after a restart. Saving now waits until restore has run (`sessionReady`).
- `openAppSettings` sends `dashboards` / `folders` / `providers` / `bots` / `widgets` / `themes` to the page tab (provider name / create / type / class ride along as a `providerLink` with a nonce that remounts ProvidersSection). The `dash:open-settings-create-provider` listener calls it through a ref so it sees the current tab and unsaved-edit state.
- `AppSettingsModal` now lists General, Account, Notifications, MCP Server, AI Assistant, Privacy & Security; the props only the moved sections used were removed.
- Unsaved-edit guard: switching tabs and opening a page now ask first when a dashboard has unsaved layout edits (`switch-tab` / `open-page` pending kinds), after the existing bot-edit guard.

### Phase 2 (slice 2): Dashboards page

NAV-005, NAV-004 AC3 (palette). NAV-010 (`FilterMenu`) moved up into this slice — dash-react first.

**Implementation notes (slice 2, 2026-10-03):**

- **dash-react `FilterMenu`** (NAV-010): searchable multi-select for open-ended lists — button reads "Folder" / "Folder: Work" / "Folder: 3 selected" with a clear button; the menu has its own search, a checkbox per option with its count, "No match", closes on Escape or a click outside; theme tokens + `dr-filter-menu` hooks. Falls back cleanly when the ThemeContext default (`currentTheme: null`) is used.
- `AppPages/DashboardsPage.js` replaces `DashboardsSection` on the Dashboards page: filter bar (search across dashboard **and widget** names, Folder `FilterMenu`, Grouped / A-Z, Browse marketplace) fixed above a full-height list (grouped by folder; theme colour dots, "N pages · M widgets", amber dot when a required provider is unresolved or a team bot is waiting for approval) and detail (name + "folder · theme", attention line, layout preview per page with page chips, widgets with packages, team bots with status dots + LEAD, providers used + unresolved note, Folder / Theme selects, registry badge + rating). Actions: Open, Bots view, Dashboard Config, and ⋯ → Rename / Duplicate / Export ZIP / Publish / Delete (confirmed). New Dashboard shows the existing chooser; the wizard and marketplace hand off as before.
- `AppPages/dashboardSummary.js` (pure): pages + grid per page, widgets (name + `@scope/package`), providers used, unresolved required providers — same derivations as Dashboard Config. `AppPages/useApprovalsByDashboard.js` counts waiting approvals per dashboard (re-reads on approval / run / bot-list events).
- Stage: `handleOpenDashboardBotsView` sets the dashboard's stage mode to Bots and opens its tab; `handleOpenDashboardConfig` opens the tab, then (once it's showing) enters edit mode the usual way (snapshot, so Cancel works) and opens Config.
- Command palette: a **Go to** group (Dashboards, Bots, Providers, Widgets, Themes) opens the page tab.
- `DashboardsSection` / `DashboardDetail` are no longer used by any page; kept for now, to be removed in a cleanup.

### Phase 3 (slices 3–5): Page redesigns

NAV-010 (dash-react first), then NAV-006, NAV-008, NAV-009 in the list + detail design; NAV-007 restyle.

**Implementation notes (slice 3a — Bots, 2026-10-03):**

- `AppPages/BotsPage.js` replaces `BotsSection` on the Bots page. Filter bar: search (name, `local/<slug>` handle, trigger summary), **Team** `FilterMenu` with counts (Unassigned included), status chips All / Needs approval / Running / Paused, and the "Create team leads automatically" switch (moved from the list header). List grouped by team, Unassigned last; each row has a generic robot avatar on a stable per-bot colour, name, LEAD label, trigger summary and status dot.
- Detail (view mode): big avatar, name, handle, status; **Open in <team>'s Bots view** (not for Unassigned), **Run now** (not for leads), **Edit**; waiting approvals inline with **Allow / Deny** (`bots.approve(id, { allow })`); Team, Runs (trigger summary), Providers + chosen tools ("Team tools only" for leads, "All tools" when none were picked), Last run (status, time and the answer or error as plain text, from `getRuns(id, 1)`).
- **Edit / New Bot** show the existing `BotDetail` editor in the detail panel (edit adds **Back to details**, since BotDetail only shows Cancel when creating); delete is confirmed. (The old section passed no `isOpen` to `ConfirmationModal`; the page does.)
- `AppPages/useAllBots.js` loads every bot with running / pause / approvals and each bot's last run from one `listRecentRuns(50)` call (`lastRunsByBot`), live on run / approval / stream-end / bot-list events. `AppPages/botSummary.js` (pure): `botHandle`, `avatarColor`, `lastRunsByBot`, `botProviders`, `approvalText`.
- Stage: `handleOpenBotInBotsView(ws, botId)` focuses the bot (`focusBot`, which also sets the stage mode to Bots) and opens the team's tab.
- `BotsSection` is no longer used by any page; kept for the cleanup with `DashboardsSection`.

**Implementation notes (slice 3b — Widgets, 2026-10-03):**

- `AppPages/WidgetsPage.js` replaces `WidgetsSection` on the Widgets page. Filter bar: search (package id / name, widget names, descriptions), **Org** `FilterMenu` with package counts, chips All / In use / Not used / Mine, then "N updates · Update all" (existing `UpdateAllWidgetsModal` + preflight consent + sign-in gate), "Checking for updates…" and "Clean up N drafts" (confirmed).
- List: org headings (registry scopes A-Z, then **AI-built** for `@ai-built` packages and drafts, **Local** for unscoped packages, **Built-in** last); package rows (box icon, name without scope — drafts as "<widget> (draft)", "N widgets · vX", amber dot when an update is available) expand to their widgets when selected; a search that matches widgets shows just those under the package.
- Package detail: name, full id, source (Installed / AI-built / Draft / Built-in) + version, description, its widgets (each selectable, with how many dashboards use it), Used on (Open), Needs providers, Permissions ("Manage permissions" opens Settings › Privacy & Security). Actions: Update to vX (sign-in gate first), Resume (drafts), Publish… (installed packages), Open in Finder, Uninstall / Delete (confirmed, naming the dashboards that use it). Built-ins get no actions.
- Widget detail: "← <package>" back, icon, name + component id, description, Used on, Needs providers with required tools. **Add to dashboard is deferred** (no flow yet for placing a widget outside edit mode) — with the live preview (NAV-011).
- `AppPages/widgetSummary.js` (pure): `widgetOrgs` builds org → package → widgets with version, source, update, providers, usage; `filterOrgs` applies search / org / chip. Usage counts every page of a dashboard (`findWidgetUsage` only read `ws.layout`, so multi-page dashboards were missed). "Mine" is AI-built packages and drafts until widget ownership recognises the user's orgs (NAV-012).
- `AppPages/useWidgetInstall.js`: the ZIP / folder install flow and progress-modal state, moved from `WidgetsSection`; New Widget shows the existing install picker (Widget Builder, Discover, ZIP, folder) in the detail panel, then the result.
- Stage passes `onOpenPrivacySettings` → `openAppSettings("privacy-security")`.
- `WidgetsSection` is no longer used by any page; kept for the cleanup.

**Implementation notes (slice 3c — Themes, 2026-10-03):**

- `AppPages/ThemesPage.js` replaces `ThemesSection` on the Themes page. Filter bar: search, chips All / In use / Not used (in use = the app theme or used by a dashboard), the app-wide Light / Dark switch (moved from the old list header), Browse marketplace (existing `DiscoverThemesDetail`). List: the app theme first (✓), then A-Z; colour dots, name, "App theme" / "Used by N dashboards" / "Not in use".
- Detail: name + dots, "Current app theme" / usage; **Preview** — `AppPages/ThemePreview.js`, a mock dashboard (header, sidebar, three cards, button, tag) painted inline from the variant's `cssValue` (ThemeModel resolves real hex for every theme, so non-active themes preview correctly), with a Dark / Light toggle that doesn't change the app; **Palette** (ThemeDetail's `ColorSwatchGrid`, now exported) for the previewed variant; **Used by** with Open. Actions: Use as app theme, Edit theme, Duplicate (`rawThemes[key]` → `theme-<time>`, "<name> (Copy)", registry metadata dropped, then selected), Publish… (not for registry themes), Delete (confirmed, naming the dashboards that use it; hidden for the app theme). New Theme opens the creation wizard (`ThemeManagerModal startInCreate`).
- **Edit theme now opens the editor on the selected theme** (it always opened the app theme): `ThemeManagerModal` takes `initialThemeKey` (`Theme/editorThemeKey.js` picks it, else the app theme, else the first); the stage keeps `themeEditorKey` and `handleOpenThemeManager(themeKey)` sets it.
- `AppPages/themeSummary.js` (pure): `themeRows`, `filterThemes`, `duplicateTheme`, `paint`.
- `ThemesSection` is no longer used by any page; kept for the cleanup.

**Cleanup (2026-10-04):** removed the Settings components the Manage pages replaced — `DashboardsSection`, `DashboardDetail`, `BotsSection` (+ test), `WidgetsSection`, `InstalledWidgetDetail`, `ThemesSection`, `ThemeDetail` (its swatch grid moved to `Theme/ColorSwatchGrid.js`). None were exported from the package. The Providers search-styling test now compares against `NotificationsSection`; comments that named the removed files point at the pages.

**Implementation notes (Providers — NAV-007, 2026-10-04):**

- Restyled in place (`ProvidersSection` / `ProviderDetail`); the create / edit flows (class chooser, MCP catalog, custom MCP form, WebSocket form, credential form) are unchanged. The header's and deep links' create routing moved into one `startCreate(class, type)`.
- Filter bar: search, class chips All / Credentials / MCP / WebSocket, a "Needs setup only" checkbox, and "N providers need setup". List grouped by class (MCP servers, API credentials, WebSocket), A-Z; each row has the class icon, type, "used by N" and a status dot; the first provider is selected by default.
- Status (`AppPages/providerSummary.js`, pure): **Needs setup** — a credential the MCP server config uses (env mapping / `{{placeholder}}`) or the catalog marks required is empty; a credentials provider with nothing saved; a WebSocket provider without a URL. Otherwise MCP is **Connected** (server running) or **Starts when used**; credentials **Saved**; WebSocket **Ready**. "Sign in again" (expired OAuth) is deferred — it can't be known without connecting; Test Connection still reports it.
- Detail (view mode): name, "type · class", status with "Missing: …"; actions in the header (Authorize, Test Connection, Update Allowed Tools, Edit, Delete — same handlers); the default-for-type toggle; **Used by** — dashboards whose widgets resolve to it (`getAllProviderBindings`, with widget counts, Open) and bots granted it (Open in Bots view; leads excluded); server configuration and tools with theme tokens and `SectionLabel`s.
- `AppPages/useProviderStatus.js`: running MCP servers (`mcpGetServerStatus`, again on window focus; state only updates when it changes), bots (`bots.list` + `onListChanged`), status and usage; `useMcpCatalog`; `useProvidersNeedingSetup` for the left nav.
- **Left nav:** Providers shows an amber dot / count when any provider needs setup (`pageAttention.providers`).
- **Fix:** `ProvidersSection` ignored `initialProviderName` / `initialCreateRequested` since slice 1, so "Open Settings › Providers" landed with nothing selected and create links didn't start the flow. Both are now applied once on mount (waiting for providers to load).
- **Fix:** the MCP catalog's pre-select (`initialSelectedId`, used by "add a <type> provider" links incl. the Widget Builder) set the server without opening its configuration, so links landed on the full grid; it now runs the same `handleSelectServer` as clicking the card.
- **Fix:** the command palette's provider results had no select handler (`onOpenProviderDetail` was passed but unused); choosing one now opens it on the Providers page.

**Implementation notes (live widget preview — NAV-011 slice A, 2026-10-04):**

- The Widgets page widget detail has a **Preview** section (and each widget row in the package detail a **Preview** button that opens it). It runs **on click** (Run preview → Reload / Stop): a live preview starts MCP servers and calls real APIs, like placing the widget on a dashboard.
- It renders inside the host's sandbox: dash-core can't import dash-electron's iframe (`PreviewIframe`, the Widget Builder's), so `utils/widgetPreviewRenderer.js` is a slot the host fills at startup (`setWidgetPreviewRenderer`, like `setHostModules`). Without one the detail says live preview isn't available.
- `AppPages/WidgetPreview.js`: loads the package bundle (`mainApi.widgets.readBundle`), mounts the widget by its last name segment, passes `userConfig` defaults as props. **Providers:** a picker per provider type the widget needs, pre-selecting the user's default for that type (`resolveProviderName`, the rule dashboards use) or the only provider of that type; with several and no default the user picks before Run (preview only — nothing app-wide changes; changing it stops a running preview). Only those types are declared to the sandbox. A required type with no provider at all → "Needs a <type> provider to show live data." + **Set up** (provider create flow). Load failures and errors from the widget show in the panel. (Default-only, as first planned, would have blocked every MCP widget here: dashboards bind providers per widget, so no MCP provider was a type default.)
- Built-in widgets don't get a live preview (they have no bundle, and rendering them in the host tree would bypass the sandbox).

### Phase 4: Previews and authoring

NAV-011, NAV-012 (after the ownership fix), P2 items.

---

## Testing Requirements

- **Unit:** tab model helpers (open/switch/close/restore with page tabs); pages registry; `openAppSettings` routing; filter menu.
- **Render:** stage with only a page tab open (no dashboard); sidebar expanded/collapsed with attention dots; Settings modal sections.
- **Static pins:** dashboard-only effects gated on dashboard tabs; theme tokens / safelist in new UI.
- **Live (linked):** open each page, switch to a dashboard and back, close, restart restore; Bots view "Open Settings › Providers" lands on the Providers page; screenshots per page, expanded and collapsed sidebar.

---

## Revision History

| Version | Date       | Author | Changes                                         |
| ------- | ---------- | ------ | ----------------------------------------------- |
| 1.0     | 2026-10-03 | John   | Initial PRD from the approved navigation mockup |
| 1.1     | 2026-10-03 | John   | Slice 1 implemented (Manage nav, page tabs)     |
| 1.2     | 2026-10-03 | John   | Slice 2: Dashboards page, FilterMenu, Go to     |
| 1.3     | 2026-10-03 | John   | Slice 3a: Bots page (list + detail)             |
| 1.4     | 2026-10-03 | John   | Slice 3b: Widgets page (org → package → widget) |
| 1.5     | 2026-10-03 | John   | Slice 3c: Themes page (list + preview)          |
| 1.6     | 2026-10-04 | John   | Cleanup: removed the replaced Settings sections |
| 1.7     | 2026-10-04 | John   | Providers restyle, status, Used by, nav dot     |
| 1.8     | 2026-10-04 | John   | Live widget preview (NAV-011 slice A)           |
