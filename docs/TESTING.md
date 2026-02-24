# Testing Guide

## Overview

Testing guide for the @trops/dash-core provider and widget systems. These tests run in a consuming app (e.g., dash-electron) that uses dash-core.

## Prerequisites

- Consuming app running in dev mode (`npm run dev`)
- Electron app window open with DevTools accessible
- Provider API initialized (check console for provider loading messages)

## Provider Testing

### Quick Test (5 Steps)

1. Create a provider via the UI (e.g., "test-algolia" with dummy credentials)
2. Verify it saved: check `~/Library/Application Support/{appId}/providers.json`
3. Create a test widget that requires the provider type
4. Select the provider in the widget configuration
5. Verify the widget can access provider credentials via `useWidgetProviders()`

### Manual Testing Workflow

#### Part 1: Create Provider

1. Open Settings > Providers
2. Click "Add Provider"
3. Enter provider name (e.g., "test-slack")
4. Select provider type
5. Enter credentials (can use dummy values for testing)
6. Save

#### Part 2: Verify Storage

1. Check file system: `~/Library/Application Support/{appId}/providers.json`
2. Verify credentials are encrypted (not plaintext)
3. Verify provider appears in the provider list

#### Part 3: Widget Provider Access

1. Add a widget that requires the provider type
2. Configure widget to use the provider
3. Open DevTools Console
4. Verify provider data is accessible:

```javascript
// In widget component or DevTools
// Providers should be available via AppContext
```

#### Part 4: Multiple Providers

1. Create additional providers of the same type
2. Verify widgets can select between providers
3. Test switching providers on existing widgets
4. Verify no data leakage between providers

### Expected Data Structures

**Provider in memory (AppContext):**

```javascript
{
    "test-slack": {
        name: "test-slack",
        type: "slack",
        credentials: {
            token: "xoxb-decrypted-token"
        }
    }
}
```

**Provider on disk (encrypted):**

```javascript
{
    "test-slack": {
        name: "test-slack",
        type: "slack",
        credentials: "encrypted-base64-string"
    }
}
```

## MCP Provider Testing

### Quick MCP Test

1. Configure an MCP provider (e.g., Slack MCP server)
2. Add credentials required by the MCP server
3. Add a widget with `providerClass: "mcp"` requirement
4. Verify server starts (check main process console for spawn logs)
5. Verify tools are listed in the widget
6. Call a tool and verify response

### MCP Lifecycle Verification

1. Mount widget -> verify `mcpStartServer` IPC call
2. Check tool list -> verify `allowedTools` filtering
3. Call tool -> verify 30-second timeout works
4. Unmount widget -> verify `mcpStopServer` cleanup

## Widget System Testing

### Widget Installation

1. Install a widget from URL: `window.dashApi.widgets.install("url")`
2. Verify it appears in widget list: `window.dashApi.widgets.list()`
3. Verify widget renders in dashboard
4. Uninstall: `window.dashApi.widgets.uninstall("name")`
5. Verify widget removed from list and dashboard

### Hot Reload

1. Install widget at runtime (no restart)
2. Verify `widget:installed` event fires
3. Verify ComponentManager has the new widget registered
4. Verify widget is available in Layout Builder

## Verification Checklists

### Provider System

- [ ] Provider creates successfully via UI
- [ ] Credentials encrypted on disk
- [ ] Provider appears in list after creation
- [ ] Provider persists across app restart
- [ ] Widget can access provider credentials
- [ ] Provider deletion removes from disk and memory
- [ ] Multiple providers of same type work independently
- [ ] MCP server spawns correctly
- [ ] MCP tools listed and callable

### Widget System

- [ ] Widget installs from URL
- [ ] Widget installs from local path
- [ ] Widget appears in widget list
- [ ] Widget renders correctly in dashboard
- [ ] Widget config (userConfig) works
- [ ] Widget data persistence (storeData/readData)
- [ ] Widget events (publishEvent/registerListeners)
- [ ] Widget uninstall removes completely
- [ ] Hot reload works without restart

## Troubleshooting

### Provider not appearing

- Check console for IPC errors
- Verify `providers.json` exists and is valid JSON
- Check that AppWrapper loaded providers (look for "providers loaded" log)
- Confirm using `AppContext.providers` not `DashboardContext.providers`

### MCP server not starting

- Check main process console for spawn errors
- Verify MCP server command is installed (e.g., `npx -y @anthropic/mcp-slack-server`)
- Check credentials are mapped correctly in mcpServerCatalog.json
- Verify no port conflicts

### Widget not loading after install

- Check main process console for compilation errors
- Verify widget has valid `.dash.js` config with `component` function
- Check `widgetBundleLoader.js` MODULE_MAP includes required dependencies
- Clear widget cache and reinstall

## Key Files Reference

| File | Layer | Purpose |
|---|---|---|
| `electron/controller/providerController.js` | Main | Provider CRUD + encryption |
| `electron/controller/mcpController.js` | Main | MCP server lifecycle |
| `electron/widgetRegistry.js` | Main | Widget install/uninstall |
| `electron/widgetCompiler.js` | Main | esbuild compilation |
| `src/hooks/useWidgetProviders.js` | Renderer | Widget provider access |
| `src/hooks/useMcpProvider.js` | Renderer | MCP connection + tools |
| `src/utils/widgetBundleLoader.js` | Renderer | CJS bundle evaluation |
