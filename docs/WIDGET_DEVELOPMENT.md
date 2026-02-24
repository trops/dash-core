# Widget Development Guide

Step-by-step guide for creating, implementing, and testing widgets with `@trops/dash-core`.

> Widgets are developed in the consuming app (e.g., dash-electron), not in dash-core directly.

## Quick Start

```bash
# 1. Generate widget scaffold (in your app, e.g., dash-electron)
node ./scripts/widgetize MyWidget

# 2. Implement your widget in src/Widgets/MyWidget/

# 3. Run the app
npm run dev

# 4. Widget auto-registers and appears in the dashboard
```

## Creating a New Widget

### Using the Scaffold Generator

The consuming app provides a scaffold command:

```bash
node ./scripts/widgetize MyWidget
```

This creates:

```
src/Widgets/MyWidget/
├── widgets/
│   ├── MyWidget.js           # Widget component
│   └── MyWidget.dash.js      # Widget configuration
├── workspaces/
│   ├── MyWidgetWorkspace.js  # Workspace component
│   └── MyWidgetWorkspace.dash.js
└── index.js                  # Exports
```

## Implementing Widgets

### Widget Component

```javascript
// MyWidget.js
import React, { useState, useEffect, useContext } from "react";
import { Widget, Panel, Heading, SubHeading } from "@trops/dash-react";
import { ThemeContext } from "@trops/dash-react";

export const MyWidget = ({
    // User config props (from .dash.js userConfig)
    title = "My Widget",
    subtitle = "",
    // Injected props
    api,
    ...props
}) => {
    const { currentTheme } = useContext(ThemeContext);
    const [data, setData] = useState(null);

    // Load saved data on mount
    useEffect(() => {
        api.readData({
            callbackComplete: (savedData) => setData(savedData),
            callbackError: (err) => console.error("Load failed:", err),
        });
    }, []);

    const handleSave = () => {
        api.storeData({ timestamp: Date.now(), title });
    };

    return (
        <Widget {...props}>
            <Panel>
                <Heading text={title} />
                {subtitle && <SubHeading text={subtitle} />}
                <button onClick={handleSave}>Save</button>
            </Panel>
        </Widget>
    );
};
```

### Widget Configuration (.dash.js)

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
            instructions: "The title shown at the top of the widget",
            required: true,
        },
        subtitle: {
            type: "text",
            defaultValue: "",
            displayName: "Subtitle",
            required: false,
        },
    },
};
```

### userConfig Field Types

| Type | Description | Extra Properties |
|---|---|---|
| `"text"` | Text input | — |
| `"number"` | Numeric input | `min`, `max` |
| `"boolean"` | Toggle switch | — |
| `"select"` | Dropdown select | `options: [{ label, value }]` |
| `"color"` | Color picker | — |
| `"password"` | Masked input | — |

### Field Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | Field type (see above) |
| `defaultValue` | any | No | Default value |
| `displayName` | string | No | Label shown in UI |
| `instructions` | string | No | Help text |
| `required` | boolean | No | Whether field is required |

## Creating Workspaces

Workspaces are containers that host related widgets and provide shared context.

### Workspace Component

```javascript
// MyWidgetWorkspace.js
import React from "react";
import { Workspace } from "@trops/dash-react";
import { MyWidgetContext } from "../MyWidgetContext";

export const MyWidgetWorkspace = ({ children, ...props }) => {
    const sharedState = { /* shared data or API clients */ };

    return (
        <MyWidgetContext.Provider value={sharedState}>
            <Workspace {...props}>{children}</Workspace>
        </MyWidgetContext.Provider>
    );
};
```

### Workspace Configuration

```javascript
// MyWidgetWorkspace.dash.js
import { MyWidgetWorkspace } from "./MyWidgetWorkspace";

export default {
    component: MyWidgetWorkspace,
    canHaveChildren: true,
    workspace: "my-widget-workspace",
    type: "workspace",
};
```

## Context / Dependency Injection

Share state and functionality between widgets via React Context:

```javascript
// MyWidgetContext.js
import React from "react";
export const MyWidgetContext = React.createContext();

// In workspace — provide context
import { useMyApi } from "./hooks/useMyApi";

export const MyWidgetWorkspace = ({ children }) => {
    const myApi = useMyApi();
    return (
        <MyWidgetContext.Provider value={{ myApi }}>
            {children}
        </MyWidgetContext.Provider>
    );
};

