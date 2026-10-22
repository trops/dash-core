# PRD: Widget Installation Model

**Status:** Implemented
**Last Updated:** 2026-10-22
**Owner:** Core Team
**Related PRDs:** [Dashboard Marketplace](dashboard-marketplace.md), [Widget Dropdown](widget-dropdown.md)
**Repos:** dash-core (v0.1.239+, hardened in v0.1.425–v0.1.427), dash-electron (v0.0.239+)

---

## Executive Summary

Dash supports three independent tracks for getting widgets into a running application: **Registry (Discover)**, **ZIP install**, and **built-in (`src/Widgets/`)**. The registry-first model makes Discover the primary path for end users while preserving ZIP install for offline/private use and built-in widgets for developers who ship custom widgets compiled into their app. Only registry-installed widgets participate in the update system.

---

## Context & Background

### Problem Statement

**What problem are we solving?**

Prior to this model, all 12 stock widgets (Slack, Gmail, GitHub, etc.) were compiled directly into the dash-electron app as built-in widgets. They had no registry identity -- no scope, no version, no `downloadUrl`. The update system (`checkUpdates()`) could never match them to registry packages, meaning users would never see updates. Additionally, the first-launch experience forced a "Kitchen Sink" sample workspace on users rather than letting them choose what they actually need.

The registry-first model solves this by publishing all stock widgets to the registry, making Discover the primary acquisition path, and shipping dash-electron with an empty `src/Widgets/` directory. Users choose which widgets they want. Updates flow through the registry's scoped identity system.

**Who experiences this problem?**

-   Primary: End users who want to install, discover, and update widgets
-   Secondary: Developers who build custom widgets for private distribution
-   Tertiary: Widget publishers who distribute via the registry

**What happens if we don't solve it?**

Built-in widgets never receive updates. Users get a bloated default install with widgets they don't need. There's no clear path for community widget distribution.

### Current State

**What exists today (post-implementation):**

Three independent installation tracks, each with distinct use cases:

| Track                     | Source                      | Use Case                             | Updates                        | Storage                |
| ------------------------- | --------------------------- | ------------------------------------ | ------------------------------ | ---------------------- |
| Registry (Discover)       | Remote registry API         | Primary path for end users           | Yes (scoped identity matching) | `widgets/@scope/name/` |
| ZIP install               | Local `.zip` file or folder | Offline, private, or development use | No                             | `widgets/name/`        |
| Built-in (`src/Widgets/`) | Compiled source code        | Developers shipping custom apps      | No (separate track)            | N/A (in bundle)        |

---

## Architecture

### Installation Track 1: Registry (Discover)

