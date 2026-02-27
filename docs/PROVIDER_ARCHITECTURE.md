# Provider Architecture

## Overview

The provider system manages external service credentials and API integrations for widgets. It supports two provider classes:

-   `"credential"` (default) -- Traditional API key/token providers stored encrypted
-   `"mcp"` -- MCP (Model Context Protocol) server providers that spawn stdio child processes

Credential providers store API keys, tokens, and secrets that widgets use to authenticate with external services. MCP providers spawn long-running child processes that expose tool-based APIs via the Model Context Protocol's stdio transport.

## Three-Tier Storage Model

### Tier 1: Workspace Configuration

`workspaces.json` stores provider **names only** (not credentials). It maps widgets to their selected providers so that the dashboard knows which provider each widget instance should use.

Structure:

```json
{
    "selectedProviders": {
        "widgetId": ["provider-name"]
    }
}
```

This tier is non-sensitive and can be safely backed up or shared. It contains no credential data.

### Tier 2: Encrypted Credentials

`providers.json` stores encrypted credential data. Encryption uses Electron's `safeStorage.encryptString()`, which delegates to the OS keychain (Keychain on macOS, libsecret on Linux, DPAPI on Windows).

File location: `~/Library/Application Support/{appId}/providers.json`

Structure per provider:

```json
{
    "name": "my-slack-provider",
    "type": "slack",
    "credentials": {
        "encrypted": "<base64-encrypted-string>"
    },
    "mcpConfig": {
        "server": "slack"
    }
}
```

The `credentials.encrypted` field is an opaque blob that can only be decrypted by the same OS user on the same machine. The `mcpConfig` field is present only for MCP-class providers and references a server definition in the MCP server catalog.

### Tier 3: Runtime Context

`AppContext.providers` holds in-memory decrypted provider objects for the duration of the application session.

**CRITICAL**: Providers live in `AppContext.providers`, NOT `DashboardContext.providers`. `DashboardContext.providers` is structurally empty due to component tree ordering -- `DashboardWrapper` renders before providers are loaded by `AppWrapper`. This is by design; `AppWrapper` is the single source of truth for provider state.

`AppWrapper` loads providers on startup via `dashApi.listProviders()`, which triggers decryption in the main process and returns the full provider list to the renderer.

## Provider CRUD Flow

All provider operations follow the same IPC pattern: renderer calls a `dashApi` method, which sends an IPC message to the main process, where `providerController` performs the operation and returns the result.

### Create

```
UI --> dashApi.createProvider(data) --> IPC --> providerController.createProvider()
    --> encrypt credentials via safeStorage --> write to providers.json
    --> return created provider (without decrypted credentials)
```

### List

```
UI --> dashApi.listProviders() --> IPC --> providerController.listProviders()
    --> read providers.json --> decrypt each credential --> return array
```

### Get

```
UI --> dashApi.getProvider(name) --> IPC --> providerController.getProvider()
    --> single provider lookup --> decrypt --> return provider
```

### Delete

```
UI --> dashApi.deleteProvider(name) --> IPC --> providerController.deleteProvider()
    --> remove from providers.json --> return confirmation
```

All write operations (create, delete) persist changes to `providers.json` atomically. The renderer's `AppContext.providers` is updated after each successful operation.

## Electron Layer (Main Process)

Key files in `electron/` (exported via `@trops/dash-core/electron`):

| File                                | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `controller/providerController.js`  | Provider CRUD operations, encryption/decryption via safeStorage      |
| `api/providerApi.js`                | IPC handler registration for provider channels                       |
| `events/providerEvents.js`          | Event channel name definitions (constants)                           |
| `controller/mcpController.js`       | MCP server lifecycle management (spawn, connect, call, stop)         |
| `api/mcpApi.js`                     | IPC handler registration for MCP channels                            |
| `mcp/mcpServerCatalog.json`         | MCP server definitions (transport, command, args, env variable maps) |

