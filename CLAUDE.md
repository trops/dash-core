# @trops/dash-core — Core Dashboard Framework

## Project Overview

`@trops/dash-core` is the core framework for Dash dashboard applications. It provides the widget system, provider architecture, context providers, layout engine, and Electron main process layer. Consuming apps (e.g., `dash-electron`) use this as their foundation.

**Package:** `@trops/dash-core`
**Repository:** [github.com/trops/dash-core](https://github.com/trops/dash-core)

**Two export paths:**

- `@trops/dash-core` — Renderer layer (ESM + CJS). Platform-agnostic React components, contexts, hooks, models, and utilities. Zero Electron dependencies.
- `@trops/dash-core/electron` — Electron layer (CJS only). Controllers, IPC handlers, events, widget pipeline, and the `createMainApi` factory.

**Peer dependencies:** `react ^18.2.0`, `react-dom ^18.2.0`, `@trops/dash-react >=0.1.187`

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
| **Components** | `Components/` | Dashboard, Layout (Builder, Grid, Container), Settings, Navigation, Theme, Provider, Menu, Workspace |
| **Widget** | `Widget/` | Widget, WidgetFactory, ExternalWidget |
| **DashboardPublisher** | `DashboardPublisher.js` | Dashboard state publishing |
| **ErrorBoundary** | `ErrorBoundary.js` | React error boundary |
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
| **Utils** | `utils/` | file, color, browser, transform, ntc, algolia |

### Entry Points

**Renderer** (`src/index.js`):
```javascript
import { ComponentManager, DashboardPublisher, useDashboard, ... } from "@trops/dash-core";
```
Auto-registers LayoutContainer and LayoutGridContainer with ComponentManager on import.

**Electron** (`electron/index.js`):
```javascript
const { createMainApi, providerController, mcpController, ... } = require("@trops/dash-core/electron");
```

## Directory Structure

```
dash-core/
├── src/                            # Renderer layer
│   ├── Api/
│   │   ├── DashboardApi.js
│   │   ├── ElectronDashboardApi.ts  # Typed API with MCP methods
│   │   ├── IDashboardApi.ts
│   │   ├── MockDashboardApi.ts
│   │   ├── WebDashboardApi.ts
│   │   ├── WidgetApi.js
│   │   ├── WidgetHelpers.js
│   │   └── ThemeApi.js
│   ├── ComponentManager.js
│   ├── Components/
│   │   ├── Dashboard/
│   │   ├── Layout/                  # LayoutBuilder, LayoutContainer, LayoutGridContainer
│   │   ├── Navigation/
│   │   ├── Settings/
│   │   ├── Theme/
│   │   ├── Provider/                # McpServerPicker, ProviderForm, etc.
│   │   ├── Menu/
│   │   └── Workspace/
│   ├── Context/
│   │   ├── AppThemeScope.js
│   │   ├── DashboardContext.js
│   │   ├── DashboardThemeProvider.js
│   │   ├── DashboardWrapper.js
│   │   ├── ProviderContext.js
│   │   ├── ThemeWrapper.js
│   │   ├── WidgetContext.js
│   │   └── WorkspaceContext.js
│   ├── DashboardPublisher.js
│   ├── ErrorBoundary.js
│   ├── Models/
│   │   ├── ColorModel.js
│   │   ├── ComponentConfigModel.js
│   │   ├── ContextModel.js
│   │   ├── DashboardItemModel.js
│   │   ├── DashboardModel.js
│   │   ├── LayoutModel.js
│   │   ├── MenuItemModel.js
│   │   ├── SettingsModel.js
│   │   ├── ThemeModel.js
│   │   └── WorkspaceModel.js
│   ├── Widget/
│   │   ├── ExternalWidget.js
│   │   ├── Widget.js
│   │   └── WidgetFactory.js
│   ├── hooks/
│   │   ├── useDashboard.js
│   │   ├── useInstalledWidgets.js
│   │   ├── useMcpProvider.js
│   │   ├── useRegistrySearch.js
│   │   ├── useWidgetEvents.js
│   │   └── useWidgetProviders.js
│   └── utils/
│       ├── DynamicWidgetLoader.js
│       ├── WidgetRegistry.js
│       ├── dragTypes.js
│       ├── layout.js
│       ├── mcpUtils.js
│       ├── plugin-loader.js
│       ├── resolveIcon.js
│       ├── themeGenerator.js
│       ├── validation.js
│       └── widgetBundleLoader.js
├── electron/                        # Electron layer
│   ├── api/
│   │   ├── mainApi.js               # createMainApi factory
│   │   ├── providerApi.js
│   │   ├── mcpApi.js
│   │   ├── widgetApi.js
│   │   ├── registryApi.js
│   │   ├── workspaceApi.js
│   │   ├── themeApi.js
│   │   ├── layoutApi.js
│   │   ├── dataApi.js
│   │   ├── settingsApi.js
│   │   ├── secureStoreApi.js
│   │   ├── dialogApi.js
│   │   ├── algoliaApi.js
│   │   ├── openaiApi.js
│   │   ├── menuItemsApi.js
│   │   └── pluginApi.js
│   ├── controller/
│   │   ├── providerController.js    # Provider CRUD + encryption
│   │   ├── mcpController.js         # MCP server lifecycle
│   │   ├── workspaceController.js
│   │   ├── themeController.js
│   │   ├── settingsController.js
│   │   ├── layoutController.js
│   │   ├── dataController.js
│   │   ├── registryController.js
│   │   ├── secureStoreController.js
│   │   ├── dialogController.js
│   │   ├── algoliaController.js
│   │   ├── openaiController.js
│   │   ├── menuItemsController.js
│   │   └── pluginController.js
│   ├── events/                      # Event channel definitions
│   ├── mcp/
│   │   └── mcpServerCatalog.json
│   ├── utils/
│   ├── widgetRegistry.js            # Widget install/uninstall persistence
│   ├── widgetCompiler.js            # esbuild compilation
│   └── dynamicWidgetLoader.js       # Runtime widget loading
├── .github/workflows/
│   └── release-package.yml          # Auto-publish on push to master
├── package.json
├── rollup.config.renderer.mjs
├── rollup.config.electron.mjs
├── babel.config.json
└── tsconfig.json
```

## Key Patterns

### createMainApi Factory

Template apps use `createMainApi(extensions)` to combine dash-core APIs with custom ones:

```javascript
// In consuming app's electron.js / preload.js
const { createMainApi } = require("@trops/dash-core/electron");

const api = createMainApi({
    algoliaApi: require("./api/algoliaApi"),
    openaiApi: require("./api/openaiApi"),
});
```

Core APIs (providers, MCP, widgets, themes, workspaces, etc.) are built-in. Extensions add template-specific APIs.

### Provider System — Critical Note

**Providers are read from `AppContext.providers`, NOT `DashboardContext.providers`.**

DashboardContext.providers is structurally empty because DashboardWrapper renders before providers are loaded in the component tree. Always use:

```javascript
// Recommended
import { useWidgetProviders } from "@trops/dash-core";
const { providers } = useWidgetProviders();

// Alternative
import { useContext } from "react";
import { AppContext } from "@trops/dash-core";
const { providers } = useContext(AppContext);
```

### ThemeContext Import Rule

Always import `ThemeContext` from `@trops/dash-react` — never from a local context file:

```javascript
// CORRECT
import { ThemeContext } from "@trops/dash-react";

// WRONG — creates dual context instances
import { ThemeContext } from "./Context/ThemeContext";
```

### FontAwesomeIcon Import Rule

Always import `FontAwesomeIcon` from `@trops/dash-react`:

```javascript
// CORRECT
import { FontAwesomeIcon } from "@trops/dash-react";

// WRONG — duplicates the dependency
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
```

### MCP Provider Lifecycle

1. Widget mounts → `useMcpProvider("slack")` hook runs
2. Hook reads provider from `AppContext.providers` (with `mcpConfig` and credentials)
3. Calls `dashApi.mcpStartServer()` → IPC → `mcpController` spawns stdio child process
4. Server returns available tools → hook filters by `allowedTools` if specified
5. Widget calls `callTool("send_message", args)` → 30-second timeout per call
6. On unmount, hook calls `mcpStopServer()` to clean up child process

Tool scoping enforced at both hook level (client-side filter) and main process level (mcpController validates allowedTools).

### ComponentManager

- `registerContainerTypes(LayoutContainer, LayoutGridContainer)` — auto-called when `@trops/dash-core` is imported
- `registerWidget(config, name)` / `config(name)` for widget CRUD
- `_sourcePackage` field set on external widget configs by `registerBundleConfigs` in consuming app's Dash.js
- `loadWidgetComponents` enriches registry entries with `.dash.js` metadata (displayName, icon, providers, workspace, events, eventHandlers)

### Widget Bundle Loading

- `widgetBundleLoader.js` evaluates CJS bundles with `new Function()` + require shim (MODULE_MAP)
- **Critical:** MODULE_MAP must include `@trops/dash-core` so external widgets share the ComponentManager singleton
- `extractWidgetConfigs` requires `typeof entry.component === "function"`

### Layout System

- **Grid path vs non-grid path**: Grid cells (`LayoutGridContainer.renderEditCell`) use `layout.find()` which returns raw items WITHOUT LayoutModel processing. Non-grid path processes through LayoutModel.
- **LayoutModel**: Refreshes `eventHandlers`/`events` from `ComponentManager.config()` — critical for keeping config fields up-to-date in the edit modal.

## Development Workflow

### Building

```bash
# Build both layers
npm run build

# Build renderer only (ESM + CJS)
npm run build:renderer

# Build electron only (CJS)
npm run build:electron

# Clean dist
npm run clean

# Format code
npm run prettify
```

### Build Output

```
dist/
├── index.js          # Renderer CJS
├── index.esm.js      # Renderer ESM
└── electron/
    └── index.js      # Electron CJS
```

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

Published to npm as `@trops/dash-core`.

### Validation

After making changes:

```bash
# Quick check
npm run build

# Format + build
npm run prettify && npm run build
```

**Success criteria:**
- No build errors
- `dist/index.js`, `dist/index.esm.js`, `dist/electron/index.js` all created
- No unresolved import errors

## Code Style

- **Formatting:** Prettier (`.prettierrc`), 4-space indentation
- **Components:** PascalCase (`MyWidget.js`)
- **Widget configs:** `{ComponentName}.dash.js`
- **Utilities:** camelCase (`layout.js`)
- **Contexts:** PascalCase with suffix (`ThemeContext.js`)
- **Electron layer:** CommonJS (`require` / `module.exports`)
- **Renderer layer:** ES modules (`import` / `export`)

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

## Related Packages

| Package | Location | Purpose |
|---|---|---|
| `@trops/dash-react` | `~/Development/dash-react/dash-react/` | UI component library (Panel, Button, ThemeContext, etc.) |
| `dash-electron` | `~/Development/dash-electron/dash-electron/` | Electron app template using dash-core |
| `dash` (original) | `~/Development/dash/dash/` | Original monolith, preserved as safety net |

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full documentation index:

- [Widget System](docs/WIDGET_SYSTEM.md) — Architecture, auto-registration, hot reload
- [Widget API](docs/WIDGET_API.md) — Management methods reference
- [Widget Development](docs/WIDGET_DEVELOPMENT.md) — Create and test widgets
- [Widget Registry](docs/WIDGET_REGISTRY.md) — Packaging and distribution
- [Provider Architecture](docs/PROVIDER_ARCHITECTURE.md) — Three-tier storage, encryption, MCP
- [Widget Provider Configuration](docs/WIDGET_PROVIDER_CONFIGURATION.md) — Provider config in .dash.js
- [Testing](docs/TESTING.md) — Testing workflows and checklists
