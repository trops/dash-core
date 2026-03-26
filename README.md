# @trops/dash-core

Core framework for Dash dashboard applications. Provides the widget system, provider architecture, context providers, layout engine, and Electron main process layer used by all Dash apps.

## Installation

```bash
npm install @trops/dash-core
```

**Peer dependencies:**

```json
{
  "@trops/dash-react": ">=0.1.187",
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

## Two Export Paths

### Renderer (React)

Platform-agnostic UI framework — contexts, hooks, models, components, widget system.

```javascript
import {
  ComponentManager,
  DashboardPublisher,
  ErrorBoundary,
  // Contexts
  AppContext,
  DashboardContext,
  ThemeWrapper,
  ProviderContext,
  // Hooks
  useDashboard,
  useMcpProvider,
  useWidgetProviders,
  useInstalledWidgets,
  // Models
  DashboardModel,
  LayoutModel,
  ThemeModel,
  // Components
  LayoutBuilder,
  SettingsPanel,
  NavigationBar,
  // Widget
  Widget,
  WidgetFactory,
  ExternalWidget,
} from "@trops/dash-core";
```

### Electron (Main Process)

Controllers, IPC handlers, events, and widget pipeline for Electron apps.

```javascript
const {
  // Factory
  createMainApi,
  // Controllers
  providerController,
  mcpController,
  workspaceController,
  themeController,
  registryController,
  // Widget pipeline
  widgetRegistry,
  widgetCompiler,
  dynamicWidgetLoader,
  // Events
  events,
} = require("@trops/dash-core/electron");
```

## Architecture

```
@trops/dash-core
├── src/                    Renderer layer (ESM + CJS)
│   ├── Api/                IPC API clients
│   ├── Components/         Dashboard, Layout, Settings, Navigation, etc.
│   ├── Context/            React Context providers
│   ├── Models/             Data models (Dashboard, Layout, Theme, etc.)
│   ├── Widget/             Widget, WidgetFactory, ExternalWidget
│   ├── hooks/              useDashboard, useMcpProvider, useWidgetProviders
│   └── utils/              Bundle loader, layout helpers, validation
│
└── electron/               Electron layer (CJS only)
    ├── api/                IPC handlers + createMainApi factory
    ├── controller/         Business logic (providers, MCP, themes, etc.)
    ├── events/             Event definitions
    ├── mcp/                MCP server catalog
    └── utils/              File, color, browser utilities
```

### Renderer Layer (`src/`)

Platform-agnostic UI framework.

| Module               | Key Files             | Purpose                                                                                                                                      |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **ComponentManager** | `ComponentManager.js` | Widget/workspace registration, config resolution                                                                                             |
| **Context**          | `Context/`            | AppContext, DashboardContext, ThemeWrapper, ProviderContext, WidgetContext, WorkspaceContext                                                 |
| **Hooks**            | `hooks/`              | useDashboard, useMcpProvider, useWidgetProviders, useInstalledWidgets, useWidgetEvents, useRegistrySearch                                    |
| **Models**           | `Models/`             | DashboardModel, LayoutModel, ThemeModel, ComponentConfigModel, SettingsModel, etc.                                                           |
| **Api**              | `Api/`                | DashboardApi, ElectronDashboardApi (typed), WidgetApi, ThemeApi, MockDashboardApi                                                            |
| **Components**       | `Components/`         | Dashboard, Layout, Settings, Navigation, Theme, Provider, Menu, Workspace                                                                    |
| **Widget**           | `Widget/`             | Widget, WidgetFactory, ExternalWidget                                                                                                        |
| **Utils**            | `utils/`              | widgetBundleLoader, layout, validation, mcpUtils, dragTypes, resolveIcon, themeGenerator, DynamicWidgetLoader, WidgetRegistry, plugin-loader |

### Electron Layer (`electron/`)

Main process controllers, APIs, and widget pipeline.

| Module              | Key Files                                                          | Purpose                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Controllers**     | `controller/`                                                      | providerController, mcpController, workspaceController, themeController, settingsController, layoutController, dataController, registryController, secureStoreController, dialogController, algoliaController, openaiController, menuItemsController, pluginController |
| **APIs**            | `api/`                                                             | IPC handlers for each controller + `mainApi.js` (createMainApi factory)                                                                                                                                                                                                |
| **Events**          | `events/`                                                          | Event channel definitions for each module                                                                                                                                                                                                                              |
| **Widget Pipeline** | `widgetRegistry.js`, `widgetCompiler.js`, `dynamicWidgetLoader.js` | Install, compile (esbuild), and load external widgets                                                                                                                                                                                                                  |
| **MCP**             | `mcp/mcpServerCatalog.json`                                        | MCP server definitions (transport, command, args, env mapping)                                                                                                                                                                                                         |

### Directory Structure

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
├── docs/                            # Documentation
│   ├── requirements/                # PRDs and feature specs
│   │   └── prd/                     # Product Requirements Documents
│   └── *.md                         # Technical docs
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

Template apps use `createMainApi(extensions)` to combine core APIs with custom ones:

```javascript
const { createMainApi } = require("@trops/dash-core/electron");

const api = createMainApi({
  myCustomApi: require("./myCustomApi"),
});
```

### Provider System

Providers are read from `AppContext.providers`, **not** `DashboardContext.providers`. This is due to component tree ordering — DashboardWrapper renders before providers are loaded.

### ThemeContext Import Rule

Always import `ThemeContext` from `@trops/dash-react` to avoid dual context instances:

```javascript
// CORRECT
import { ThemeContext } from "@trops/dash-react";