The primary path for end users. Widgets are browsed in the registry, then downloaded and installed. The registry browser opens from Create › Widget's no-AI start **Browse widgets in the registry**, and shows on the Widgets page (app-navigation NAV-008). Create's Dash team also finds and installs registry widgets while it builds a plan. _(The Discover tab and the Dashboard Wizard: superseded by Create's no-AI starts and starters (2026-10-22). See Appendix: history.)_

**Flow:**

1. User browses widgets in the registry (Create › Widget › Browse widgets in the registry)
2. `useRegistrySearch()` calls `window.mainApi.registry.search(query, filters)`
3. Results filtered by app capabilities (only shows widgets the app can support)
4. User clicks Install -- `installPackage(widget)` triggers:
    - Builds scoped ID: `@scope/name` (e.g., `@trops/slack`)
    - Resolves download URL placeholders: `{version}` and `{name}`
    - Calls `window.mainApi.widgets.install(scopedId, resolvedUrl)`
5. Main process downloads ZIP (HTTPS only), validates entries, extracts to `widgets/@scope/name/`
6. Widget registered, `widget:installed` event broadcast to all windows
7. App hot-reloads the new widget without restart

**Key files:**

| File                                                       | Repo      | Role                                         |
| ---------------------------------------------------------- | --------- | -------------------------------------------- |
| `src/hooks/useRegistrySearch.js`                           | dash-core | Search + install trigger (renderer)          |
| `electron/controller/registryController.js`                | dash-core | API fetch, search, update checking (main)    |
| `electron/widgetRegistry.js`                               | dash-core | Download, extract, register (main)           |
| `src/Components/Settings/details/DiscoverWidgetsDetail.js` | dash-core | Registry browser (shown on the Widgets page) |
| `src/Components/Create/createRouting.js`                   | dash-core | Create's no-AI starts (`noAiOptions`)        |

**Wizard integration:** Superseded by Create (2026-10-22) — the Wizard was removed in consolidation Phase 2a; a dashboard Create builds installs the registry widgets its plan uses before placing them. See Appendix: history.

**Capability filtering:** The search hook discovers the app's API namespaces from `window.mainApi` and only shows packages whose required APIs are available. A toggle ("Show all packages") overrides this filter.

### Installation Track 2: ZIP Install

For offline use, private widgets, or development testing. Users provide a `.zip` file or a local folder path.

**Flow:**

1. User picks **Install a widget from file** (Create › Widget's no-AI starts; it runs on the Widgets page)
2. File picker opens via `window.mainApi.dialog.chooseFile(true, ["zip"])`
3. Calls `window.mainApi.widgets.installLocal(widgetName, filepath)`
4. Main process extracts ZIP or copies folder to `widgets/name/`
5. Validates ZIP entries against path traversal attacks
6. Looks for `dash.json` metadata, falls back to `package.json`
7. Auto-compiles CJS bundle if not present
8. Widget registered, `widget:installed` event broadcast

**Folder install:** **Load a widget from a folder** (also a Create › Widget no-AI start) bulk-imports widgets from a directory. Uses smart detection to determine if the folder itself is a widget or contains widget subdirectories.

**Key files:**

| File                                          | Repo      | Role                                                    |
| --------------------------------------------- | --------- | ------------------------------------------------------- |
| `src/Components/AppPages/useWidgetInstall.js` | dash-core | Install UI flow (renderer, Widgets page)                |
| `electron/widgetRegistry.js`                  | dash-core | `installFromLocalPath()`, `registerWidgetsFromFolder()` |

### Installation Track 3: Built-in Widgets (`src/Widgets/`)

For developers who clone dash-electron and ship their own custom application with widgets compiled into the bundle. These widgets are imported at build time and registered directly with ComponentManager -- no download, no extraction, no registry identity.

**Flow:**

1. Developer creates widgets in `src/Widgets/MyWidget/`
2. Exports from `src/Widgets/index.js` barrel file
3. `Dash.js` imports all widgets: `import * as myWidgets from "./Widgets"`
4. Registration loop iterates exports and calls `ComponentManager.registerWidget()` for each
5. Handles both direct exports (`{ component, type, ... }`) and namespace re-exports (nested objects)

**Default state:** The dash-electron template ships with an empty `src/Widgets/index.js`:

```js
// Add your built-in widgets here.
// See src/SampleWidgets/ for examples.
```

The registration loop still runs but registers nothing. Developers can add their own widgets to this directory for private distribution.

**Key files:**

| File                   | Repo          | Role                                     |
| ---------------------- | ------------- | ---------------------------------------- |
| `src/Widgets/index.js` | dash-electron | Barrel export (empty by default)         |
| `src/Dash.js`          | dash-electron | Registration loop (lines 46-74)          |
| `src/SampleWidgets/`   | dash-electron | Reference implementations (not compiled) |

### External Widget Loading (Runtime)

Registry and ZIP-installed widgets are loaded at app startup via a two-phase process in `Dash.js`:

**Phase 1 -- CJS Bundles:** `loadInstalledWidgets()` calls `window.mainApi.widgets.readAllBundles()`, evaluates each bundle, and registers components with ComponentManager.

**Phase 2 -- Config Fallback:** For widgets without bundles, reads `.dash.js` config metadata and creates `React.lazy` wrappers via `createLazyWidget()`. Each lazy wrapper calls `readBundle()` on first render, providing on-demand loading with a Suspense fallback.

**Hot reload:** When a widget is installed at runtime, `widget:installed` fires and `handleWidgetInstalled()` loads the new widget without requiring an app restart.

---

## Scoped Identity System

All registry-installed widgets use scoped identifiers following the npm convention: `@scope/name`.

### Package ID Utilities

```
electron/utils/packageId.js
```

| Function                   | Input                | Output                              |
| -------------------------- | -------------------- | ----------------------------------- |
| `toPackageId(scope, name)` | `"trops"`, `"slack"` | `"@trops/slack"`                    |
| `parsePackageId(id)`       | `"@trops/slack"`     | `{ scope: "trops", name: "slack" }` |

### Directory Structure

```
widgets/
  @trops/
    slack/          # Registry: @trops/slack
    gmail/          # Registry: @trops/gmail
  weather/          # ZIP install (no scope)
```

### Update Matching

`registryController.checkUpdates()` matches installed widgets to registry packages:

1. Constructs `@scope/name` from registry package metadata
2. Compares against installed widget's `packageId`
3. Falls back to bare-name matching for pre-migration entries
4. Returns update info if registry version is newer

**Only registry-installed widgets participate in updates.** Built-in and ZIP-installed widgets have no registry identity and are never checked.

### Migration

On first load, `widgetRegistry.loadRegistry()` migrates legacy bare-name entries to scoped IDs:

-   Re-keys map entry: `slack` -> `@trops/slack`
-   Moves folder: `widgets/slack/` -> `widgets/@trops/slack/`
-   Sets `_scopeMigrated` flag to prevent re-runs

---

## Developer Guide

### For End Users

| I want to...                 | How                                                        |
| ---------------------------- | ---------------------------------------------------------- |
| Browse and install widgets   | Create › Widget › Browse widgets in the registry           |
| Install a widget from a file | Create › Widget › Install a widget from file               |
| See available updates        | Widgets page -- an amber dot and "N updates · Update all"  |
| Uninstall a widget           | Widgets page > open the package > a widget's ⋯ > Uninstall |

### For Widget Developers

| I want to...                            | How                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build a widget for my private app       | Add to `src/Widgets/`, export from `index.js`, restart app                               |
| Build a widget for the registry         | Develop in `src/SampleWidgets/` (or any dir), publish with `npm run publish-to-registry` |
| Test a widget locally before publishing | Use ZIP install or folder install to load the built widget                               |
| See example widget code                 | Browse `src/SampleWidgets/` -- 12 full working examples                                  |

### Publishing to the Registry

```bash
# Publish all widgets from a directory
npm run publish-to-registry -- --all --dir src/SampleWidgets

# Publish a single widget
npm run publish-to-registry -- --widget Slack --dir src/SampleWidgets

# Preview manifest without publishing
npm run publish-to-registry -- --all --dir src/SampleWidgets --dry-run
```

The publish pipeline: Rollup bundles the widget -> `packageZip.js` creates a distributable ZIP -> `publishToRegistry.js` authenticates via OAuth device flow and uploads to the registry API.

**Flags:**

| Flag              | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `--widget <Name>` | Publish a single widget directory                       |
| `--all`           | Publish all widget directories                          |
| `--dir <path>`    | Custom widget source directory (default: `src/Widgets`) |
| `--dry-run`       | Preview manifest without publishing                     |
| `--name <name>`   | Override registry package name                          |
| `--republish`     | Overwrite existing version in registry                  |

### Sample Widgets

The `src/SampleWidgets/` directory contains all 12 stock widgets as developer reference:

| Package        | Key Widgets                                                              | Category     |
| -------------- | ------------------------------------------------------------------------ | ------------ |
| DashSamples    | NotepadWidget, ThemeViewerWidget, EventSenderWidget, EventReceiverWidget | general      |
| Chat           | ChatClaudeCodeWidget                                                     | productivity |
| Slack          | SlackWidget, SlackListChannels, SlackChannelMessages, SlackPostMessage   | social       |
| Gmail          | GmailWidget, GmailInbox, GmailCompose, GmailSearch                       | productivity |
| GoogleCalendar | GoogleCalendarWidget, GCalUpcoming, GCalQuickCreate                      | productivity |
| GoogleDrive    | GoogleDriveWidget, GDriveFileList, GDriveFileSearch                      | productivity |
| GitHub         | GitHubWidget, GitHubRepoList, GitHubIssueList, GitHubPRList              | development  |
| Notion         | NotionWidget                                                             | productivity |
| Gong           | GongWidget                                                               | productivity |
| Filesystem     | FilesystemWidget                                                         | utilities    |
| Algolia        | AlgoliaSearchWidget, AlgoliaAnalyticsWidget, + 10 more                   | development  |
| AlgoliaSearch  | AlgoliaSearchPage                                                        | development  |

These are **not compiled** into the app. They exist purely as examples for developers who want to build their own widgets.

---

## Security

### ZIP Validation

All ZIP extractions (registry download, local install, dashboard import) pass through `validateZipEntries()`:

-   Rejects entries with `..` path segments (path traversal)
-   Rejects absolute paths (filesystem escape)
-   Rejects entries that resolve outside the target directory

### Download Security

-   Registry downloads enforce HTTPS-only URLs
-   OAuth device flow for registry publishing (no stored credentials)

### Install Gate (consolidation Phase 1a, 1a-2 — 2026-10-16)

Nothing is installed, loaded or published unchecked.

-   **Every install is staged and checked first** (`stageInstall` →
    `checkPackage` in `electron/widgetRegistry.js`): registry downloads and
    updates, Install a widget from file, the Widget Builder. The package is
    extracted into `widgets/.staging/`, and only a pass replaces the installed
    folder. The old folder is moved aside and put back if the new one can't be
    moved in, so a refusal or a failure keeps the installed version.
-   **The checks:** no direct bot calls (TD-005, the whole package, bundle
    included); a package that ships no build must build here; and the app's
    gate (`setInstallGate` — dash-electron's `installGate.cjs`), which runs
    the Widget Builder's code checks on the whole package's source at any
    depth: every widget and every other .js/.jsx file (shared `utils/`,
    `hooks/`, `contexts/` included). Builds (`dist/`, the root bundle) and
    `node_modules` aren't source; tests and stories are skipped unless
    something imports them.
-   **Load a widget from a folder** and **Publish** run the same checks in
    place. A check never deletes the folder it checks. A folder with no build
    is built in place, and that build is marked (`dist/.dash-build`) so it's
    rebuilt from the current source on every load; a developer's own build
    is left alone.
-   **A refusal lists every reason**, worded for what was refused ("wasn't
    installed / loaded / published — it didn't pass its checks: …").
-   **Who built the code that runs** is recorded on each registry entry
    (`build`): `"dash"` when the app built it from the checked source, or
    `"developer"` when the package ships its own build. A widget package may
    bundle any libraries its developer chose, so its build is kept. The
    Widgets page then says "Runs the code its developer packaged — Dash checked
    the source that came with it."
-   **A package's own libraries (Phase 1a-3).** Publishing records the npm
    libraries a package's source imports, with versions, in its package.json
    `dependencies` (`utils/libraryImports.js`; dash-electron's
    `scripts/packageZip.js` uses its twin). A library that isn't installed
    where it's published stops the publish. The compiler downloads a package's
    listed libraries from npm into a temp folder for each build
    (`widgetLibraries.js`), with the libraries they depend on and the ones
    they expect beside them (peers). Files come over HTTPS from npm's own
    server only, each checked against npm's fingerprint (the verified bytes
    are what's unpacked); plain files only; library names checked; nothing a
    library ships is run; the app's own libraries are never downloaded;
    downloads (250 MB), unpacked size and package count are capped, and every
    request times out. Downloads and npm's answers are cached in
    `userData/widget-libraries` (answers fresh for a day, used past that
    offline; the download cache is trimmed past 1 GB), so a package builds
    offline once its libraries were downloaded. Nothing is written into the
    package. Only real import statements count (not text that looks like
    one).
-   **Registry installs build from the checked source** (`checkPackage`
    `rebuild`), even when it ships a build — recorded `build: "dash"` — but
    only with the libraries it lists (`compileWidget` `ownLibrariesOnly`),
    never the app's copies, which may be other versions. A package that uses
    libraries without listing them (everything published before this) keeps
    its developer's build until it's republished; so does one whose build
    fails here or whose libraries can't be fetched. The reason is recorded
    (`checks.rebuildError`) and the Widgets page says its developer can
    republish it so Dash can build it, and why. File and folder installs keep
    a developer's own build. Elsewhere (Widget Builder checks, installs from
    file, publish) a package's listed libraries come first and the app's fill
    in.
-   **Publish** records the libraries before its checks build the package; a
    publish whose build fails puts the version back, and a network problem
    is worded as one.
    A package with a build but no source says Dash couldn't check its code
    (`checks.sourceChecked: false`); one with no code at all (a dashboard
    package) records `build: "none"` and shows no note.
-   **Installed packages are checked at startup** (`checkInstalled`, called by
    the host after `setInstallGate`), once and again whenever their code
    changes (`checks.fingerprint`: each file's path, size and date — nothing
    is read). A package that fails is flagged on the
    Widgets page with its reasons and keeps working. A package found on disk
    that isn't in the registry is registered only if it passes (the host then
    announces it with `widget:installed`); its files are left in place either
    way. The host must call `checkInstalled`. Widget drafts (`@ai-built/draft-*`,
    `dash.draft`) aren't checked.
-   **A ZIP installed without a name** takes the package's own name (dash.json
    scope + name, then package.json, then dash.json), and the file's name
    only as a fallback. A file can't claim the `@ai-built` scope or a name
    made of dots. When a package by that name is installed already, the
    screen asks before replacing it (`inspectLocalPath` / `widget:inspect-local`).

---

## First-Run Experience

The app launches with an empty state ("No dashboards open") showing two actions:

1. **Search** -- opens the command palette
2. **New Dashboard** -- opens Create on Dashboard (a plan from the Dash team, or a no-AI start: blank, import from file, browse the registry's dashboards)

_(The **Wizard** action: superseded by Create's no-AI starts and starters (2026-10-22). The `WelcomePrompt` component has been removed. See Appendix: history.)_

---

## Decisions Made

| Date       | Decision                                                                                           | Rationale                                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-03-20 | Ship dash-electron with empty `src/Widgets/`                                                       | Eliminates built-in widget bloat; users install only what they need                                                                                                                                                                                          |
| 2026-03-20 | Keep built-in widget mechanism intact                                                              | Developers who clone the template can still compile custom widgets                                                                                                                                                                                           |
| 2026-03-20 | Only registry widgets get updates                                                                  | Clean separation -- built-in and ZIP widgets are developer-managed                                                                                                                                                                                           |
| 2026-03-20 | Use npm-style `@scope/name` for widget identity                                                    | Prevents name collisions, familiar convention                                                                                                                                                                                                                |
| 2026-03-20 | Remove Kitchen Sink welcome prompt                                                                 | Wizard provides a better onboarding experience (the Wizard was later replaced by Create)                                                                                                                                                                     |
| 2026-03-20 | Wizard auto-installs widgets before layout creation                                                | Prevents broken layout references to uninstalled widgets (superseded 2026-10-22: Create installs a plan's widgets before placing them)                                                                                                                       |
| 2026-10-19 | The Wizard and Settings › Widgets' Discover tab are replaced by Create's no-AI starts and starters | One door for making things (consolidation Phase 2a)                                                                                                                                                                                                          |
| 2026-04-24 | Layout items record `packageId` at widget-add time                                                 | Lets publish attribute each instance to the exact source package — no guessing when two installed packages both declare the same component (see `LayoutModel.js`, `handleDropWidgetFromSidebar`, `dash:place-widget-in-cell`, `dash:swap-widget-in-cell`)    |
| 2026-04-24 | Registry re-enriches `componentNames` on every startup                                             | `backfillMetadataFromDisk` always runs against each installed entry. Previously it skipped entries whose cache looked populated, so a package that gained widgets after first install never advertised them — publish attribution fell through to singletons |
| 2026-10-16 | Every install, folder load and publish is checked first; a refusal keeps the installed version     | One gate for every way in (consolidation roadmap Phase 1a)                                                                                                                                                                                                   |
| 2026-10-16 | A package's own build is kept, and recorded as the developer's                                     | Widget packages may bundle any library; rebuilding with only the app's libraries would break that (Phase 1a-2; building with the package's own libraries is 1a-3)                                                                                            |
| 2026-10-16 | Installed widgets that fail the checks are flagged, not disabled                                   | Nothing the user relies on stops working without warning (Phase 1a-2)                                                                                                                                                                                        |
| 2026-04-24 | Publish-side + install-side sanitize `providers` arrays                                            | `generateWidgetRegistryManifest` and `enrichEntryFromDisk` drop falsy/non-object entries. Consumers (`getUserConfigurableProviders`, `useMemo` flatMaps) ALSO null-guard — three layers so a single sparse array never takes the renderer down               |

---

## Invariants to Preserve

These constraints were violated by past bugs; the tests at
`src/utils/providerUtils.test.js`, `electron/schema/widgetPublishManifest.test.js`,
and `electron/schema/dashboardConfigUtils.test.js` lock them in.

-   **Shared-component attribution is NOT a guess.** When a layout item
    carries `packageId`, the publish flow looks it up by id — it must
    NOT fall through to component-name-based resolution. Only items
    predating the field (migrated from older workspaces) are allowed
    to use the coverage-ranked fallback.
-   **Registry `componentNames` must reflect disk.** If a package's
    `dash.json` advertises N widgets, the registry cache must
    eventually show N. The backfill logic monotonically grows the
    cached list (enrichEntryFromDisk only overwrites when the new
    list is longer), so NEW widgets surface; deletions require a
    reinstall.
-   **A check never deletes what it checks.** A folder loaded in place is
    the developer's own, and the publish check runs on the installed package.
    Only an install's staged copy is removed, by the install itself
    (`electron/widgetRegistryChecks.test.js`).
-   **`providers` arrays can contain `null` entries.** Older or
    author-malformed packages occasionally do. Every walker must
    filter before reading per-entry properties.

---

## Revision History

| Version | Date       | Author    | Changes                                                                                                                                                                                                     |
| ------- | ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-03-20 | Core Team | Initial version -- documents registry-first model, scoped identity, three installation tracks                                                                                                               |
| 1.1     | 2026-04-24 | Core Team | Adds `packageId` on layout items, registry cache refresh-on-startup, and three-layer sparse-providers sanitization. See dash-core v0.1.425–v0.1.427.                                                        |
| 1.2     | 2026-10-16 | Core Team | Install gate: staged + checked installs, folder loads and publishes (v0.1.785); who built it, startup checks, every file checked, safe swap, ZIPs named by their package, checks never delete (Phase 1a-2). |
| 1.3     | 2026-10-16 | Core Team | A package's own libraries: recorded at publish, downloaded at install; registry installs build from the checked source, keeping the developer's build when they can't (Phase 1a-3).                         |
| 1.4     | 2026-10-22 | Core Team | Phase 5 reconciliation: the Wizard, the Discover tab and Settings › Widgets are superseded by Create's no-AI starts and the Widgets page.                                                                   |

---

## Appendix: history

Text replaced by later work, kept as it was written.

-   **Track 1 (2026-03-20):** "The primary path for end users. Widgets are browsed in the Discover tab or Dashboard Wizard, then downloaded and installed from the registry." Flow step 1: "User browses widgets via Discover tab or Wizard". Key file: `src/Components/Layout/DashboardWizard/steps/WizardCustomizeStep.js` (Wizard install step).
-   **Wizard integration (2026-03-20):** "The Wizard's custom path auto-installs selected registry widgets before creating the dashboard layout. This ensures layout items referencing widget component names resolve correctly."
-   **Track 2 (2026-03-20):** "User goes to Settings > Widgets > 'Install from ZIP'"; "Settings > Widgets also supports 'Load from Folder'"; key file `src/Components/Settings/sections/WidgetsSection.js`.
-   **For End Users (2026-03-20):** browse via "Settings > Widgets > Discover tab, or use the Dashboard Wizard"; install from file via "Settings > Widgets > 'Install from ZIP'"; updates and Uninstall in Settings > Widgets.
-   **First-Run Experience (2026-03-20):** three actions — Search, New Dashboard (creates a blank dashboard), and **Wizard** (guided flow: browse registry, select widgets, create dashboard). "The `WelcomePrompt` component still exists in dash-core for API compatibility but is no longer rendered by `DashboardStage`."
