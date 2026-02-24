# Widget System Architecture

Consolidated reference for how widgets work in `@trops/dash-core`. Covers architecture, configuration, runtime loading, the compilation pipeline, and data flow.

## Overview

Widgets are reusable React components in the Dash framework. The widget system provides a widget-based dashboard architecture with workspaces, contexts, and dependency injection -- all provided by `@trops/dash-core`.

The system spans two layers:

- **Renderer layer** (`src/`) -- React components, hooks, contexts, ComponentManager, bundle loading
- **Electron layer** (`electron/`) -- Widget registry, compiler, dynamic loader, IPC handlers

## Key Concepts

1. **Widgets** -- React components paired with `.dash.js` configuration files that define metadata, user-configurable properties, and event contracts.
2. **Workspaces** -- Container components that host related widgets and provide shared context via React Context.
3. **Contexts** -- React Context-based dependency injection for sharing state between a workspace and its child widgets.
4. **ComponentManager** -- Central registry for widgets and workspaces. All widget lookups, registrations, and configuration queries go through this singleton.
5. **Widget API** -- Injected into widgets as the `api` prop. Provides event publishing (`api.publishEvent`), data persistence (`api.storeData`, `api.readData`), and inter-widget communication (`api.registerListeners`).

## File Structure

Widget packages follow this structure:

```
MyWidget/
├── widgets/
│   ├── MyWidget.js              # Widget React component
│   └── MyWidget.dash.js         # Widget configuration
├── workspaces/
│   ├── MyWidgetWorkspace.js
│   └── MyWidgetWorkspace.dash.js
├── contexts/
│   └── MyWidgetContext.js       # Optional shared context
└── index.js                     # Package entry point
```

> **Note:** The `Widgets/` directory for custom widgets lives in the consuming app's `src/` directory (e.g., `dash-electron/src/Widgets/`), not in dash-core itself.

## Widget Configuration (.dash.js)

Every widget has a companion `.dash.js` file that exports its configuration:

```javascript
import { MyWidget } from "./MyWidget";

export default {
    component: MyWidget,
    canHaveChildren: false,
    workspace: "my-workspace-name",
    type: "widget",
    userConfig: {
        title: {
            type: "text",
            defaultValue: "My Widget",
            displayName: "Title",
            required: true,
            instructions: "Enter a title for the widget",
        },
    },
    events: [],
    eventHandlers: [],
};
```

### Configuration Reference

| Field | Type | Description |
|---|---|---|
| `component` | React component (required) | The widget's React component |
| `canHaveChildren` | boolean | Whether the widget can contain child widgets |
| `workspace` | string | Workspace name for grouping |
| `type` | `"widget"` or `"workspace"` | Component type |
| `userConfig` | object | User-configurable fields (see below) |
| `providers` | array | Provider requirements (`type`, `providerClass`, `required`, `allowedTools`) |
| `events` | array | Events the widget publishes |
| `eventHandlers` | array | Events the widget listens to |
| `styles` | object | Default Tailwind classes (`backgroundColor`, `borderColor`) |

### userConfig Field Types

Each key in `userConfig` defines a configurable property:

```javascript
userConfig: {
    color: {
        type: "select",           // text | number | select | etc.
        defaultValue: "blue",
        displayName: "Color",     // Label shown in the settings UI
        instructions: "Pick a color theme",
        required: false,
        options: [                // For "select" type
            { value: "blue", displayName: "Blue" },
            { value: "red", displayName: "Red" },
        ],
    },
}
```

### MCP Provider Configuration

Widgets that connect to MCP servers declare provider requirements:

```javascript
providers: [
    {
        type: "slack",
        providerClass: "mcp",       // "mcp" or "credential"
        required: true,
        // Optional: restrict which tools the widget can call
        // allowedTools: ["send_message", "list_channels"],
    },
],
```

## ComponentManager

`ComponentManager` (`src/ComponentManager.js`) is the central registry for all widgets and workspaces.

### Core API

- `registerWidget(config, name)` -- Register a widget or workspace
- `config(name)` -- Retrieve a widget's configuration
- `registerContainerTypes()` -- Register layout container components (LayoutContainer, LayoutGridContainer)
- `deregister(name)` -- Remove a widget from the registry

### Auto-Registration Flow

