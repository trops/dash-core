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

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full documentation index:

- [Widget System](docs/WIDGET_SYSTEM.md) — Architecture, auto-registration, hot reload
- [Widget API](docs/WIDGET_API.md) — Management methods reference
- [Widget Development](docs/WIDGET_DEVELOPMENT.md) — Create and test widgets
- [Widget Registry](docs/WIDGET_REGISTRY.md) — Packaging and distribution
- [Provider Architecture](docs/PROVIDER_ARCHITECTURE.md) — Three-tier storage model
- [Widget Provider Configuration](docs/WIDGET_PROVIDER_CONFIGURATION.md) — Configure providers in widgets
- [Testing](docs/TESTING.md) — Provider and widget testing guides

## Related Packages

| Package | Purpose | Location |
|---|---|---|
| `@trops/dash-react` | UI component library | [dash-react](https://github.com/trops/dash-react) |
| `dash-electron` | Electron app template | [dash-electron](https://github.com/trops/dash-electron) |

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

## License

MIT
