# Widget API Quick Reference

Quick reference for frontend developers using `@trops/dash-core` to build widget management UI.

> For full documentation, see [Widget API](WIDGET_API.md).

## Available Methods

Access via `window.dashApi.widgets` (renderer process):

```javascript
const widgets = window.dashApi.widgets;
```

| Method | Description | Returns |
|---|---|---|
| `widgets.list()` | List all installed widgets | `Promise<Object[]>` |
| `widgets.get(name)` | Get widget by name | `Promise<Object>` |
| `widgets.install(url)` | Install widget from URL | `Promise<Object>` |
| `widgets.installLocal(path)` | Install from local path | `Promise<Object>` |
| `widgets.loadFolder(path)` | Load widgets from folder | `Promise<Object[]>` |
| `widgets.uninstall(name)` | Uninstall widget | `Promise<void>` |
| `widgets.getCachePath()` | Get cache directory path | `Promise<string>` |
| `widgets.getStoragePath()` | Get storage directory | `Promise<string>` |
| `widgets.setStoragePath(path)` | Set storage directory | `Promise<void>` |

## Event Listening

```javascript
// Listen for widget installation
widgets.onInstalled((widget) => {
    console.log("Installed:", widget.name);
});

// Listen for widgets loaded at startup
widgets.onLoaded((widgets) => {
    console.log("Loaded:", widgets.length, "widgets");
});
```

## Widget Object Structure

```javascript
{
    name: "my-widget",           // Package name
    displayName: "MyWidget",     // Component name from .dash.js
    version: "1.0.0",
    source: "registry",          // "registry" | "local" | "builtin"
    path: "/path/to/widget",
    icon: "compass",             // FontAwesome icon name
    providers: [...],            // Provider requirements
    workspace: "my-workspace",
    events: [...],
    eventHandlers: [...]
}
```

## Common Patterns

### React Hook

```javascript
import { useState, useEffect } from "react";

function useWidgets() {
    const [widgets, setWidgets] = useState([]);

    useEffect(() => {
        window.dashApi.widgets.list().then(setWidgets);
        window.dashApi.widgets.onInstalled((w) => {
            setWidgets((prev) => [...prev, w]);
        });
    }, []);

    return widgets;
}
```

### Install Dialog

```javascript
const handleInstall = async (url) => {
    try {
        const widget = await window.dashApi.widgets.install(url);
        console.log("Installed:", widget.name);
    } catch (err) {
        console.error("Install failed:", err.message);
    }
};
```

### URL Formats

```
# Direct ZIP URL
https://github.com/org/repo/releases/download/v1.0.0/my-widget.zip

# Template URL (version interpolated)
https://github.com/org/repo/releases/download/v{version}/{name}.zip
```

## Testing in Console

Open Electron DevTools and run:

```javascript
// List installed widgets
await window.dashApi.widgets.list();

// Install a widget
await window.dashApi.widgets.install("https://example.com/widget.zip");

// Uninstall
await window.dashApi.widgets.uninstall("my-widget");
```
