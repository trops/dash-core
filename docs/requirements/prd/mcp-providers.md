# PRD: MCP Provider Integration

## Status & Metadata

| Field              | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| **Status**         | Phase 1-3: Complete, Phase 4: In Progress, Phase 5: Future, Phase 6 (OAuth): Implemented |
| **Version**        | 1.3.0                                                      |
| **Author**         | Product Team                                               |
| **Created**        | 2026-02-17                                                 |
| **Last Updated**   | 2026-06-24                                                 |
| **Target Release** | Phase 1-2: Q2 2026, Phase 3-4: Q3 2026                     |
| **Priority**       | P1 - High                                                  |
| **Component**      | MCP Provider System                                        |
| **Epic**           | External Service Integration via MCP                       |

---

## Executive Summary

MCP (Model Context Protocol) servers can serve as a new class of provider in Dash, enabling widget developers to use tools from external services (Slack, GitHub, Notion, Gmail, etc.) **without bundling their API libraries** into the Electron app. New integrations become possible without recompiling -- just install an MCP server and configure credentials.

**Key Goals:**

-   Extend the existing provider system with a new `providerClass: "mcp"` alongside credential providers
-   Ship a curated seed catalog of well-known MCP servers with pre-filled configs and credential schemas
-   Provide a `useMcpProvider` hook for widget developers with least-privilege tool scoping
-   Build Settings UI for browsing, configuring, and testing MCP servers

**Success Criteria:**

-   Widget developers can use MCP tools without bundling API libraries
-   Users can add and configure MCP servers from a curated catalog in < 60 seconds
-   MCP providers coexist with credential providers in the same `providers.json` storage
-   Tool scoping enforces least-privilege access per widget

---

## Context & Background

### Current Provider System

Dash has a provider system where widgets access external services via encrypted API credentials:

-   **Storage:** `providers.json`, encrypted with Electron `safeStorage`
-   **Controller:** `providerController.js` handles CRUD operations and encryption
-   **Widget access:** Widget developers declare required providers with a `credentialSchema`, and access them at runtime via the `useWidgetProviders()` hook
-   **UI:** Settings > Providers section for managing credential providers

### The MCP Opportunity

MCP servers expose standardized JSON-RPC interfaces for calling tools, listing resources, and reading data from external services. By treating MCP servers as a new class of provider:

1. **No library bundling** -- New integrations (Slack, GitHub, Notion) don't require recompiling the Electron app
2. **Standardized protocol** -- All MCP servers use the same `tools/call`, `tools/list`, `resources/list`, `resources/read` interface
3. **Growing ecosystem** -- Hundreds of MCP servers already exist for popular services
4. **Credential reuse** -- MCP servers accept auth tokens as environment variables, which map naturally to encrypted credential storage

### Seeding Strategy

Two approaches for populating available MCP servers:

1. **Static catalog (Phase 2)** -- Ship a curated JSON file of well-known MCP servers with pre-filled configs and credential schemas. Better UX, curated credential schemas, works offline.
2. **Registry discovery (Phase 5, future)** -- Query the official MCP Registry API (`registry.modelcontextprotocol.io/v0/servers`) to let users browse/search available servers. Broader coverage, but credential schemas must be auto-detected.

**Recommendation:** Start with the static catalog. It provides the credential schema that the MCP Registry API does not -- this is what makes the static approach a better first step.

### Target Users

1. **Widget Developer (Dev)** -- Builds widgets that consume external service data. Wants to call MCP tools (search, send_message, list_files) without managing API clients.
2. **Dashboard Admin (Admin)** -- Manages provider credentials and MCP server configurations. Wants a curated catalog with clear setup instructions.
3. **End User (User)** -- Adds widgets to dashboards. Expects MCP-backed widgets to work the same as credential-backed widgets, with clear permission prompts for which tools a widget will use.

---

## Architecture Overview

