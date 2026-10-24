/**
 * CustomMcpServerForm — editing a built-in provider (Web Fetch,
 * bot-capabilities CAP-002) shows only its settings, and saving keeps its
 * `in_process` config exactly as saved.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
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
