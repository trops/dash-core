/**
 * McpCatalogDetail — "add a provider of this type" links (Widget Builder,
 * Providers deep links) open the catalog on that server's configuration.
 * The pre-select used to set the server without entering configuration, so
 * the link landed on the full catalog grid.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { AppContext } from "../../../Context/App/AppContext";
import { McpCatalogDetail } from "./McpCatalogDetail";

const dashApi = {
  mcpGetCatalog: (ok) =>
    ok(null, {
      catalog: [
        {
          id: "gmail",
          name: "Gmail",
          description: "Read and send email",
          mcpConfig: { transport: "stdio", command: "npx", envMapping: {} },
        },
        {
          id: "slack",
          name: "Slack",
          mcpConfig: { transport: "stdio", command: "npx", envMapping: {} },
        },
        {
          id: "web-fetch",
          name: "Web Fetch",
          description: "Download images and web pages",
          mcpConfig: { transport: "in_process", builtin: "web-fetch" },
          credentialSchema: {
            maxDownloadMb: {
              type: "number",
              displayName: "Max download size",
              default: 10,
              min: 1,
              max: 50,
              unit: "MB",
            },
            shrinkLargeImages: {
              type: "toggle",
              displayName: "Shrink large images",
              default: true,
            },
          },
        },
      ],
    }),
  mcpGetKnownExternalCatalog: (ok) => ok(null, { servers: [] }),
};

const renderDetail = (props) =>
  render(
    <AppContext.Provider value={{ dashApi, credentials: { appId: "app" } }}>
      <McpCatalogDetail onSave={jest.fn()} onCancel={jest.fn()} {...props} />
    </AppContext.Provider>,
  );

describe("McpCatalogDetail pre-select (app-navigation NAV-007 AC2)", () => {
  it("opens the requested server's configuration", async () => {
    renderDetail({ initialSelectedId: "gmail" });
    expect(await screen.findByText("Configure Gmail")).toBeInTheDocument();
  });

  it("stays on the catalog when the type isn't in it", async () => {
    renderDetail({ initialSelectedId: "nope" });
    expect(await screen.findByText("Slack")).toBeInTheDocument();
    expect(screen.queryByText(/^Configure /)).toBeNull();
  });
});

describe("McpCatalogDetail built-in provider (bot-capabilities CAP-002)", () => {
  it("shows 'Built into Dash' and the settings, not a command", async () => {
    renderDetail({ initialSelectedId: "web-fetch" });
    expect(await screen.findByText("Configure Web Fetch")).toBeInTheDocument();
    expect(screen.getByText("Built into Dash")).toBeInTheDocument();
    expect(screen.queryByText("Command:")).toBeNull();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Max download size")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });
});

describe("McpCatalogDetail pre-filled custom server (bot-capabilities CAP-005)", () => {
  it("opens the custom form with the suggested server and its warning", async () => {
    renderDetail({
      initialCustom: {
        name: "Photos MCP",
        mcpConfig: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "photos-mcp"],
          envMapping: { PHOTOS_KEY: "PHOTOS_KEY" },
        },
        credentialSchema: {
          PHOTOS_KEY: { displayName: "PHOTOS_KEY", secret: true },
        },
        warning: "Unverified: this runs third-party code — npx -y photos-mcp",
      },
    });
    expect(
      await screen.findByText("Configure Custom MCP Server"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Unverified/);
    expect(screen.getByDisplayValue("Photos MCP")).toBeInTheDocument();
    expect(screen.getByDisplayValue("npx")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-y photos-mcp")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("PHOTOS_KEY").length).toBeGreaterThan(0);
  });
});