// WRONG — creates separate context
import { ThemeContext } from "./Context/ThemeContext";
```

### MCP Provider Lifecycle

1. Widget mounts -> `useMcpProvider("slack")` hook runs
2. Hook reads provider from `AppContext.providers` (with `mcpConfig` and credentials)
3. Calls `dashApi.mcpStartServer()` -> IPC -> `mcpController` spawns stdio child process
4. Server returns available tools -> hook filters by `allowedTools` if specified
5. Widget calls `callTool("send_message", args)` -> 30-second timeout per call
6. On unmount, hook calls `mcpStopServer()` to clean up child process

### ComponentManager

- `registerContainerTypes(LayoutContainer, LayoutGridContainer)` -- auto-called on import
- `registerWidget(config, name)` / `config(name)` for widget CRUD
- `_sourcePackage` field set on external widget configs by `registerBundleConfigs`
- `loadWidgetComponents` enriches registry entries with `.dash.js` metadata

### Widget Bundle Loading

- `widgetBundleLoader.js` evaluates CJS bundles with `new Function()` + require shim
- **Critical:** MODULE_MAP must include `@trops/dash-core` so external widgets share the ComponentManager singleton
- `extractWidgetConfigs` requires `typeof entry.component === "function"`

### Layout System

- **Grid path vs non-grid path**: Grid cells use `layout.find()` which returns raw items WITHOUT LayoutModel processing.
- **LayoutModel**: Refreshes `eventHandlers`/`events` from `ComponentManager.config()` -- critical for keeping config fields up-to-date in the edit modal.

## Key Files

| File                                        | Purpose                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `src/index.js`                              | Main renderer export + auto-registration                     |
| `electron/index.js`                         | Main electron export                                         |
| `electron/api/mainApi.js`                   | `createMainApi(extensions)` factory                          |
| `src/ComponentManager.js`                   | Widget registration system                                   |
| `src/Context/ThemeWrapper.js`               | Theme provider (imports ThemeContext from @trops/dash-react) |
| `src/Context/DashboardWrapper.js`           | Dashboard context + provider passing                         |
| `src/hooks/useMcpProvider.js`               | MCP server connection and tool calling                       |
| `src/hooks/useWidgetProviders.js`           | Widget provider resolution                                   |
| `src/hooks/useInstalledWidgets.js`          | Merges builtin + installed widgets                           |
| `src/utils/widgetBundleLoader.js`           | CJS bundle evaluation in renderer                            |
| `src/Models/LayoutModel.js`                 | Layout processing, refreshes events from ComponentManager    |
| `src/Models/ComponentConfigModel.js`        | Normalizes widget config with defaults                       |
| `electron/controller/providerController.js` | Provider CRUD + encryption                                   |
| `electron/controller/mcpController.js`      | MCP server spawn/stop/call                                   |
| `electron/widgetRegistry.js`                | Widget install/uninstall persistence                         |
| `electron/widgetCompiler.js`                | esbuild compilation pipeline                                 |
| `electron/mcp/mcpServerCatalog.json`        | MCP server definitions                                       |

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full documentation index:

- [Widget System](docs/WIDGET_SYSTEM.md) -- Architecture, auto-registration, hot reload
- [Widget API](docs/WIDGET_API.md) -- Management methods reference
- [Widget Development](docs/WIDGET_DEVELOPMENT.md) -- Create and test widgets
- [Widget Registry](docs/WIDGET_REGISTRY.md) -- Packaging and distribution
- [Provider Architecture](docs/PROVIDER_ARCHITECTURE.md) -- Three-tier storage model
- [Widget Provider Configuration](docs/WIDGET_PROVIDER_CONFIGURATION.md) -- Configure providers in widgets
- [Testing](docs/TESTING.md) -- Provider and widget testing guides
- [Product Requirements](docs/requirements/README.md) -- PRDs and feature specs

## Related Packages

| Package             | Purpose               | Location                                                |
| ------------------- | --------------------- | ------------------------------------------------------- |
| `@trops/dash-react` | UI component library  | [dash-react](https://github.com/trops/dash-react)       |
| `dash-electron`     | Electron app template | [dash-electron](https://github.com/trops/dash-electron) |

## Development

```bash
# Build both layers
npm run build

# Build renderer only
npm run build:renderer

# Build electron only
npm run build:electron

# Format code
npm run prettify
```

Publishing is automated via GitHub Actions on push to `master`.

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
- Externals: react, react-dom, @trops/dash-react, @fortawesome/\*, @babel/runtime

**Electron** (`rollup.config.electron.mjs`):

- Input: `electron/index.js`
- Output: CJS only (`dist/electron/index.js`)
- Externals: electron, Node builtins, esbuild, @anthropic-ai/sdk, @modelcontextprotocol/sdk, algoliasearch, openai, etc.

## Troubleshooting

**Build exits 0 but dist files are missing:** Silent rollup failure -- check for unresolved imports or circular dependencies.

**`dist/electron/index.js` missing after build:** Electron rollup config may have failed silently. Run `npm run build:electron` alone to isolate.

**Consumer app breaks after a dash-core change:** Fix root cause in dash-core, don't modify dash-electron as workaround.

**ThemeContext not updating in consumer:** Verify ThemeContext is imported from `@trops/dash-react` everywhere.

**MCP tools not appearing in widget:** Check that `AppContext.providers` (not `DashboardContext.providers`) is the source.

## License

MIT
