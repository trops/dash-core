# Widget Management API

Complete API reference for the widget management system in `@trops/dash-core`.

> For a condensed version, see [Widget API Quick Reference](WIDGET_API_QUICK_REF.md).

## Overview

The Widget Management API provides methods for the renderer process to list, install, uninstall, and manage widgets at runtime. Methods are available via `window.dashApi.widgets` in the Electron renderer.

---

## Methods

### `widgets.list()`

List all installed widgets.

```javascript
const widgets = await window.dashApi.widgets.list();
// Returns: [{ name, version, source, path, ... }, ...]
```

**Returns:** `Promise<Object[]>` — Array of widget objects.

---

### `widgets.get(name)`

Get a single widget by package name.

```javascript
const widget = await window.dashApi.widgets.get("weather-widget");
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `name` | `string` | Widget package name |

**Returns:** `Promise<Object>` — Widget object, or `null` if not found.

---

### `widgets.install(url)`

Install a widget from a remote URL (ZIP archive).

```javascript
const widget = await window.dashApi.widgets.install(
    "https://github.com/org/repo/releases/download/v1.0.0/my-widget.zip"
);
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `url` | `string` | URL to widget ZIP archive |

**Returns:** `Promise<Object>` — Installed widget object.

**Flow:**

1. Downloads ZIP from URL
2. Extracts to widget storage directory
3. Compiles widget sources with esbuild (`widgetCompiler`)
4. Registers in widget registry (`widgetRegistry`)
5. Fires `widget:installed` event
6. Returns widget metadata

**Errors:**

- Invalid URL or unreachable server
- ZIP extraction failure
- Compilation error (invalid widget structure)
- Missing `.dash.js` configuration

---

### `widgets.installLocal(path)`

Install a widget from a local filesystem path.

```javascript
const widget = await window.dashApi.widgets.installLocal("/path/to/my-widget");
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `path` | `string` | Absolute path to widget directory |

**Returns:** `Promise<Object>` — Installed widget object.

---

### `widgets.loadFolder(path)`

Load all widgets from a directory. Useful for batch loading from a custom widgets folder.

```javascript
const widgets = await window.dashApi.widgets.loadFolder("/path/to/widgets");
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `path` | `string` | Absolute path to folder containing widget directories |

**Returns:** `Promise<Object[]>` — Array of loaded widget objects.

---

### `widgets.uninstall(name)`

Uninstall a widget by package name.

```javascript
await window.dashApi.widgets.uninstall("weather-widget");
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `name` | `string` | Widget package name |

**Returns:** `Promise<void>`

**Flow:**

1. Removes widget from registry
2. Deletes widget files from storage
3. Removes ComponentManager entries matching `_sourcePackage`
4. Fires uninstall event

---

### `widgets.getCachePath()`

Get the path to the widget cache directory.

```javascript
const cachePath = await window.dashApi.widgets.getCachePath();
// e.g., "~/Library/Application Support/{appId}/widget-cache"
```

**Returns:** `Promise<string>`

---

### `widgets.getStoragePath()`

Get the current widget storage directory path.

```javascript
const storagePath = await window.dashApi.widgets.getStoragePath();
// e.g., "~/Library/Application Support/{appId}/widgets"
```

**Returns:** `Promise<string>`

---

### `widgets.setStoragePath(path)`

Set a custom widget storage directory.

```javascript
await window.dashApi.widgets.setStoragePath("/custom/path/widgets");
```

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `path` | `string` | New storage directory path |

**Returns:** `Promise<void>`

---

## Events

### `widgets.onInstalled(callback)`

Listen for widget installation events.

```javascript
widgets.onInstalled((widget) => {
    console.log("Widget installed:", widget.name, widget.version);
});
```

**Callback receives:** Widget object with `name`, `version`, `source`, `path`.

---

### `widgets.onLoaded(callback)`

Listen for widgets loaded at app startup.

```javascript
widgets.onLoaded((widgets) => {
    console.log("Loaded", widgets.length, "widgets at startup");
});
```

**Callback receives:** Array of widget objects.

---

## Widget Object Structure

```javascript
{
    name: "my-widget",           // Package name (from package.json)
    displayName: "MyWidget",     // Component name (from .dash.js)
    version: "1.0.0",           // Package version
    source: "registry",          // "registry" | "local" | "builtin"
    path: "/path/to/widget",    // Filesystem path
    icon: "compass",            // FontAwesome icon name (from .dash.js)
    providers: [...],           // Provider requirements (from .dash.js)
    workspace: "my-workspace",  // Workspace name (from .dash.js)
    events: [...],              // Published events (from .dash.js)
    eventHandlers: [...]        // Handled events (from .dash.js)
}
```

**Notes:**

- `displayName`, `icon`, `providers`, `workspace`, `events`, `eventHandlers` are enriched from the `.dash.js` config during `loadWidgetComponents` in `widgetRegistry.js`.
- `source` is `"builtin"` for widgets bundled with the app, `"registry"` for externally installed widgets.

---

## Usage Examples

### Widget Manager Panel

```javascript
import { useState, useEffect } from "react";

function WidgetManager() {
    const [widgets, setWidgets] = useState([]);

    useEffect(() => {
        // Load initial list
        window.dashApi.widgets.list().then(setWidgets);

        // Update on new installs
        window.dashApi.widgets.onInstalled((widget) => {
            setWidgets((prev) => [...prev, widget]);
        });
    }, []);

    const handleInstall = async (url) => {
        try {
            await window.dashApi.widgets.install(url);
        } catch (err) {
            console.error("Install failed:", err.message);
        }
    };

    const handleUninstall = async (name) => {
        await window.dashApi.widgets.uninstall(name);
        setWidgets((prev) => prev.filter((w) => w.name !== name));
    };

    return (
        <div>
            {widgets.map((w) => (
                <div key={w.name}>
                    {w.displayName} v{w.version}
                    <button onClick={() => handleUninstall(w.name)}>
                        Uninstall
                    </button>
                </div>
            ))}
        </div>
    );
}
```

### Batch Loading from Folder

```javascript
const widgets = await window.dashApi.widgets.loadFolder(
    "/Users/dev/my-widgets"
);
console.log(`Loaded ${widgets.length} widgets from folder`);
```

---

## Error Handling

All methods return promises and should be wrapped in try/catch:

```javascript
try {
    const widget = await window.dashApi.widgets.install(url);
} catch (error) {
    // Common errors:
    // - "Failed to download widget" — URL unreachable
    // - "Invalid widget package" — missing .dash.js or component
    // - "Widget already installed" — duplicate name
    // - "Compilation failed" — esbuild error
    console.error("Widget install error:", error.message);
}
```

---

## Storage Paths

| Path | Purpose |
|---|---|
| `~/Library/Application Support/{appId}/widgets/` | Installed widget files |
| `~/Library/Application Support/{appId}/widget-cache/` | Download cache |
| `~/Library/Application Support/{appId}/registry.json` | Widget registry metadata |

---

## Implementation Files

| File | Layer | Purpose |
|---|---|---|
| `electron/widgetRegistry.js` | Main | Install, uninstall, list, registry persistence |
| `electron/widgetCompiler.js` | Main | esbuild compilation pipeline |
| `electron/dynamicWidgetLoader.js` | Main | Runtime widget loading |
| `electron/api/widgetApi.js` | Main | IPC handler registration |
| `src/utils/widgetBundleLoader.js` | Renderer | CJS bundle evaluation |
| `src/hooks/useInstalledWidgets.js` | Renderer | React hook merging builtin + installed widgets |
