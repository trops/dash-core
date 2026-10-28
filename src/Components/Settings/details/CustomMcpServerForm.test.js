/**
 * CustomMcpServerForm — editing a built-in provider (Web Fetch,
 * bot-capabilities CAP-002) shows only its settings, and saving keeps its
 * `in_process` config exactly as saved.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppContext } from "../../../Context/App/AppContext";
import { CustomMcpServerForm, buildMcpConfig } from "./CustomMcpServerForm";

const webFetchConfig = { transport: "in_process", builtin: "web-fetch" };
const schema = {
  maxDownloadMb: {
    type: "number",
    displayName: "Max download size",
    default: 10,
    min: 1,
    max: 50,
    unit: "MB",
  },
  allowedSites: { type: "text-list", displayName: "Allowed sites" },
  shrinkLargeImages: {
    type: "toggle",
    displayName: "Shrink large images",
    default: true,
  },
};

afterEach(() => {
  delete window.mainApi;
});

describe("buildMcpConfig for a built-in provider", () => {
  it("returns the saved config unchanged", () => {
    expect(
      buildMcpConfig(
        "in_process",
        { command: "", args: "", envMappingRows: [], url: "", headerRows: [] },
        webFetchConfig,
      ),
    ).toEqual(webFetchConfig);
  });
});

describe("CustomMcpServerForm editing a built-in provider", () => {
  const renderForm = () =>
    render(
      <AppContext.Provider value={{ dashApi: {}, credentials: { appId: "a" } }}>
        <CustomMcpServerForm
          isEditMode
          initialName="Web Fetch — product images"
          initialProviderType="web-fetch"
          initialCredentialSchema={schema}
          initialTransport="in_process"
          initialCredentials={{
            maxDownloadMb: "25",
            allowedSites: "cdn.test",
            shrinkLargeImages: false,
          }}
          initialMcpConfig={webFetchConfig}
          onSave={jest.fn()}
          onBack={jest.fn()}
        />
      </AppContext.Provider>,
    );

  it("shows the settings with saved values, not transport/command/JSON", () => {
    renderForm();
    expect(screen.getByText("Built into Dash")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
    expect(screen.getByDisplayValue("cdn.test")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.queryByText("Command")).toBeNull();
    expect(screen.queryByText("Server URL")).toBeNull();
    expect(screen.queryByText("Credentials")).toBeNull();
  });
});

describe("CustomMcpServerForm with a warning (bot-capabilities CAP-005)", () => {
  it("shows the unverified warning above the form", () => {
    render(
      <AppContext.Provider value={{ dashApi: {}, credentials: { appId: "a" } }}>
        <CustomMcpServerForm
          initialName="Photos MCP"
          initialTransport="stdio"
          initialCommand="npx"
          initialArgs="-y photos-mcp"
          warning="Unverified: this runs third-party code on your computer"
          onSave={jest.fn()}
          onBack={jest.fn()}
        />
      </AppContext.Provider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Unverified/);
    expect(screen.getByDisplayValue("Photos MCP")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-y photos-mcp")).toBeInTheDocument();
  });
});

// Salesforce review (2026-10-24): saving a catalog OAuth provider in this
// form dropped its callback port, so sign-in used a random one.
describe("buildMcpConfig keeps the OAuth settings the form doesn't show", () => {
  const salesforce = {
    transport: "streamable_http",
    url: "{{serverUrl}}",
    auth: "oauth",
    oauth: {
      clientId: "{{clientId}}",
      scopes: "mcp_api refresh_token",
      callbackPort: "{{callbackPort}}",
      defaults: { callbackPort: 38000 },
    },
  };

  it("the callback port and its default survive a save", () => {
    const out = buildMcpConfig(
      "streamable_http",
      {
        command: "",
        args: "",
        envMappingRows: [],
        url: "{{serverUrl}}",
        headerRows: [],
        authType: "oauth",
        oauthScopes: "mcp_api refresh_token",
        oauthClientId: "{{clientId}}",
      },
      salesforce,
    );
    expect(out.oauth).toEqual(salesforce.oauth);
  });

  it("a field cleared in the form is cleared", () => {
    const out = buildMcpConfig(
      "streamable_http",
      {
        command: "",
        args: "",
        envMappingRows: [],
        url: "https://x.test/mcp",
        headerRows: [],
        authType: "oauth",
        oauthScopes: "",
        oauthClientId: "",
      },
      salesforce,
    );
    expect(out.oauth).toEqual({
      callbackPort: "{{callbackPort}}",
      defaults: { callbackPort: 38000 },
    });
  });
});

// QA 2026-10-24: every edit of an OAuth provider made you Authorize again,
// even when it was signed in and nothing about the sign-in changed.
describe("CustomMcpServerForm editing a signed-in OAuth provider", () => {
  const catalog = require("../../../../electron/mcp/mcpServerCatalog.json");
  const sf = catalog.servers.find((x) => x.id === "salesforce");
  const urlPlaceholder = sf.credentialSchema.serverUrl.placeholder;

  function renderEdit({ signedIn = true, dashApi = {} } = {}) {
    render(
      <AppContext.Provider value={{ dashApi, credentials: { appId: "a" } }}>
        <CustomMcpServerForm
          isEditMode
          initialName="SF Work"
          initialProviderType="salesforce"
          initialCredentialSchema={sf.credentialSchema}
          initialTransport="streamable_http"
          initialUrl={sf.mcpConfig.url}
          initialCredentials={{
            serverUrl: "https://a.example/mcp",
            clientId: "key-a",
          }}
          initialMcpConfig={sf.mcpConfig}
          initialSignedIn={signedIn}
          onSave={jest.fn()}
          onBack={jest.fn()}
        />
      </AppContext.Provider>,
    );
  }
  const next = () => {
    const buttons = screen.getAllByRole("button", { name: "Next" });
    return buttons[buttons.length - 1];
  };

  it("Authorize is optional while the sign-in settings are unchanged", () => {
    renderEdit();
    fireEvent.click(next());
    expect(
      screen.getByText(
        "Signed in. Authorize again only to use a different account.",
      ),
    ).toBeInTheDocument();
    expect(next()).not.toBeDisabled();
    fireEvent.click(next());
    expect(
      screen.getByRole("button", { name: "Save Changes" }),
    ).toBeInTheDocument();
  });

  it("Fetch Tools then uses the provider's own sign-in", () => {
    const dashApi = { mcpStartServer: jest.fn() };
    renderEdit({ dashApi });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Fetch Tools" }));
    expect(dashApi.mcpStartServer.mock.calls[0][0]).toBe("SF Work");
  });

  it("Fetch Tools leaves a server that's already running (a widget or bot's) running", () => {
    const dashApi = {
      mcpGetServerStatus: jest.fn((name, ok) =>
        ok(null, { status: "connected", tools: [{ name: "ping" }] }),
      ),
      mcpStartServer: jest.fn(),
      mcpStopServer: jest.fn(),
    };
    renderEdit({ dashApi });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Fetch Tools" }));
    expect(dashApi.mcpGetServerStatus.mock.calls[0][0]).toBe("SF Work");
    expect(
      screen.getByText("Connected and in use. Found 1 tools."),
    ).toBeInTheDocument();
    expect(dashApi.mcpStartServer).not.toHaveBeenCalled();
    expect(dashApi.mcpStopServer).not.toHaveBeenCalled();
  });

  it("Fetch Tools stops a server only it started", () => {
    const dashApi = {
      mcpGetServerStatus: jest.fn((name, ok) =>
        ok(null, { status: "disconnected" }),
      ),
      mcpStartServer: jest.fn((name, cfg, creds, ok) =>
        ok(null, { tools: [{ name: "ping" }] }),
      ),
      mcpStopServer: jest.fn(),
    };
    renderEdit({ dashApi });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Fetch Tools" }));
    expect(dashApi.mcpStartServer.mock.calls[0][0]).toBe("SF Work");
    expect(dashApi.mcpStopServer.mock.calls[0][0]).toBe("SF Work");
  });

  it("a server macOS blocked on the local network: says so, with the way to fix it", () => {
    const dashApi = {
      mcpGetServerStatus: jest.fn((name, ok) =>
        ok(null, { status: "disconnected" }),
      ),
      mcpStartServer: jest.fn((name, cfg, creds, ok) =>
        ok(null, {
          error: true,
          message:
            "This Mac blocked Dash from reaching 10.0.0.107:9583 on your local network. Allow Dash in System Settings › Privacy & Security › Local Network, then try again.",
          fix: "local-network",
        }),
      ),
      mcpStopServer: jest.fn(),
    };
    window.mainApi = { app: { openLocalNetworkSettings: jest.fn() } };
    renderEdit({ dashApi });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Fetch Tools" }));
    expect(
      screen.getByText(
        /This Mac blocked Dash from reaching 10\.0\.0\.107:9583/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Local Network settings" }),
    );
    expect(window.mainApi.app.openLocalNetworkSettings).toHaveBeenCalled();
  });

  it("any other failure: no Local Network button", () => {
    const dashApi = {
      mcpGetServerStatus: jest.fn((name, ok) =>
        ok(null, { status: "disconnected" }),
      ),
      mcpStartServer: jest.fn((name, cfg, creds, ok) =>
        ok(null, { error: true, message: "Nothing is answering at a:1" }),
      ),
      mcpStopServer: jest.fn(),
    };
    renderEdit({ dashApi });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Fetch Tools" }));
    expect(screen.getByText("Nothing is answering at a:1")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-local-network-fix")).toBeNull();
  });

  it("after a failed Authorize, the old sign-in no longer counts", () => {
    const dashApi = {
      mcpAuthorize: jest.fn((name, cfg, creds, ok) =>
        ok(null, { error: true, message: "denied" }),
      ),
    };
    renderEdit({ dashApi });
    fireEvent.click(next());
    expect(next()).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    expect(next()).toBeDisabled();
  });

  it("not signed in: Authorize is required", () => {
    renderEdit({ signedIn: false });
    fireEvent.click(next());
    expect(next()).toBeDisabled();
  });

  it("a changed server URL needs a new sign-in", () => {
    renderEdit();
    fireEvent.change(screen.getByPlaceholderText(urlPlaceholder), {
      target: { value: "https://b.example/mcp" },
    });
    fireEvent.click(next());
    expect(
      screen.queryByText(
        "Signed in. Authorize again only to use a different account.",
      ),
    ).toBeNull();
    expect(next()).toBeDisabled();
  });
});
