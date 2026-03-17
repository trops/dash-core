# @trops/dash-core — Core Dashboard Framework

> ⚠️ **THIS FILE IS A PROTOCOL, NOT DOCUMENTATION.**
> Every section marked MANDATORY must be followed in order, without exception.
> If anything is unclear — requirements, file locations, which repo to change —
> **ASK before proceeding. Do not infer. Do not improvise.**

---

## ⚠️ MANDATORY: Before Any Code Changes

These steps are NON-NEGOTIABLE and must happen in this exact order before writing any code:

1. Sync dash-core (this repo):
   ```bash
   git checkout master && git pull origin master
   ```

2. Locate and sync sibling repos. They live alongside this repo — discover their paths:
   ```bash
   REPO_ROOT="$(git rev-parse --show-toplevel)"
   DASH_REACT="$(find "$(dirname "$REPO_ROOT")" -maxdepth 3 -name "package.json" | xargs grep -l '"name": "@trops/dash-react"' 2>/dev/null | head -1 | xargs dirname)"
   DASH_ELECTRON="$(find "$(dirname "$REPO_ROOT")" -maxdepth 3 -name "package.json" | xargs grep -l '"name": "dash-electron"' 2>/dev/null | head -1 | xargs dirname)"
   echo "dash-react:    $DASH_REACT"
   echo "dash-electron: $DASH_ELECTRON"
   ```
   If either is not found, **STOP and ask the user where the repo is cloned.** Do not assume a path.

3. Pull latest in each found sibling repo:
   ```bash
   cd "$DASH_REACT" && git pull origin master
   cd "$DASH_ELECTRON" && git pull origin master
   ```

4. Return to this repo and create a feature branch:
   ```bash
   cd "$REPO_ROOT"
   git checkout -b feat/<TICKET-KEY>-<slug>
   ```

**If any pull fails: STOP. Report the exact error. Do not proceed.**

---

## ⚠️ MANDATORY: Development Phases

These four phases are sequential and cannot be skipped, combined, or reordered.

### Phase 1 — PLAN

1. State the task in one sentence.
2. List every file that will be created or modified.
3. List any dependencies that will be added.
4. Identify risks, ambiguities, or cross-repo implications.
5. Explicitly state whether this change has downstream effects on dash-electron or dash-react.
6. **Wait for explicit user approval before writing a single line of code.**
   Acceptable approvals: "proceed", "looks good", "go ahead", 👍.
   Silence is NOT approval.

### Phase 2 — IMPLEMENT

1. Make only the changes listed in the approved plan.
2. Do not refactor, rename, or "improve" anything outside the plan.
3. Do not add dependencies not listed in the plan.
4. **Use `@trops/dash-react` components for all UI.** See UI Component Rule below.
5. Run Prettier when done:
   ```bash
   npm run prettify
   ```
6. Fix any Prettier errors before proceeding.
7. Stage any new (untracked) files created in this phase before proceeding to Phase 3:
   ```bash
   git add <each new file explicitly by path>
   ```
   The CI script uses `git add -u` which only stages tracked files — any new file not
   staged here will be silently excluded from the commit. Do not use `git add .` or `git add -A`.

### Phase 3 — VALIDATE

1. Run the full CI validation:
   ```bash
   npm run ci
   ```
2. If it fails, fix the errors and re-run. Do not proceed with a failing build.
3. Do not mark this phase complete until `npm run ci` exits cleanly.
4. Verify all three dist output files exist:
   ```bash
   ls dist/index.js dist/index.esm.js dist/electron/index.js
   ```
   If any file is missing, the build silently failed — treat this as a CI failure.
5. **If you cannot make CI pass: STOP. Report the exact output. Do not proceed.**

### Phase 4 — RELEASE

1. Use the CI script — **this is the only approved release path**:
   ```bash
   npm run ci:release -- -m "type(scope): description"
   ```
2. Do not manually construct `git commit`, `git push`, `git tag`, or `gh pr` commands.
   Manual git commands outside of `ci.sh` are not permitted.
