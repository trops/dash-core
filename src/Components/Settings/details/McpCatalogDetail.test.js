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