### providerController.js

The provider controller is the central authority for credential management. It:

-   Reads and writes `providers.json` in the app data directory
-   Encrypts credentials before writing using `safeStorage.encryptString()`
-   Decrypts credentials when reading using `safeStorage.decryptString()`
-   Validates provider data before persistence

### mcpController.js

The MCP controller manages the full lifecycle of MCP server child processes:

-   Spawns stdio child processes based on catalog definitions
-   Maintains a map of active server instances keyed by provider name
-   Injects credentials into server environment variables via template substitution
-   Enforces tool scoping (validates `allowedTools` before forwarding calls)
-   Cleans up child processes on stop or application exit

## Renderer Layer

Key files in `src/`:

| File                                  | Purpose                                               |
| ------------------------------------- | ----------------------------------------------------- |
| `Context/ProviderContext.js`          | Provider React context definition                     |
| `hooks/useWidgetProviders.js`         | Recommended hook for widget provider access            |
| `hooks/useMcpProvider.js`             | MCP server connection, tool listing, and tool calling  |
| `Components/Provider/McpServerPicker.js` | UI component for selecting MCP servers during provider creation |

## Context Integration

The provider data flows through the React context tree as follows:

1. **AppWrapper** loads providers on startup via `dashApi.listProviders()`
2. Providers are stored in `AppContext.providers` as a keyed object (`{ [providerName]: providerData }`)
3. `DashboardWrapper` passes providers to `DashboardContext` (but this is empty at runtime -- see Tier 3 note above)
4. Widgets access providers via one of three methods:

### Widget Provider Access

**Method 1: `useWidgetProviders()` hook (Recommended)**

```javascript
import { useWidgetProviders } from "@trops/dash-core";

const MyWidget = (props) => {
    const { providers, loading } = useWidgetProviders();
    // providers contains only the providers assigned to this widget
};
```

This hook auto-detects the widget ID from context and resolves only the providers that are configured for the current widget instance.

**Method 2: `useDashboard()` with widget ID**

```javascript
import { useDashboard } from "@trops/dash-core";

const MyWidget = ({ widgetId }) => {
    const { providers } = useDashboard(widgetId);
};
```

Requires manually passing the widget ID. Useful when you need other dashboard context values alongside providers.

**Method 3: Direct `AppContext` access**

```javascript
import { useContext } from "react";
import { AppContext } from "@trops/dash-core";

const MyWidget = () => {
    const { providers } = useContext(AppContext);
    // providers contains ALL providers, not filtered to this widget
};
```

Returns all providers across the application. You must filter to the relevant provider yourself.

## Provider Detection (Error Boundary Pattern)

The component hierarchy for provider detection is:

```
Widget --> ProviderErrorBoundary --> WidgetErrorBoundary
```

The detection flow works as follows:

1. A widget declares provider requirements in its `.dash.js` configuration
2. When the widget renders, `ProviderErrorBoundary` checks whether the required providers are configured
3. If a required provider is missing, rendering is intercepted and `MissingProviderPrompt` is shown instead of the widget
4. `MissingProviderPrompt` guides the user to configure the missing provider via `ProviderSelector` and `ProviderForm`
5. Once configured, the widget renders normally

Each widget instance in a dashboard has independent provider detection. Two instances of the same widget type can use different providers.

## MCP Provider System

### MCP Lifecycle

The full lifecycle of an MCP provider connection:

1. **Widget mounts** -- `useMcpProvider("slack")` hook runs
2. **Provider lookup** -- Hook reads provider from `AppContext.providers` (the provider includes `mcpConfig` and encrypted credentials)
3. **Server start** -- Hook calls `dashApi.mcpStartServer()` which sends an IPC message to `mcpController`
4. **Process spawn** -- `mcpController` looks up the server definition in `mcpServerCatalog.json`, substitutes credential templates into environment variables, and spawns a stdio child process
5. **Tool discovery** -- The server responds with its available tools; the hook filters by `allowedTools` if specified in the widget's `.dash.js` config
6. **Tool calling** -- Widget calls `callTool("send_message", args)` which routes through IPC to `mcpController`; each call has a 30-second timeout
7. **Cleanup** -- On widget unmount, the hook calls `mcpStopServer()` to terminate the child process