```
+-------------------------------------------------------------+
| Electron Main Process                                       |
|                                                             |
|  providerController.js --- providers.json (encrypted)       |
|       |                    { providerClass: "credential" }  |
|       |                    { providerClass: "mcp" }         |
|  mcpController.js ----+                                     |
|       |               |                                     |
|  +----v---------------v--------------------------+          |
|  | Active MCP Servers (Map)                      |          |
|  |  "GitHub MCP" -> StdioClientTransport         |          |
|  |  "Slack MCP"  -> StdioClientTransport         |          |
|  +-----------------------------------------------+          |
|       | IPC (mcp:call-tool, mcp:list-tools, etc.)           |
+-------------------------------------------------------------+
         |
+-------------------------------------------------------------+
| Renderer (React)                                            |
|                                                             |
|  AppWrapper -> loads all providers (credential + MCP)       |
|       |                                                     |
|  AppContext.providers = { ... }                              |
|       |  (NOTE: use AppContext, NOT DashboardContext —        |
|       |   see Implementation Notes below)                    |
|       |                                                     |
|  Widget                                                     |
|    useWidgetProviders() -> credentials (existing)           |
|    useMcpProvider("slack") -> { callTool, tools, ... } (new)|
+-------------------------------------------------------------+
```

---

## Data Model

MCP providers live in the **same `providers.json`** alongside credential providers, distinguished by `providerClass`:

```json
{
    "Algolia Production": {
        "type": "algolia",
        "providerClass": "credential",
        "credentials": "<encrypted>",
        "dateCreated": "...",
        "dateUpdated": "..."
    },
    "GitHub MCP": {
        "type": "github",
        "providerClass": "mcp",
        "credentials": "<encrypted>",
        "mcpConfig": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "envMapping": {
                "GITHUB_PERSONAL_ACCESS_TOKEN": "token"
            }
        },
        "dateCreated": "...",
        "dateUpdated": "..."
    }
}
```

**Field definitions:**

-   `providerClass`: `"credential"` (default/legacy) or `"mcp"`
-   `credentials`: Encrypted auth tokens the MCP server needs (e.g., API keys, access tokens)
-   `mcpConfig`: Unencrypted server connection config (transport, command, args)
-   `mcpConfig.envMapping`: Maps env var names to credential field names (MCP servers expect auth as env vars)

**Backward compatible** -- Existing providers without `providerClass` default to `"credential"`.

---

## Static Seed Catalog

**File:** `public/lib/mcp/mcpServerCatalog.json`

A curated list of well-known MCP servers with pre-filled configs:

| Service      | Package                                   | Transport | Auth Required         |
| ------------ | ----------------------------------------- | --------- | --------------------- |
| GitHub       | `@modelcontextprotocol/server-github`     | stdio     | Personal Access Token |
| Slack        | `slack-mcp-server` (korotovsky)           | stdio     | Bot / User OAuth / Browser session pair |
| Notion       | `@notionhq/notion-mcp-server`             | stdio     | API Key               |
| Google Drive | `@anthropic/gdrive-mcp-server`            | stdio     | OAuth credentials     |
| Brave Search | `@anthropic/brave-search-mcp-server`      | stdio     | API Key               |
| Filesystem   | `@modelcontextprotocol/server-filesystem` | stdio     | None (path config)    |
| Postgres     | `@anthropic/postgres-mcp-server`          | stdio     | Connection string     |
| Linear       | `linear-mcp-server`                       | stdio     | API Key               |

Each catalog entry includes: `name`, `description`, `icon`, `mcpConfig`, `credentialSchema`, `tags`.

The catalog provides the credential schema that the MCP Registry API does not -- this is what makes the static approach a better first step.

---

## MCP Server Lifecycle (Main Process)

**New file:** `public/lib/controller/mcpController.js`

Uses `@modelcontextprotocol/sdk` for protocol handling:

| Method                                      | Purpose                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `startServer(name, mcpConfig, credentials)` | Spawn stdio process or connect HTTP, run initialize handshake |
| `stopServer(name)`                          | Kill process or close connection                              |
| `callTool(name, toolName, args)`            | Send `tools/call` JSON-RPC request                            |
| `listTools(name)`                           | Return cached tool list from server                           |
| `listResources(name)`                       | Return available resources                                    |
| `readResource(name, uri)`                   | Fetch specific resource content                               |
| `getServerStatus(name)`                     | `"disconnected"` / `"connecting"` / `"connected"` / `"error"` |

**Transport handling:**

-   **stdio** -- Spawns child process with credentials mapped to env vars via `envMapping`
-   **http** -- Connects via Streamable HTTP with auth headers

---

## Widget Integration

### Tool Scoping (Least-Privilege)

Widget developers declare **which specific MCP tools** they need -- not blanket access to the entire server. This is enforced at runtime.

**Widget declaration:**