3. Confirm to the user: "Released. Commit: `<hash>` pushed to `<branch>`."

---

## ⚠️ MANDATORY: Cross-Repo Changes

dash-core is a dependency of dash-electron (and peer of dash-react). Changes here have
downstream consequences. The mandatory order is:

1. Sync ALL repos first (see Mandatory Pre-Work above — sibling repos are discovered, not assumed).
2. Make and validate changes in dash-core **first**.
3. Run `npm run ci` in dash-core and confirm it passes — including dist output verification.
4. If the change affects dash-react, apply and validate those changes next.
5. Only then update dash-electron to consume the new version.
6. Run `npm run ci` in dash-electron to confirm end-to-end compatibility before releasing anything.
7. Never modify dash-electron to work around a missing dash-core change — fix it at the source.
8. Read `.claude/skills/cross-repo-dev/SKILL.md` before starting any cross-repo task.

**Never release dash-core without verifying dash-electron still builds and runs against it.**

---

## ⚠️ UI Component Rule — Use @trops/dash-react for All UI

`@trops/dash-react` is the UX library for the entire Dash ecosystem. All UI components
in dash-core must come from `@trops/dash-react` to maintain visual and behavioral
consistency across the application.

```javascript
// CORRECT — always import UI components from @trops/dash-react
import {
    Panel, Panel2, Panel3,
    Heading, SubHeading,
    Button, ButtonIcon,
    Widget, Workspace,
    Modal, Notification,
    LayoutContainer,
    ErrorBoundary,
    FontAwesomeIcon,
    ThemeContext,
} from "@trops/dash-react";

// WRONG — never build custom UI components that duplicate dash-react functionality
// WRONG — never import ThemeContext from a local file
import { ThemeContext } from "./Context/ThemeContext"; // creates dual context instances

// WRONG — never import FontAwesomeIcon directly
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"; // duplicates dependency
```

**Before building any new UI component, check whether @trops/dash-react already provides it.**
If dash-react is missing something that dash-core needs, the correct fix is to add it to
dash-react first (cross-repo task), not to build a local substitute in dash-core.

---

## ⚠️ NON-NEGOTIABLE RULES

- **Never skip a phase.** Even if the task "seems simple."
- **Never combine phases.** Do not implement and validate in the same step.
- **Never push directly to master.** Always use feature branches and PRs via `ci:release`.
- **Never use `git push --force` or `git reset --hard`.**
- **Never use `git add .` or `git add -A`.** Stage only the files changed in Phase 2.
- **Never build custom UI components that duplicate @trops/dash-react.** Use dash-react.
- **Never release dash-core without verifying dash-electron compatibility.**
- **When in doubt, ask.** Do not infer requirements. Do not improvise solutions.
- **If a command fails, stop.** Report the exact error output. Do not attempt workarounds.

---

## ci.sh — The Only Approved Release Path

The `scripts/ci.sh` script handles the full pipeline: Node 20 via nvm, Prettier, renderer
build, electron build + MCP catalog, Jest tests, MCP tests, output verification, commit,
version bump, push, PR, merge, tag, and cleanup.

```bash
# Validate only
npm run ci

# Validate + commit + version bump
npm run ci:commit -- -m "Your commit message"

# Above + push branch
npm run ci:push -- -m "Your commit message"

# Above + create PR
npm run ci:pr -- -m "Your commit message"

# Above + merge PR + tag + cleanup
npm run ci:release -- -m "Your commit message"
```

Each flag is cumulative. `--release` runs all prior steps automatically.

**During development only**, individual build targets may be used to iterate faster:

```bash
npm run build:renderer   # Renderer layer only (ESM + CJS)
npm run build:electron   # Electron layer only (CJS)
```

These are NOT substitutes for `npm run ci` — always run the full pipeline before release.

---

## Project Overview

`@trops/dash-core` is the core framework for Dash dashboard applications. It provides the
widget system, provider architecture, context providers, layout engine, and Electron main
process layer. Consuming apps (e.g., `dash-electron`) use this as their foundation.