### Tool Scoping

Tool scoping is enforced at **both** levels to prevent widgets from calling tools they should not have access to:

-   **Hook level (renderer)**: Client-side filter via `allowedTools` array in the `.dash.js` config. The hook only exposes tools that match the allowed list.
-   **Main process level (Electron)**: `mcpController` validates `allowedTools` before forwarding any `callTool` request. Calls to disallowed tools are rejected.

### MCP Server Catalog

`electron/mcp/mcpServerCatalog.json` defines the available MCP servers. Each entry specifies how to spawn and configure the server process:

```json
{
    "slack": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-slack-server"],
        "env": {
            "SLACK_BOT_TOKEN": "{{credentials.token}}"
        }
    }
}
```

-   `transport` -- Currently only `"stdio"` is supported
-   `command` -- The executable to run
-   `args` -- Command-line arguments passed to the executable
-   `env` -- Environment variables injected into the child process; `{{credentials.xxx}}` templates are replaced with decrypted credential values at spawn time

## Widget Provider Configuration

Widget `.dash.js` files declare provider requirements in the `providers` array:

```javascript
// MyWidget.dash.js
export default {
    component: MyWidget,
    type: "widget",
    providers: [
        {
            type: "slack",
            providerClass: "credential", // or "mcp"
            required: true,
            credentialSchema: {
                token: {
                    type: "password",
                    required: true,
                    displayName: "API Token",
                },
            },
        },
    ],
};
```

### Provider Declaration Fields

| Field              | Type     | Description                                                         |
| ------------------ | -------- | ------------------------------------------------------------------- |
| `type`             | string   | Provider type identifier (e.g., `"slack"`, `"github"`)              |
| `providerClass`    | string   | `"credential"` (default) or `"mcp"`                                 |
| `required`         | boolean  | Whether the widget cannot render without this provider              |
| `credentialSchema` | object   | Schema for credential fields (credential class only)                |
| `allowedTools`     | string[] | Restrict which MCP tools the widget can call (MCP class only)       |

### MCP Widget Example

```javascript
// McpWidget.dash.js
export default {
    component: McpWidget,
    type: "widget",
    providers: [
        {
            type: "slack",
            providerClass: "mcp",
            required: true,
            // Optional: restrict tool access
            // allowedTools: ["send_message", "list_channels"],
        },
    ],
};
```

## Client Cache Integration

The provider system integrates with the client cache (`electron/utils/clientCache.js`) for SDK client lifecycle management. When a provider is saved or deleted, `providerController` automatically invalidates any cached client for that provider so the next API call creates a fresh client with current credentials.

For full details on client caching, factory registration, and cache management APIs, see [Client Cache](CLIENT_CACHE.md).

## Important Notes

-   **Path references**: All paths in this document use `electron/` (the dash-core directory structure), not the legacy `public/lib/` paths from the original dash repo.
-   **`createMainApi` factory**: The `electron/api/mainApi.js` factory includes provider and MCP APIs by default. Template applications (like dash-electron) can extend it with additional APIs via `createMainApi(extensions)`.
-   **Electron dependency**: Provider storage uses Electron's `safeStorage` API for encryption. This means the provider system is not available in web-only deployments. Any future web deployment would need an alternative credential storage backend.
-   **Provider class default**: If `providerClass` is omitted in a widget's provider declaration, it defaults to `"credential"`.
-   **MCP process cleanup**: MCP server child processes are cleaned up both on widget unmount and on application exit. The `mcpController` maintains a registry of active processes to ensure none are orphaned.