```javascript
requiredProviders: [
    {
        type: "algolia",
        providerClass: "mcp",
        required: true,
        allowedTools: ["search", "browse"], // Only these tools are accessible
        // Omitting allowedTools = access to all tools (opt-in restriction)
    },
];
```

**Enforcement layers:**

1. **Hook level** -- `useMcpProvider` filters the `tools` list to only return allowed tools, and `callTool` rejects calls to tools not in the whitelist
2. **Main process level** -- `mcpController.callTool()` checks widget's `allowedTools` before forwarding to the MCP server (defense in depth)
3. **UI transparency** -- When adding a widget, the user sees which tools it will use (like mobile app permissions: "This widget will use: search, browse")

**Example: Algolia search widget only needs `search`:**

```javascript
// Widget config
requiredProviders: [
    {
        type: "algolia",
        providerClass: "mcp",
        allowedTools: ["search"], // Cannot call admin/settings tools
    },
];

// Widget code
// callTool("search", ...) works
// callTool("delete_index", ...) is rejected
```

**Benefits:**

-   Users can see exactly what a widget will do with an MCP server before adding it
-   Prevents a search widget from accidentally (or maliciously) calling destructive tools
-   Catalog entries can include `recommendedTools` per use case to guide widget developers

### `useMcpProvider` Hook

**New hook:** `src/hooks/useMcpProvider.js`

```javascript
const { callTool, tools, isConnected } = useMcpProvider("slack");

// Only tools declared in allowedTools are available
// callTool rejects anything not in the widget's allowedTools list
// NOTE: Tool names are server-specific — use the tools list to discover names
const result = await callTool("conversations_add_message", {
    channel_id: "C08HVFXHBR3",
    payload: "Hello from Dash!",
});
```

**Returns:** `{ isConnected, isConnecting, error, tools, callTool, resources, readResource, connect, disconnect }`

-   `tools` -- Filtered to only the widget's `allowedTools` (if specified)
-   `callTool` -- Rejects calls to tools not in `allowedTools` with a clear error

Works alongside existing `useWidgetProviders()` -- a widget can use both credential and MCP providers.

---

## UI Flow

### Settings > Providers

-   Sidebar shows all providers with an icon distinguishing credential vs MCP
-   "Add Provider" offers two paths: "API Credentials" (existing) or "MCP Server" (new)

### MCP Server Picker (new component)

-   Searchable grid/list from the seed catalog
-   Select a server -> pre-filled credential form from catalog's `credentialSchema`
-   "Test Connection" button: starts server, lists tools, shows them, then stops
-   "Custom MCP Server" option for arbitrary servers not in catalog

### Widget-Level

-   `ProviderErrorBoundary` / `MissingProviderPrompt` updated to handle `providerClass: "mcp"`
-   `ProviderSelector` "Create New" tab shows `McpServerPicker` when MCP provider needed
-   **Tool permissions display** -- When adding a widget that uses MCP, show which tools it will access (e.g., "This widget uses: search, browse" from the Algolia MCP server). Similar to mobile app permission prompts -- the user grants informed consent.

---

## Phased Implementation

### Phase 1: Data Model + Storage -- COMPLETE

**Goal:** Extend `providerController.js` to accept `providerClass` and `mcpConfig` fields. Add MCP event constants. No UI changes -- just the storage layer.

**Files:**

-   Modify `public/lib/controller/providerController.js` -- Accept `providerClass` and `mcpConfig` fields
-   New `public/lib/events/mcpEvents.js` -- MCP IPC event constants
-   New `src/Api/events/mcpEvents.js` -- Mirror event constants for renderer

**Verification:** PASSED

-   Save/load an MCP provider via IPC
-   `providers.json` contains `providerClass: "mcp"` and `mcpConfig`
-   Existing credential providers continue to work unchanged

---

### Phase 2: MCP Server Lifecycle -- COMPLETE

**Goal:** New `mcpController.js` in main process. Install `@modelcontextprotocol/sdk`. Wire IPC handlers. Create seed catalog.

**Files:**

-   New `public/lib/controller/mcpController.js` -- MCP server lifecycle management
-   New `public/lib/api/mcpApi.js` -- Preload bridge for MCP IPC
-   New `public/lib/mcp/mcpServerCatalog.json` -- Static seed catalog (8 servers)
-   Modify `public/electron.js` -- Register MCP IPC handlers
-   Modify `public/lib/api/mainApi.js` -- Expose MCP API to renderer
-   Modify `package.json` -- Add `@modelcontextprotocol/sdk` dependency

