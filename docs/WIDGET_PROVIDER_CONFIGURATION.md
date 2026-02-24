# Widget Provider Configuration

Guide for configuring provider requirements in widget `.dash.js` files.

## Overview

Providers supply external service credentials (API keys, tokens) or MCP server connections to widgets. Widget configuration files declare what providers a widget needs, and the framework handles prompting users to configure them.

## Basic Concepts

### What is a Provider?

A provider represents an external service connection:

- **Credential provider** (`providerClass: "credential"`) — Stores encrypted API keys/tokens
- **MCP provider** (`providerClass: "mcp"`) — Spawns an MCP server child process exposing tools

### Why Use Providers?

- Secure credential storage (encrypted via Electron safeStorage)
- User-configurable — each user sets up their own credentials
- Reusable — multiple widgets can share the same provider
- Automatic prompting — framework detects missing providers and prompts setup

## Configuration Structure

In your widget's `.dash.js` file:

```javascript
export default {
    component: MyWidget,
    type: "widget",
    // ...
    providers: [
        {
            type: "slack",               // Provider type identifier
            providerClass: "credential", // "credential" or "mcp"
            required: true,              // Whether widget requires this provider
            credentialSchema: {          // Define credential fields
                token: {
                    type: "password",
                    required: true,
                    displayName: "Bot Token",
                    instructions: "Create a Slack app and copy the Bot User OAuth Token",
                },
            },
        },
    ],
};
```

## Credential Schema

### Field Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | Input type: `"text"`, `"password"`, `"number"`, `"url"` |
| `required` | boolean | No | Whether field is required (default: false) |
| `displayName` | string | No | Label shown in the provider form |
| `instructions` | string | No | Help text below the field |
| `defaultValue` | any | No | Pre-filled value |
| `placeholder` | string | No | Placeholder text |

### Input Types

| Type | Rendered As | Use Case |
|---|---|---|
| `"text"` | Text input | API IDs, usernames, public keys |
| `"password"` | Masked input | API keys, tokens, secrets |
| `"number"` | Numeric input | Port numbers, limits |
| `"url"` | URL input | Endpoint URLs, webhook URLs |

## Examples

### Slack (Credential)

```javascript
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
                instructions: "Slack Bot User OAuth Token (xoxb-...)",
            },
        },
    },
],
```

### Algolia (Multiple Credentials)

```javascript
providers: [
    {
        type: "algolia",
        providerClass: "credential",
        required: true,
        credentialSchema: {
            appId: {
                type: "text",
                required: true,
                displayName: "Application ID",
            },
            apiKey: {
                type: "password",
                required: true,
                displayName: "Admin API Key",
            },
            indexName: {
                type: "text",
                required: false,
                displayName: "Default Index",
                defaultValue: "",
            },
        },
    },
],
```

### GitHub

```javascript
providers: [
    {
        type: "github",
        providerClass: "credential",
        required: true,
        credentialSchema: {
            token: {
                type: "password",
                required: true,
                displayName: "Personal Access Token",
                instructions: "Generate at GitHub → Settings → Developer settings → Personal access tokens",
            },
            owner: {
                type: "text",
                required: true,
                displayName: "Repository Owner",
            },
            repo: {
                type: "text",
                required: false,
                displayName: "Repository Name",
            },
        },
    },
],
```

### Multiple Providers

```javascript
providers: [
    {
        type: "slack",
        providerClass: "credential",
        required: true,
        credentialSchema: {
            token: { type: "password", required: true, displayName: "Token" },
        },
    },
    {
        type: "github",
        providerClass: "credential",
        required: false,
        credentialSchema: {
            token: { type: "password", required: true, displayName: "Token" },
        },
    },
],
```

### Custom API

```javascript
providers: [
    {
        type: "custom-api",
        providerClass: "credential",
        required: true,
        credentialSchema: {
            baseUrl: {
                type: "url",
                required: true,
                displayName: "API Base URL",
                placeholder: "https://api.example.com",
            },
            apiKey: {
                type: "password",
                required: true,
                displayName: "API Key",
            },
        },
    },
],
```

### MCP Provider (Slack via MCP)

```javascript
providers: [
    {
        type: "slack",
        providerClass: "mcp",       // MCP provider, not credential
        required: true,
        // Optional: restrict which MCP tools the widget can call
        // allowedTools: ["send_message", "list_channels"],
    },
],
```

MCP providers connect to MCP servers defined in `electron/mcp/mcpServerCatalog.json`. The server spawns as a child process and exposes tools via the MCP protocol.

## Using Providers in Widgets

### Credential Providers

```javascript
import { useWidgetProviders } from "@trops/dash-core";

export const MyWidget = (props) => {
    const { providers, loading } = useWidgetProviders();

    if (loading) return <div>Loading providers...</div>;

    const slackToken = providers?.slack?.credentials?.token;
    if (!slackToken) return <div>Please configure Slack provider</div>;

    // Use slackToken to call Slack API
    return <div>Connected to Slack</div>;
};
```

### MCP Providers

```javascript
import { useMcpProvider } from "@trops/dash-core";

export const MyMcpWidget = (props) => {
    const { tools, callTool, loading, error } = useMcpProvider("slack");

    const handleSend = async () => {
        const result = await callTool("send_message", {
            channel: "#general",
            text: "Hello from Dash!",
        });
        console.log("Result:", result);
    };

    if (loading) return <div>Connecting to MCP server...</div>;
    if (error) return <div>Error: {error.message}</div>;

    return (
        <div>
            <p>Available tools: {tools.map((t) => t.name).join(", ")}</p>
            <button onClick={handleSend}>Send Message</button>
        </div>
    );
};
```

## UI Behavior

When a widget requires a provider:

1. **Provider exists** — Widget renders normally with credentials available
2. **Provider missing** — ProviderErrorBoundary catches the requirement and shows MissingProviderPrompt
3. **User creates provider** — ProviderForm collects credentials based on `credentialSchema`
4. **Provider saved** — Encrypted to disk, widget re-renders with credentials

## Best Practices

### Naming

- Use lowercase, descriptive `type` names: `"slack"`, `"github"`, `"algolia"`
- Type names should match the service name for user clarity
- Use the same `type` across widgets that share a service

### Security

- Always use `type: "password"` for secrets, tokens, and API keys
- Never log or display credential values in the UI
- Credentials are encrypted at rest via Electron safeStorage

### Documentation

- Provide `instructions` for each credential field
- Include links or steps for obtaining credentials
- Use `placeholder` to show expected format

## Related Documentation

- [Provider Architecture](PROVIDER_ARCHITECTURE.md) — Three-tier storage model, encryption, context integration
- [Widget Development](WIDGET_DEVELOPMENT.md) — Complete widget development guide
- [Testing](TESTING.md) — Provider testing workflows