When `@trops/dash-core` is imported, container types are registered automatically:

1. App imports from `@trops/dash-core`
2. `src/index.js` auto-registers `LayoutContainer` and `LayoutGridContainer` via `registerContainerTypes()`
3. The consuming app (e.g., dash-electron) registers its own built-in widgets via `ComponentManager.registerWidget()`
4. External (installed) widgets are registered via `registerBundleConfigs()` in the app's `Dash.js`

### _sourcePackage Field

When external widgets are registered via `registerBundleConfigs`, each config entry receives a `_sourcePackage` field set to the widget's package name. This field is used for deduplication in the settings UI (`useInstalledWidgets`) and for identifying which widgets came from external packages vs. built-in ones.

## Context Pattern

Workspaces provide context, widgets consume it:

```javascript
// contexts/WeatherWidgetContext.js
export const WeatherWidgetContext = React.createContext({});

// workspaces/WeatherWidgetWorkspace.js
import { WeatherWidgetContext } from "../contexts";

export const WeatherWidgetWorkspace = ({ children }) => {
    const weatherData = useWeatherApi();
    return (
        <WeatherWidgetContext.Provider value={{ weatherData }}>
            {children}
        </WeatherWidgetContext.Provider>
    );
};

// widgets/WeatherWidget.js
import { WeatherWidgetContext } from "../contexts";

export const WeatherWidget = (props) => {
    const { weatherData } = useContext(WeatherWidgetContext);
    return <div>{weatherData.temp}</div>;
};
```

## Widget API (Injected Props)

Every widget receives an `api` prop with these methods:

```javascript
// Persist widget data
api.storeData({ myData: "value" });

// Load persisted data
api.readData({
    callbackComplete: (data) => setState(data),
    callbackError: (err) => console.error(err),
});

// Publish an event to other widgets
api.publishEvent("user-action", { data: "value" });

// Listen for events from other widgets
api.registerListeners(["user-action"], {
    "user-action": (payload) => {
        console.log("Received:", payload.data);
    },
});
```

## Hot Reload and Runtime Loading

The widget system supports loading widgets at runtime without restarting the application.

### Startup Flow

```
1. Electron main process starts
   |
2. IPC handlers registered (setupWidgetRegistryHandlers)
   |
3. React app loads
   |
4. Dash.js mounts
   |-- initializeWidgetSystems()     <- Sets up ComponentManager integration
   |-- loadDownloadedWidgets()       <- Loads all previously installed widgets
   |
5. For each installed widget:
   a. Discover components (*.dash.js files)
   b. Compile via widgetCompiler (esbuild)
   c. Register with ComponentManager
   |
6. All widgets registered and ready
```

### Runtime Installation Flow

```
1. User triggers install (UI or API call)
   |
2. mainApi.widgets.install('Weather', downloadUrl)
   |
3. IPC -> Electron main process
   |
4. widgetRegistry.downloadWidget()
   a. Fetch ZIP from URL
   b. Extract to ~/Library/Application Support/{appId}/widgets/Weather/
   c. Load widget config (package.json)
   d. Call loadWidgetComponents()
   |
5. loadWidgetComponents()
   a. Discover components (*.dash.js files)
   b. Compile with widgetCompiler (esbuild)
   c. Register with ComponentManager
   |
6. Main process sends IPC event:
   BrowserWindow.send('widget:installed', { widgetName, config })
   |
7. Renderer receives event, widget is immediately available
   No restart required
```

### Event System

Events sent from main process to renderer:

**`widget:installed`** -- Fired when a single widget is installed:

```javascript
{
    widgetName: "Weather",
    config: {
        name: "Weather",
        version: "1.0.0",
        description: "..."
    }
}
```

**`widgets:loaded`** -- Fired when a batch of widgets is loaded (e.g., on startup):

```javascript
{
    count: 3,
    widgets: [
        { name: "Weather", path: "...", version: "1.0.0" },
        { name: "Calendar", path: "...", version: "2.0.0" }
    ]
}
```

## Widget Pipeline (Electron Layer)

These files are in the `electron/` directory and exported via `@trops/dash-core/electron`:

### widgetRegistry.js (`electron/widgetRegistry.js`)

Manages widget installation, uninstallation, listing, and persistence to `registry.json`.