**Verification:** PASSED

-   Started Slack MCP server from widget, listed tools, called tools, stopped cleanly
-   Stdio transport works end-to-end with credential-to-env-var mapping

---

### Phase 3: Widget Hook -- COMPLETE

**Goal:** New `useMcpProvider.js` hook. Small updates to `AppWrapper.js` to pass `providerClass` through.

**Files:**

-   New `src/hooks/useMcpProvider.js` -- React hook for widget MCP access
-   Modify `src/Context/App/AppWrapper.js` -- Pass `providerClass` through provider loading
-   Modify `src/Widget/Widget.js` -- Include `selectedProviders` in WidgetContext
-   Modify `src/Components/Layout/Builder/LayoutBuilder.js` -- Read providers from AppContext, route MCP creation to McpServerPicker
-   Modify `src/Components/Layout/Builder/LayoutGridContainer.js` -- Read providers from AppContext
-   New `src/Widgets/McpTest/` -- Reference widget for testing MCP connectivity

**Verification:** PASSED

-   McpTest widget connects to Slack MCP server
-   Tool list populates with 8 Slack tools
-   `conversations_add_message` sends messages successfully
-   `allowedTools` scoping filters tools at hook level and rejects unauthorized calls
-   30-second timeout prevents indefinite hangs

---

### Phase 4: Settings UI + Catalog Picker

**Goal:** New `McpServerPicker.js` and `McpProviderDetail.js` components. Extend existing provider UI.

**Files:**

-   New `src/Components/Provider/McpServerPicker.js` -- Catalog browser component
-   New `src/Components/Provider/McpProviderDetail.js` -- MCP provider detail/config view
-   Modify `src/Components/Settings/ProvidersSection.js` -- Add MCP provider path
-   Modify `src/Components/Provider/ProviderDetail.js` -- Handle MCP provider display
-   Modify `src/Components/Provider/ProviderSelector.js` -- Add MCP option to "Create New"

**Verification:**

-   Open Settings > Providers
-   Add an MCP server from catalog
-   Test connection, verify tools listed
-   Create a widget that uses the MCP provider

---

### Phase 5: Registry Discovery (Future)

**Goal:** Add `McpRegistryBrowser.js` that queries the official MCP Registry API. Auto-detect credential needs from registry metadata. Server health monitoring and auto-reconnect.

**Files:**

-   New `src/Components/Provider/McpRegistryBrowser.js` -- Registry search/browse UI
-   Modify `public/lib/controller/mcpController.js` -- Add health monitoring and auto-reconnect
-   Modify `McpServerPicker.js` -- Add "Browse Registry" tab alongside catalog

**Verification:**

-   Browse registry, install a server not in the catalog
-   Verify auto-detected credential schema works
-   Verify server health monitoring reconnects after transient failures

---

### Phase 6: Interactive OAuth 2.0 for Custom MCP Servers — IMPLEMENTED (2026-06-24)

**Goal:** Let a user add a custom remote (`streamable_http`) MCP server that
authenticates with standard OAuth 2.0 (e.g. Granola, Linear), click
"Authorize", complete a system-browser consent flow, and have the connection
work with automatic token refresh. Resolves the long-standing open question
("OAuth flow support for MCP servers"). Distinct from the bundled Google
servers, which use a catalog-only subprocess auth model (`runAuth` +
`authCommand`) not available to custom servers.

**Approach:** Wire the MCP SDK's native `OAuthClientProvider`
(`@modelcontextprotocol/sdk` ≥ 1.26) into the `streamable_http` transport.
The SDK handles PKCE, Dynamic Client Registration (DCR), metadata discovery,
and token refresh; Dash supplies the browser + loopback-redirect + encrypted
token storage.

