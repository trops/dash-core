# Widget Registry & Dynamic Loading

Documentation for the widget registry system, packaging, and distribution in `@trops/dash-core`.

## Overview

The widget registry manages the lifecycle of external widgets — installation, compilation, registration, persistence, and distribution. It enables widgets to be installed at runtime without app restarts.

## Architecture

```
                    ┌──────────────────────┐
                    │   Widget Registry    │
                    │  (registry.json)     │
                    └──────┬───────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────────┐
    │ Widget       │ │ Dynamic  │ │ Component        │
    │ Compiler     │ │ Widget   │ │ Manager          │
    │ (esbuild)    │ │ Loader   │ │ (registration)   │
    └──────────────┘ └──────────┘ └──────────────────┘
```

### Key Components

| Component | File | Purpose |
|---|---|---|
| Widget Registry | `electron/widgetRegistry.js` | Install, uninstall, list, persistence |
| Widget Compiler | `electron/widgetCompiler.js` | esbuild compilation of widget sources |
| Dynamic Widget Loader | `electron/dynamicWidgetLoader.js` | Runtime loading of compiled bundles |
| Widget Bundle Loader | `src/utils/widgetBundleLoader.js` | CJS bundle evaluation in renderer |
| ComponentManager | `src/ComponentManager.js` | Widget registration system |

## Storage

### Locations

| Path | Contents |
|---|---|
| `~/Library/Application Support/{appId}/widgets/` | Installed widget source files |
| `~/Library/Application Support/{appId}/registry.json` | Widget metadata registry |
| `~/Library/Application Support/{appId}/widget-cache/` | Download cache |

### Registry Format (`registry.json`)

```json
{
    "weather-widget": {
        "name": "weather-widget",
        "version": "1.0.0",
        "path": "/path/to/widgets/weather-widget",
        "source": "registry",
        "installedAt": "2024-01-15T10:30:00Z",
        "displayName": "WeatherWidget",
        "icon": "cloud-sun",
        "providers": [],
        "workspace": "weather-workspace"
    }
}
```

**Note:** `displayName`, `icon`, `providers`, `workspace`, `events`, `eventHandlers` are persisted during `loadWidgetComponents` from the `.dash.js` config.

## Widget Structure

A distributable widget package must contain:

```
my-widget/
├── package.json              # name, version, description
├── widgets/
│   ├── MyWidget.js           # Widget component
│   └── MyWidget.dash.js      # Widget configuration
└── index.js                  # Exports
```

### Widget Configuration with Distribution Metadata

```javascript
// MyWidget.dash.js
import { MyWidget } from "./MyWidget";

export default {
    component: MyWidget,
    canHaveChildren: false,
    workspace: "my-widget-workspace",
    type: "widget",
    userConfig: {
        title: {
            type: "text",
            defaultValue: "My Widget",
            displayName: "Title",
            required: true,
        },
    },
};
```

### package.json

```json
{
    "name": "my-widget",
    "version": "1.0.0",
    "description": "A custom dashboard widget",
    "main": "index.js",
    "dashWidget": true,
    "downloadUrl": "https://github.com/org/repo/releases/download/v{version}/{name}.zip"
}
```

The `downloadUrl` supports template variables:
- `{version}` — replaced with the widget version
- `{name}` — replaced with the widget name

## Compilation Pipeline

The widget compiler (`electron/widgetCompiler.js`) uses **esbuild** to compile widget sources:

1. Reads `.js` and `.dash.js` files from the widget directory
2. Generates a synthetic entry that merges component + config
3. Compiles into a single CJS bundle
4. Bundle is evaluable via `new Function()` in the renderer

**Key requirements:**

- `typeof entry.component === "function"` (must export a React component)
- MODULE_MAP in `widgetBundleLoader.js` must include `@trops/dash-core` so external widgets share the ComponentManager singleton

## Installation Flow

### From URL

```javascript
await window.dashApi.widgets.install(
    "https://github.com/org/repo/releases/download/v1.0.0/my-widget.zip"
);
```

1. Download ZIP from URL → cache directory
2. Extract to widgets storage directory
3. Compile with esbuild
4. Add to registry.json
5. Fire `widget:installed` event
6. Renderer receives event → registers with ComponentManager

### From Local Path

```javascript
await window.dashApi.widgets.installLocal("/path/to/my-widget");
```

1. Copy widget directory to storage
2. Compile with esbuild
3. Add to registry.json
4. Fire `widget:installed` event

## Publishing Workflow

### Creating a New Widget

In the consuming app (e.g., dash-electron):

```bash
# Generate scaffold
node ./scripts/widgetize MyWidget
```

### Packaging

1. Develop and test the widget locally
2. Create a ZIP archive containing the widget directory
3. Host the ZIP (GitHub Releases, CDN, etc.)

### Versioning

Follow semver in `package.json`. The `downloadUrl` template supports version interpolation:

```
https://github.com/org/repo/releases/download/v{version}/{name}.zip
```

### Distribution Methods

| Method | Example |
|---|---|
| GitHub Releases | `https://github.com/org/repo/releases/download/v1.0.0/widget.zip` |
| Direct URL | `https://cdn.example.com/widgets/my-widget-1.0.0.zip` |
| Local path | `/Users/dev/my-widgets/my-widget` |
| Drop-in folder | Place in `~/Library/Application Support/{appId}/widgets/` |

## Startup Loading

At app startup:

1. Widget registry reads `registry.json`
2. For each registered widget, `dynamicWidgetLoader` loads the compiled bundle
3. `widgetBundleLoader.js` evaluates bundles with `new Function()` + require shim
4. `loadWidgetComponents` enriches registry entries with `.dash.js` metadata
5. App's `Dash.js` calls `registerBundleConfigs` to register with ComponentManager
6. `_sourcePackage` is set on external widget configs for deduplication

## Advanced Usage

### Main Process API

```javascript
const { widgetRegistry } = require("@trops/dash-core/electron");

// List all widgets
const widgets = widgetRegistry.list();

// Install from URL
const widget = await widgetRegistry.install(url);

// Uninstall
await widgetRegistry.uninstall("widget-name");
```

### Renderer Process

```javascript
// Using the useInstalledWidgets hook
import { useInstalledWidgets } from "@trops/dash-core";

function WidgetSettings() {
    const { widgets, installWidget, uninstallWidget } = useInstalledWidgets();
    // widgets = merged array of builtin + installed widgets
}
```

**Ghost widget prevention:** `useInstalledWidgets.uninstallWidget()` removes ComponentManager entries matching `_sourcePackage` before calling main-process uninstall, preventing ghost "builtin" entries.