Key methods:
- `downloadWidget()` -- Download and install from URL
- `installFromLocalPath()` -- Install from local ZIP or folder
- `registerWidgetsFromFolder()` -- Batch register widgets
- `loadWidgetComponents()` -- Discover and load components after install
- `uninstallWidget()` -- Remove widget files and registry entry

### widgetCompiler.js (`electron/widgetCompiler.js`)

Uses esbuild to compile `.js` + `.dash.js` files into a single CJS bundle. Generates a synthetic entry point that merges the component and its configuration.

### dynamicWidgetLoader.js (`electron/dynamicWidgetLoader.js`)

Runtime loading of compiled widgets. Discovers widget components in widget directories and coordinates with the compiler and ComponentManager.

Key methods:
- `discoverWidgets()` -- Find all components in a widget directory
- `loadWidget()` -- Load a single component
- `loadConfigFile()` -- Parse `.dash.js` configuration

### Storage Location

```
~/Library/Application Support/{appId}/widgets/
├── Weather/
│   ├── package.json
│   └── widgets/
│       ├── WeatherWidget.js
│       └── WeatherWidget.dash.js
├── Calendar/
│   └── ...
└── registry.json
```

## Bundle Loading (Renderer Layer)

### widgetBundleLoader.js (`src/utils/widgetBundleLoader.js`)

Evaluates compiled CJS bundles in the renderer process using `new Function()` with a require shim (MODULE_MAP).

**Critical:** The MODULE_MAP must include `@trops/dash-core` so that external widgets share the same `ComponentManager` singleton as the host application. Without this, external widgets would get their own instance and registrations would be invisible to the dashboard.

Key behavior:
- `extractWidgetConfigs` requires `typeof entry.component === "function"` to validate that a bundle contains a valid React component
- Bundles are evaluated in a sandboxed scope with controlled access to dependencies

### Supporting Renderer Files

- `src/utils/WidgetRegistry.js` -- Renderer-side widget registry utilities
- `src/utils/DynamicWidgetLoader.js` -- Renderer-side dynamic loading utilities
- `src/hooks/useInstalledWidgets.js` -- Hook that merges built-in + installed widgets for the settings UI

## Data Flow

```
UI (React)
    |
    | mainApi.widgets.*()
    |
    v
IPC Channel (ipcRenderer.invoke)
    |
    v
Electron Main Process
    |
    +-- widgetRegistry.js (persistence, install/uninstall)
    |
    +-- widgetCompiler.js (esbuild compilation)
    |
    +-- dynamicWidgetLoader.js (discovery, loading)
    |
    +-- ComponentManager (registration)
    |
    v
Filesystem: ~/Library/Application Support/{appId}/widgets/
```

### IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `widget:list` | Renderer -> Main | List all installed widgets |
| `widget:get` | Renderer -> Main | Get a single widget's metadata |
| `widget:install` | Renderer -> Main | Install from URL |
| `widget:install-local` | Renderer -> Main | Install from local ZIP or folder |
| `widget:load-folder` | Renderer -> Main | Batch load from a directory |
| `widget:uninstall` | Renderer -> Main | Remove a widget |
| `widget:cache-path` | Renderer -> Main | Get the widget cache directory |
| `widget:storage-path` | Renderer -> Main | Get the widget storage directory |
| `widget:installed` | Main -> Renderer | Notify that a widget was installed |
| `widgets:loaded` | Main -> Renderer | Notify that a batch of widgets was loaded |

## Important Notes

- **Path references:** Widget pipeline files are in the `electron/` directory (not `public/lib/` as in older documentation that predates the dash-core extraction).
- **Scaffold commands:** Commands like `npm run widgetize` are template-level commands defined in the consuming app (e.g., dash-electron), not in dash-core.
- **Widget source directory:** The `src/Widgets/` directory for custom widgets lives in the consuming app, not in dash-core.
- **ComponentManager source:** `ComponentManager` is exported from `@trops/dash-core` (`src/ComponentManager.js`). The consuming app imports and uses it directly.
- **LayoutModel refresh:** When widgets are loaded into the layout builder, `LayoutModel` refreshes `eventHandlers` and `events` from `ComponentManager.config()` to keep configuration fields up-to-date in the edit modal.