**Config shape** (on the provider's `mcpConfig`):

```json
{
  "transport": "streamable_http",
  "url": "https://mcp.example.com",
  "auth": "oauth",
  "oauth": { "scopes": "read write", "clientId": "optional", "clientSecret": "optional" }
}
```

`clientId`/`clientSecret` are only needed for servers without DCR.

**Files:**

-   New `electron/mcp/mcpOAuthProvider.js` — `OAuthClientProvider`
    implementation: loopback HTTP server on `127.0.0.1:<ephemeral>/callback`,
    `shell.openExternal` browser launch, PKCE/DCR/token persistence.
-   Modify `electron/controller/mcpController.js` — `connectStreamableHttpWithOAuth`
    (connect → `UnauthorizedError` → `finishAuth` → reconnect with a fresh
    transport), OAuth branch in `startServer`, new `authorizeServer` method,
    `appId` threaded into `startServer`.
-   Modify `electron/controller/providerController.js` — `saveOAuthState` /
    `getOAuthState` (encrypted, in the same `providers.json`, never returned to
    the renderer); `saveProvider` preserves the `oauth` blob across edits.
-   Modify `electron/events/mcpEvents.js`, `electron/api/mcpApi.js` —
    `MCP_AUTHORIZE` channel + `authorize` bridge.
-   Modify `src/Api/ElectronDashboardApi.ts` (+ `IDashboardApi.ts`,
    `WebDashboardApi.ts`) — `mcpAuthorize`, `appId` on `mcpStartServer`.
-   Modify `src/Components/Settings/details/CustomMcpServerForm.js` — auth-type
    selector (None / API key / OAuth 2.0), scopes + advanced client fields,
    Authorize wizard step.
-   Modify `src/hooks/useMcpProvider.js` — pass `appId` so the widget start
    path reuses stored tokens.
-   dash-electron: `public/electron.js` `MCP_AUTHORIZE` handler + `appId`;
    `McpReauthBanner` generalized to re-authorize OAuth servers.

**Notes & decisions:**

-   The authorized reconnect uses a **fresh transport** — the first transport
    already called `start()` and cannot be restarted; `finishAuth` runs on the
    original transport to reuse its discovery state.
-   Tokens auto-refresh via the SDK (`saveTokens`); a hard refresh failure
    surfaces `UnauthorizedError`, caught by the generalized re-auth banner.
-   Loopback binds to `127.0.0.1` only; 120s authorization timeout.
-   **Verification:** 12 new unit tests (`mcpOAuthProvider.test.js`) + OAuth
    state round-trip tests in `providerController.test.js` +
    `connectStreamableHttpWithOAuth` dance tests in `mcpController.test.js`.

---

## Implementation Notes & Lessons Learned

Notes captured during Phase 1-3 implementation and end-to-end testing with the Slack MCP server.

### Provider Data Source: AppContext, NOT DashboardContext

**Critical architecture note:** Widgets and hooks must read provider data from `AppContext`, not `DashboardContext`.

`DashboardWrapper` creates `AppWrapper` as its **child**, but uses `useContext(AppContext)` — since it sits **above** `AppWrapper` in the tree, it only reads the default (empty) context value. This means `DashboardContext.providers` is **always `{}`**.

**Affected files and fixes applied:**

-   `LayoutGridContainer.js` — reads providers from `AppContext` directly
-   `LayoutBuilder.js` — reads providers from `AppContext` directly
-   `useMcpProvider.js` — reads provider data from `AppContext.providers` (not `dashboard.providers`)

### Widget selectedProviders Must Be Explicit in WidgetContext

`Widget.js` destructures `selectedProviders` out of `...props` as a named parameter. If it's not explicitly included in the `WidgetContext.Provider` value, it won't be available to hooks via `widgetContext.widgetData.selectedProviders`.

**Fix:** `Widget.js` now explicitly includes `selectedProviders` in `widgetData`:

```javascript
<WidgetContext.Provider value={{
    widgetData: { uuid, uuidString, selectedProviders, ...props }
}}>
```

### Provider Lookup Chain

`useMcpProvider` resolves the selected provider name via a two-level lookup:

1. **Widget-level** (preferred): `widgetData.selectedProviders[providerType]` — set by `handleSelectProvider` on the layout item
2. **Workspace-level** (fallback): `workspace.workspaceData.selectedProviders[widgetId][providerType]`

### Tool Names Are Server-Specific

MCP tool names are defined by each server implementation. They are **not standardized** across servers of the same type. For example, the `slack-mcp-server` (korotovsky) server uses:

| Tool Name                       | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `channels_list`                 | List channels                                          |
| `conversations_add_message`     | Post a message (channel_id, payload, optional thread_ts) |
| `conversations_history`         | Read channel messages                                  |
| `conversations_replies`         | Read thread replies                                    |
| `conversations_search_messages` | Search messages workspace-wide                         |
| `users_search`                  | Find users by name / email                             |
| `reactions_add` / `reactions_remove` | Manage emoji reactions                            |
| `conversations_unreads`         | List unread messages                                   |

**Best practice:** Always use the `tools` list returned by `useMcpProvider` to discover actual tool names and their `inputSchema`, rather than hardcoding names.

### Slack Auth Modes (3 options, pick one)

| Mode             | Env Var                                  | Notes                                                       |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Bot              | `SLACK_MCP_XOXB_TOKEN` (xoxb-)           | Same as old setup. Bot only sees channels it's invited to; no search. |
| User OAuth       | `SLACK_MCP_XOXP_TOKEN` (xoxp-)           | Sees everything the user can see, limited search.           |
| Browser session  | `SLACK_MCP_XOXC_TOKEN` + `SLACK_MCP_XOXD_TOKEN` | Full visibility + full search. No admin approval needed.    |

Posting (`conversations_add_message`) is gated by `SLACK_MCP_ADD_MESSAGE_TOOL=true` — the catalog sets this via `staticEnv` so widgets that depend on posting work out of the box.

### Slack Bot Channel Membership

Slack bots must be **invited to a channel** before they can post or read. Without membership, `conversations_add_message` returns `{"ok":false,"error":"not_in_channel"}`. This affects xoxb mode only; user-OAuth and browser-session modes see every channel the corresponding user/account sees.

**Fix:** In Slack, type `/invite @BotName` in the target channel, or use the channel's **Integrations** tab to add the app. Or switch to user-OAuth / browser-session mode.

### Tool Call Timeouts

MCP tool calls can hang indefinitely if the underlying API is unresponsive (e.g., missing OAuth scopes, rate limits, network issues). `useMcpProvider.callTool` includes a **30-second timeout** that rejects with a clear error message.

### MCP Server on First Use (Not App Launch)

MCP servers start **on first use** — when a widget calls `connect()` or auto-connects on mount. They are **not** started on app launch. This keeps startup fast and avoids spawning unused processes.

### Tool Scoping: Both Hook and Main Process

Tool scoping is enforced at **both** levels (defense in depth):

1. **Hook level** — `useMcpProvider` filters the `tools` array and rejects `callTool` requests for tools not in `allowedTools`
2. **Main process level** — `mcpController.callTool` checks `allowedTools` before forwarding to the MCP server

### Multi-Widget Server Deduplication & Reference Counting

When multiple widgets on the same dashboard use the same MCP provider (e.g., 4 widgets all calling `useMcpProvider("slack")`), each hook instance previously fired its own `mcpStartServer` IPC call. Because `startServer` stopped any existing server before starting fresh, this caused cascading stop→start→stop→start cycles — a restart loop that prevented stable connections.

**Root cause:** Per-hook-instance `connectingRef` guards prevented duplicate calls _within_ a single hook instance but not _across_ instances. Four hook instances = four independent IPC calls = four restarts.

**Fix: Deduplication at two levels:**

1. **Main process (`mcpController.js`)** — `pendingStarts` Map tracks in-flight start promises per server name. Three-way branch in `startServer`:

    - Already connected (`activeServers` has a `CONNECTED` entry) → return cached result immediately
    - Already starting (`pendingStarts` has an entry) → return the same promise (all callers share one result)
    - Fresh start → wrap in a tracked promise, clean up in `finally`

    `stopServer` awaits any in-flight `pendingStarts` entry before stopping, preventing a stop from racing a start. `stopAllServers` waits for all pending starts to settle before shutdown.

2. **Renderer (`useMcpProvider.js`)** — Module-level `serverStates` and `pendingConnects` Maps shared across all hook instances:
    - `serverStates` caches connection results + `consumerCount` per server
    - `pendingConnects` deduplicates in-flight IPC calls (only the first hook instance fires IPC; others `await` the same promise)

**Reference counting** prevents one widget's unmount from killing the server for other widgets:

-   On successful connect: `consumerCount++`
-   On disconnect/unmount: `consumerCount--`; only calls `mcpStopServer` when count reaches 0

**Dashboard switching behavior:** When switching dashboards, React unmounts all widgets (layout key changes). Each cleanup decrements `consumerCount`. When the last widget unmounts, `consumerCount` hits 0 → `mcpStopServer` fires → server stops. New dashboard's widgets mount → auto-connect fires → server starts fresh. No stray servers left running.

**Verification:**

-   Open a workspace with 4 widgets using the same MCP server
-   Electron logs show exactly ONE "Starting server: Slack" / "Server connected: Slack"
-   Disconnect/reconnect from one widget → one stop, one start
-   Close one widget while others remain → server stays running (`consumerCount > 0`)
-   Switch workspace tabs → one stop on leave, one start on return

### McpTest Reference Widget

The `McpTest` widget (`src/Widgets/McpTest/`) serves as a **reference implementation** and debugging tool for MCP connectivity. It provides:

-   Connection status with connect/disconnect controls
-   Full tools list (click any tool to open the tester)
-   Interactive tool tester with JSON args editor pre-populated from `inputSchema`
-   Result/error display
-   Quick Send shortcut for `slack_post_message`

This widget declares no `allowedTools`, giving it access to all tools on the server — intentional for testing purposes.

---

## Open Questions & Decisions

### Decisions Made

| Decision                                             | Rationale                                                                                                                                                                                   | Date       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Static catalog before registry discovery             | Better UX, curated credential schemas, works offline                                                                                                                                        | 2026-02-17 |
| Same `providers.json` for credential and MCP         | Backward compatible, unified storage, single encryption layer                                                                                                                               | 2026-02-17 |
| Least-privilege tool scoping via `allowedTools`      | Prevents widgets from accessing destructive MCP tools they don't need                                                                                                                       | 2026-02-17 |
| `providerClass` field with `"credential"` default    | Backward compatible with all existing providers                                                                                                                                             | 2026-02-17 |
| `envMapping` for credential-to-env-var mapping       | MCP servers expect auth as env vars; this bridges encrypted storage to env vars                                                                                                             | 2026-02-17 |
| MCP servers start on first use, not app launch       | Keeps startup fast, avoids spawning unused processes                                                                                                                                        | 2026-02-19 |
| Tool scoping enforced at both hook and main process  | Defense in depth — prevents bypass even if hook layer is circumvented                                                                                                                       | 2026-02-19 |
| Providers read from AppContext, not DashboardContext | DashboardContext.providers is structurally empty due to component tree ordering                                                                                                             | 2026-02-19 |
| 30-second timeout on tool calls                      | Prevents indefinite hangs from unresponsive APIs or missing scopes                                                                                                                          | 2026-02-19 |
| Two-level server dedup + reference counting          | Multiple widgets sharing an MCP server caused restart loops; dedup in main process (pendingStarts) and renderer (module-level Maps) with consumer refcounting to prevent premature shutdown | 2026-02-19 |

### Open Questions

| Question                                                 | Impact                                               | Decision Needed By |
| -------------------------------------------------------- | ---------------------------------------------------- | ------------------ |
| Should the catalog be updatable without app updates?     | Low - could fetch catalog from remote periodically   | Phase 4 planning   |

**Resolved:** _OAuth flow support for MCP servers_ — see Phase 6 below.
Resolved 2026-06-24: custom remote (streamable_http) servers now support
interactive OAuth 2.0 via the SDK's native `OAuthClientProvider`.

---

## Out of Scope

1. **MCP server development** -- This PRD covers consuming MCP servers, not creating new ones
2. **MCP prompts** -- The MCP protocol also supports `prompts/list` and `prompts/get`; this PRD focuses on tools and resources only
3. **MCP sampling** -- Server-initiated LLM sampling requests are not supported
4. **Custom transport development** -- Only stdio and HTTP transports are supported initially
5. **Multi-tenant MCP** -- Each MCP server instance serves one set of credentials; shared/multi-user MCP is out of scope

---

## Revision History

| Version | Date       | Author       | Changes                                                                                                                                                                                                                   |
| ------- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-02-17 | Product Team | Initial PRD creation (Phases 1-5)                                                                                                                                                                                         |
| 1.1.0   | 2026-02-19 | Product Team | Phase 1-3 complete; added Implementation Notes & Lessons Learned section; resolved open questions (server start strategy, tool scoping layers); corrected Slack package name; updated architecture diagram re: AppContext |
| 1.2.0   | 2026-02-19 | Product Team | Added multi-widget server deduplication & reference counting (mcpController pendingStarts + useMcpProvider module-level state); fixes restart loop when multiple widgets share an MCP server                              |
| 1.3.0   | 2026-06-24 | Product Team | Phase 6: interactive OAuth 2.0 for custom streamable_http MCP servers via the SDK-native OAuthClientProvider (browser + loopback + DCR + encrypted token storage + auto-refresh). Resolves the OAuth open question.       |

---

**End of PRD**
