# Client Cache

## Overview

`clientCache` (`electron/utils/clientCache.js`) caches SDK clients by provider in the Electron main process. It resolves credentials from the encrypted store via `providerController.getProvider()`, creates clients using registered factories, and caches them by provider hash so subsequent calls reuse the same instance.

**When to use it:** Any external SDK that needs provider credentials (Algolia, OpenAI, Stripe, etc.).

**When NOT to use it:** MCP servers (different lifecycle managed by `mcpController`), file-based operations, Electron built-ins.

## Architecture

```
Renderer                              Main Process
--------                              ------------
widget calls IPC handler    -->       handler calls clientCache.getClient(hash, appId, providerName)
  with (providerHash,                    |
   dashboardAppId,                       v
   providerName)                      clientCache checks cache (clients Map)
                                         |
                                      cache miss? --> providerController.getProvider()
                                         |                  |
                                         |                  v
                                         |              decrypt credentials
                                         |                  |
                                         v                  v
                                      factory lookup     factory(credentials) --> SDK client
                                      by provider.type      |
                                         |                  v
                                         |              cache client by hash
                                         v
                                      return client --> handler uses client
```

### Key Data Structures

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `clients` | providerHash | SDK client | Main cache |
| `factories` | providerType (e.g., `"algolia"`) | `(credentials) => client` | Factory functions |
| `pendingClients` | providerHash | Promise | Deduplicates in-flight creation |
| `providerLookup` | `"appId:providerName"` | providerHash | Reverse lookup for invalidation |

### Response Cache Integration

`responseCache` (`electron/utils/responseCache.js`) sits on top of client-level caching and caches individual API responses with TTL. When a client is invalidated (credentials changed), the response cache is also cleared since all cached responses from that client are stale.

## Built-in Factories

The following factories are auto-registered when `@trops/dash-core/electron` is imported (via `clientFactories.js`):

| Provider Type | SDK | Credential Fields |
|---------------|-----|-------------------|
| `algolia` | `algoliasearch` | `appId`, `apiKey` (or `key`) |
| `openai` | `openai` | `apiKey` |

SDKs are lazy-required — only loaded when the first client of that type is created.

## Registering Custom Factories

To add support for a new API service:

### 1. Save a provider with matching `providerType`

The provider's `type` field must match the factory name you register. For example, a Stripe provider should have `type: "stripe"`.

### 2. Register the factory in your `electron.js`

```javascript
const { clientCache } = require("@trops/dash-core/electron");

clientCache.registerFactory("stripe", (credentials) => {
    const Stripe = require("stripe");
    return new Stripe(credentials.secretKey);
});
```

### 3. Use `clientCache.getClient()` in IPC handlers

```javascript
ipcMain.handle("stripe-list-charges", async (e, { providerHash, dashboardAppId, providerName }) => {
    const client = await clientCache.getClient(providerHash, dashboardAppId, providerName);
    return client.charges.list({ limit: 10 });
});
```

The renderer sends `providerHash`, `dashboardAppId`, and `providerName` — never raw credentials. The main process resolves and decrypts credentials internally.

## Cache Management

### Setup

Call `setupCacheHandlers()` in your `electron.js` alongside `setupWidgetRegistryHandlers()`:

```javascript
const { setupCacheHandlers, widgetRegistry } = require("@trops/dash-core/electron");
const { setupWidgetRegistryHandlers } = widgetRegistry;

// Inside ipcHandlersRegistered guard:
setupWidgetRegistryHandlers();
setupCacheHandlers();
```

This registers four IPC handlers:

| Channel | Purpose |
|---------|---------|
| `client-cache-invalidate` | Invalidate a specific cached client + clear response cache |
| `client-cache-invalidate-all` | Invalidate all cached clients + clear response cache |
| `response-cache-clear` | Clear the response cache only |
| `response-cache-stats` | Get response cache statistics |

### Renderer-Side API

Available via `mainApi.clientCache`:

```javascript
// Invalidate a specific provider's cached client
await mainApi.clientCache.invalidate(appId, providerName);

// Invalidate all cached clients
await mainApi.clientCache.invalidateAll();

// Clear response cache only
await mainApi.clientCache.clearResponseCache();

// Get cache stats
const stats = await mainApi.clientCache.responseCacheStats();
```

### Automatic Invalidation

`providerController` automatically invalidates cached clients when providers are saved or deleted. This ensures the next `getClient()` call creates a fresh client with current credentials.

### Manual Invalidation

Use manual invalidation when:
- A widget detects auth errors and wants to force credential re-resolution
- You need to clear all caches during development/debugging
- Application cleanup on `window-all-closed`

## API Reference

### `clientCache` Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerFactory` | `(providerType: string, factoryFn: (credentials) => client)` | Register a factory function for a provider type |
| `getClient` | `async (providerHash, appId, providerName) => client` | Get or create a cached client |
| `invalidate` | `(appId, providerName)` | Remove a specific client from cache |
| `invalidateAll` | `()` | Remove all clients from cache |
| `clear` | `()` | Clear all caches (clients, lookups, pending) |
| `setupCacheHandlers` | `()` | Register IPC handlers for cache management |

### `clientCacheApi` Methods (Renderer-Side)

| Method | Signature | Description |
|--------|-----------|-------------|
| `invalidate` | `(appId, providerName) => Promise` | IPC call to invalidate a specific client |
| `invalidateAll` | `() => Promise` | IPC call to invalidate all clients |
| `clearResponseCache` | `() => Promise` | IPC call to clear response cache |
| `responseCacheStats` | `() => Promise` | IPC call to get cache statistics |