// In widget — consume context
import { useContext } from "react";
import { MyWidgetContext } from "../MyWidgetContext";

export const MyWidget = (props) => {
    const { myApi } = useContext(MyWidgetContext);
    return <div>{/* Use myApi */}</div>;
};
```

## Widget API

Every widget receives an `api` prop with these methods:

### Data Persistence

```javascript
// Save data (auto-persisted to Electron storage)
api.storeData({ key: "value", items: [1, 2, 3] });

// Load data
api.readData({
    callbackComplete: (data) => console.log("Loaded:", data),
    callbackError: (err) => console.error("Error:", err),
});
```

### Event Publishing

```javascript
// Publish an event (other widgets can listen)
api.publishEvent("search-completed", { query: "test", results: 42 });
```

### Event Listening

```javascript
// Register listeners for events from other widgets
api.registerListeners(["search-completed", "item-selected"], {
    "search-completed": (payload) => {
        console.log("Search:", payload.query);
    },
    "item-selected": (payload) => {
        console.log("Selected:", payload.id);
    },
});
```

## Provider Integration

Widgets can require external service providers. See [Widget Provider Configuration](WIDGET_PROVIDER_CONFIGURATION.md) for details.

```javascript
// MyWidget.dash.js — declare provider requirement
export default {
    component: MyWidget,
    // ...
    providers: [
        {
            type: "slack",
            providerClass: "credential",
            required: true,
            credentialSchema: {
                token: {
                    type: "password",
                    required: true,
                    displayName: "Bot Token",
                },
            },
        },
    ],
};

// MyWidget.js — access provider
import { useWidgetProviders } from "@trops/dash-core";

export const MyWidget = (props) => {
    const { providers } = useWidgetProviders();
    const slackToken = providers?.slack?.credentials?.token;
    // Use token to call Slack API
};
```

## Running & Testing

### Development Mode

```bash
npm run dev
```

1. React dev server starts with hot module reloading
2. Electron app launches
3. Widget changes auto-reload without restart

### Debugging

**Browser DevTools:** Electron → View → Toggle Developer Tools

```javascript
// Console: Check widget registration
ComponentManager.config("MyWidget");

// Console: Check providers
window.dashApi.listProviders();
```

**React Developer Tools:** Install the React DevTools extension to inspect component hierarchy, props, and context.

**Console Logging:** Add `console.log` in widget code — visible in Electron DevTools Console.

### Testing Checklist

- [ ] Widget renders correctly in dashboard
- [ ] User config fields appear in edit modal
- [ ] Default values applied correctly
- [ ] Data persistence works (save → reload → data present)
- [ ] Events publish and listeners receive
- [ ] Provider credentials accessible (if applicable)
- [ ] Error boundary catches widget errors gracefully

## Hot Module Reloading

During development (`npm run dev`), changes to widget files automatically reload:

- File change detected → Webpack recompiles → React hot-reloads component
- No manual restart needed
- State may reset on reload (use `api.storeData` for persistence)

## Troubleshooting

### Widget not appearing in dashboard

- Verify `.dash.js` config has correct `workspace` name matching the workspace config
- Check ComponentManager registration: `ComponentManager.config("MyWidget")`
- Ensure `index.js` exports the widget

### Widget shows blank

- Check DevTools Console for errors
- Verify all imports resolve (no `Module not found` errors)
- Ensure `Widget` wrapper component is used

### Data not persisting

- Use `api.storeData()` / `api.readData()` (not localStorage)
- Check DevTools Console for IPC errors
- Verify Electron main process is running

### Provider not available

- Ensure `.dash.js` has correct `providers` configuration
- Check that the provider is created in Settings → Providers
- Use `useWidgetProviders()` hook, not direct context access
- Verify using `AppContext.providers` (not `DashboardContext.providers`)

## Component Import Rules

```javascript
// UI components — always from @trops/dash-react
import { Panel, Button, Heading, Widget } from "@trops/dash-react";
import { ThemeContext } from "@trops/dash-react";
import { FontAwesomeIcon } from "@trops/dash-react";

// Core hooks and utilities — from @trops/dash-core
import { useWidgetProviders, useMcpProvider, useDashboard } from "@trops/dash-core";
```

**Never** import `FontAwesomeIcon` directly from `@fortawesome/*` — always use the `@trops/dash-react` re-export.