**Package:** `@trops/dash-core`
**Repository:** [github.com/trops/dash-core](https://github.com/trops/dash-core)
**Published to:** public npm registry — no special `.npmrc` configuration required.

**Two export paths:**

- `@trops/dash-core` — Renderer layer (ESM + CJS). Platform-agnostic React components,
  contexts, hooks, models, and utilities. Zero Electron dependencies.
- `@trops/dash-core/electron` — Electron layer (CJS only). Controllers, IPC handlers,
  events, widget pipeline, and the `createMainApi` factory.

**Peer dependencies:** `react ^18.2.0`, `react-dom ^18.2.0`, `@trops/dash-react >=0.1.187`

---

## Architecture

### Renderer Layer (`src/`)

Platform-agnostic UI framework. ~54 source files.

| Module | Key Files | Purpose |
|---|---|---|
| **ComponentManager** | `ComponentManager.js` | Widget/workspace registration, config resolution |
| **Context** | `Context/` | AppContext, DashboardContext, ThemeWrapper, ProviderContext, WidgetContext, WorkspaceContext |
| **Hooks** | `hooks/` | useDashboard, useMcpProvider, useWidgetProviders, useInstalledWidgets, useWidgetEvents, useRegistrySearch |
| **Models** | `Models/` | DashboardModel, LayoutModel, ThemeModel, ComponentConfigModel, SettingsModel, etc. |
| **Api** | `Api/` | DashboardApi, ElectronDashboardApi (typed), WidgetApi, ThemeApi, MockDashboardApi |
| **Components** | `Components/` | Dashboard, Layout, Settings, Navigation, Theme, Provider, Menu, Workspace |
| **Widget** | `Widget/` | Widget, WidgetFactory, ExternalWidget |
| **Utils** | `utils/` | widgetBundleLoader, layout, validation, mcpUtils, dragTypes, resolveIcon, themeGenerator, DynamicWidgetLoader, WidgetRegistry, plugin-loader |

### Electron Layer (`electron/`)

Main process controllers, APIs, and widget pipeline. ~60 files.

| Module | Key Files | Purpose |
|---|---|---|
| **Controllers** | `controller/` | providerController, mcpController, workspaceController, themeController, settingsController, layoutController, dataController, registryController, secureStoreController, dialogController, algoliaController, openaiController, menuItemsController, pluginController |
| **APIs** | `api/` | IPC handlers for each controller + `mainApi.js` (createMainApi factory) |
| **Events** | `events/` | Event channel definitions for each module |
| **Widget Pipeline** | `widgetRegistry.js`, `widgetCompiler.js`, `dynamicWidgetLoader.js` | Install, compile (esbuild), and load external widgets |
| **MCP** | `mcp/mcpServerCatalog.json` | MCP server definitions (transport, command, args, env mapping) |

### Entry Points

**Renderer** (`src/index.js`):
```javascript
import { ComponentManager, DashboardPublisher, useDashboard, ... } from "@trops/dash-core";
```

**Electron** (`electron/index.js`):
```javascript
const { createMainApi, providerController, mcpController, ... } = require("@trops/dash-core/electron");
```

---

## Directory Structure

```
dash-core/
├── src/                            # Renderer layer
│   ├── Api/
│   ├── ComponentManager.js
│   ├── Components/
│   │   ├── Dashboard/
│   │   ├── Layout/                  # LayoutBuilder, LayoutContainer, LayoutGridContainer
│   │   ├── Navigation/
│   │   ├── Settings/
│   │   ├── Theme/
│   │   ├── Provider/
│   │   ├── Menu/
│   │   └── Workspace/
│   ├── Context/
│   ├── DashboardPublisher.js
│   ├── ErrorBoundary.js
│   ├── Models/
│   ├── Widget/
│   ├── hooks/
│   └── utils/
├── electron/                        # Electron layer
│   ├── api/
│   │   └── mainApi.js               # createMainApi factory
│   ├── controller/
│   ├── events/
│   ├── mcp/
│   │   └── mcpServerCatalog.json
│   ├── utils/
│   ├── widgetRegistry.js
│   ├── widgetCompiler.js
│   └── dynamicWidgetLoader.js
├── dist/                            # Build output — never edit manually
│   ├── index.js                     # Renderer CJS
│   ├── index.esm.js                 # Renderer ESM
│   └── electron/
│       └── index.js                 # Electron CJS
├── .github/workflows/
│   └── release-package.yml          # Auto-publish on push to master
├── package.json
├── rollup.config.renderer.mjs
├── rollup.config.electron.mjs
├── babel.config.json
└── tsconfig.json
```

---

## Key Patterns

### createMainApi Factory

Template apps use `createMainApi(extensions)` to combine dash-core APIs with custom ones:

```javascript
const { createMainApi } = require("@trops/dash-core/electron");

const api = createMainApi({
    algoliaApi: require("./api/algoliaApi"),
    openaiApi: require("./api/openaiApi"),
});
```

### Provider System — Critical Note

**Providers are read from `AppContext.providers`, NOT `DashboardContext.providers`.**

DashboardContext.providers is structurally empty because DashboardWrapper renders before
providers are loaded in the component tree. Always use:

```javascript
// Recommended
import { useWidgetProviders } from "@trops/dash-core";
const { providers } = useWidgetProviders();

// Alternative
import { useContext } from "react";
import { AppContext } from "@trops/dash-core";
const { providers } = useContext(AppContext);
```

### MCP Provider Lifecycle

1. Widget mounts → `useMcpProvider("slack")` hook runs
2. Hook reads provider from `AppContext.providers` (with `mcpConfig` and credentials)
3. Calls `dashApi.mcpStartServer()` → IPC → `mcpController` spawns stdio child process
4. Server returns available tools → hook filters by `allowedTools` if specified
5. Widget calls `callTool("send_message", args)` → 30-second timeout per call
6. On unmount, hook calls `mcpStopServer()` to clean up child process

### ComponentManager

- `registerContainerTypes(LayoutContainer, LayoutGridContainer)` — auto-called on import
- `registerWidget(config, name)` / `config(name)` for widget CRUD
- `_sourcePackage` field set on external widget configs by `registerBundleConfigs`
- `loadWidgetComponents` enriches registry entries with `.dash.js` metadata

### Widget Bundle Loading

- `widgetBundleLoader.js` evaluates CJS bundles with `new Function()` + require shim
- **Critical:** MODULE_MAP must include `@trops/dash-core` so external widgets share the ComponentManager singleton
- `extractWidgetConfigs` requires `typeof entry.component === "function"`

### Layout System

- **Grid path vs non-grid path**: Grid cells use `layout.find()` which returns raw items WITHOUT LayoutModel processing.
- **LayoutModel**: Refreshes `eventHandlers`/`events` from `ComponentManager.config()` — critical for keeping config fields up-to-date in the edit modal.

---

## Build and Publishing

### Build Commands

```bash
# Build both layers (use this for validation)
npm run build

# Build renderer only — development iteration only, not a substitute for npm run ci
npm run build:renderer

# Build electron only — development iteration only, not a substitute for npm run ci
npm run build:electron

# Clean dist
npm run clean

# Format code
npm run prettify
```

### Build Output Verification

After any build, always verify all three output files exist:

```bash
ls dist/index.js dist/index.esm.js dist/electron/index.js
```

A build that exits 0 but produces incomplete output is a silent failure.

### Rollup Configuration

**Renderer** (`rollup.config.renderer.mjs`):
- Input: `src/index.js`
- Output: CJS (`dist/index.js`) + ESM (`dist/index.esm.js`)
- Externals: react, react-dom, @trops/dash-react, @fortawesome/*, @babel/runtime

**Electron** (`rollup.config.electron.mjs`):
- Input: `electron/index.js`
- Output: CJS only (`dist/electron/index.js`)
- Externals: electron, Node builtins, esbuild, @anthropic-ai/sdk, @modelcontextprotocol/sdk, algoliasearch, openai, etc.

### Publishing

Automated via GitHub Actions on push to `master`:

1. `npm ci`
2. `npm run build`
3. `npm publish --provenance --access public`

Published to the **public npm registry** — no special `.npmrc` configuration required.

---

## Code Style

- **Formatting:** Prettier (`.prettierrc`), 4-space indentation
- **Components:** PascalCase (`MyWidget.js`)
- **Widget configs:** `{ComponentName}.dash.js`
- **Utilities:** camelCase (`layout.js`)
- **Contexts:** PascalCase with suffix (`ThemeContext.js`)
- **Electron layer:** CommonJS (`require` / `module.exports`)
- **Renderer layer:** ES modules (`import` / `export`)
- **UI components:** Always from `@trops/dash-react` — never built locally if dash-react provides it

---

## Related Projects

| Package | Purpose |
|---|---|
| `@trops/dash-react` | UI component library — the UX library for all Dash UI |
| `dash-electron` | Electron app template consuming dash-core |
| `dash` (original) | Original monolith, preserved as safety net only |

Sibling repos are not at a fixed path — they vary by developer machine. Always discover
them at runtime using `package.json` name matching (see Mandatory Pre-Work above).

---

## Key Files Reference

| File | Purpose |
|---|---|
| `src/index.js` | Main renderer export + auto-registration |
| `electron/index.js` | Main electron export |
| `electron/api/mainApi.js` | `createMainApi(extensions)` factory |
| `src/ComponentManager.js` | Widget registration system |
| `src/Context/ThemeWrapper.js` | Theme provider (imports ThemeContext from @trops/dash-react) |
| `src/Context/DashboardWrapper.js` | Dashboard context + provider passing |
| `src/hooks/useMcpProvider.js` | MCP server connection and tool calling |
| `src/hooks/useWidgetProviders.js` | Widget provider resolution |
| `src/hooks/useInstalledWidgets.js` | Merges builtin + installed widgets |
| `src/utils/widgetBundleLoader.js` | CJS bundle evaluation in renderer |
| `src/Models/LayoutModel.js` | Layout processing, refreshes events from ComponentManager |
| `src/Models/ComponentConfigModel.js` | Normalizes widget config with defaults |
| `electron/controller/providerController.js` | Provider CRUD + encryption |
| `electron/controller/mcpController.js` | MCP server spawn/stop/call |
| `electron/widgetRegistry.js` | Widget install/uninstall persistence |
| `electron/widgetCompiler.js` | esbuild compilation pipeline |
| `electron/mcp/mcpServerCatalog.json` | MCP server definitions |

---

## Troubleshooting

**Build exits 0 but dist files are missing:** Silent rollup failure — check for unresolved
imports or circular dependencies. Run `npm run build` with verbose output.

**`dist/electron/index.js` missing after build:** Electron rollup config may have failed
silently. Run `npm run build:electron` alone to isolate the error.

**Consumer app (dash-electron) breaks after a dash-core change:** Never modify dash-electron
as a workaround — fix the root cause in dash-core. Run `npm run ci` in dash-core first,
then re-test in dash-electron.

**ThemeContext not updating in consumer:** Verify ThemeContext is imported from
`@trops/dash-react` everywhere — a local import creates a duplicate context instance that
won't receive updates.

**MCP tools not appearing in widget:** Check that `AppContext.providers` (not
`DashboardContext.providers`) is the source. DashboardContext.providers is structurally empty.

---

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full documentation index:

- [Widget System](docs/WIDGET_SYSTEM.md)
- [Widget API](docs/WIDGET_API.md)
- [Widget Development](docs/WIDGET_DEVELOPMENT.md)
- [Widget Registry](docs/WIDGET_REGISTRY.md)
- [Provider Architecture](docs/PROVIDER_ARCHITECTURE.md)
- [Widget Provider Configuration](docs/WIDGET_PROVIDER_CONFIGURATION.md)
- [Testing](docs/TESTING.md)