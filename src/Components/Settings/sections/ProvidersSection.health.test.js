/**
 * ProvidersSection — real health from open provider issues (issues PRD):
 * "Couldn't start" / "Sign-in expired" with the error line, and
 * Reconnect (stop, then start) / Sign in.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { AppContext } from "../../../Context/App/AppContext";

jest.mock("../../../ComponentManager", () => ({
  ComponentManager: {
    config: (name) =>
      name === "SlackWidget" ? { providers: [{ type: "slack" }] } : null,
  },
}));
jest.mock("../details/McpCatalogDetail", () => ({
  McpCatalogDetail: ({ initialSelectedId }) => (
    <div data-testid="mcp-catalog">{initialSelectedId}</div>
  ),
}));
jest.mock("../details/CustomMcpServerForm", () => ({
  CustomMcpServerForm: ({ initialName, onSave }) => (
    <div data-testid="mcp-edit">
      {initialName}
      <button
        onClick={() =>
          onSave(`${initialName} Work`, "slack", {}, { transport: "stdio" })
        }
      >
        Save renamed
      </button>
    </div>
  ),
}));
jest.mock("../details/WebSocketProviderForm", () => ({
  WebSocketProviderForm: () => <div data-testid="ws-form" />,
}));
jest.mock("../details/NewProviderPicker", () => ({
  NewProviderPicker: ({ onSelect }) => (
    <div data-testid="class-chooser">
      <button onClick={() => onSelect("connector")}>Claude connector</button>
    </div>
  ),
}));

import { ProvidersSection } from "./ProvidersSection";

import { __resetIssuesStore } from "../../../hooks/useIssues";
import { mockIssuesApi } from "../../../__mocks__/mockIssuesApi";

const providers = {
  "Notes MCP": {
    type: "notes",
    providerClass: "mcp",
    mcpConfig: { transport: "stdio", command: "notes-mcp" },
    credentials: {},
  },
  "Home Assistant MCP": {
    type: "home-assistant",
    providerClass: "mcp",
    mcpConfig: { transport: "stdio", command: "ha-mcp" },
    credentials: {},
  },
  GitHub: {
    type: "github",
    providerClass: "mcp",
    mcpConfig: { transport: "stdio", command: "gh-mcp" },
    credentials: {},
  },
  // Signs in with its own command.
  Drive: {
    type: "drive",
    providerClass: "mcp",
    mcpConfig: {
      transport: "stdio",
      command: "drive-mcp",
      authCommand: { command: "drive-mcp", args: ["auth"] },
    },
    credentials: {},
  },
};

const couldntStart = {
  id: "p1",
  status: "open",
  severity: "problem",
  cause: "start",
  title: "Notes MCP couldn't start",
  message:
    "Notes MCP couldn't start: connect ECONNREFUSED 127.0.0.1:3845. Check its settings on the Providers page.",
  hint: "Notes MCP's server isn't answering — it may not be running.",
  lastAt: new Date().toISOString(),
  count: 1,
  asset: { kind: "provider", name: "Notes MCP", provider: "Notes MCP" },
};
const signInExpired = {
  id: "p2",
  status: "open",
  severity: "problem",
  cause: "sign-in",
  title: "Home Assistant MCP: sign-in expired",
  message: "401 Unauthorized",
  lastAt: new Date().toISOString(),
  count: 1,
  asset: {
    kind: "provider",
    name: "Home Assistant MCP",
    provider: "Home Assistant MCP",
  },
};

const driveSignIn = {
  ...signInExpired,
  id: "p3",
  title: "Drive: sign-in expired",
  asset: { kind: "provider", name: "Drive", provider: "Drive" },
};
// An older issue (no cause) whose error mentions "expired": not a sign-in.
const oldExpired = {
  id: "p4",
  status: "open",
  severity: "problem",
  title: "GitHub couldn't start",
  message: "token expired (401)",
  lastAt: new Date().toISOString(),
  count: 1,
  asset: { kind: "provider", name: "GitHub", provider: "GitHub" },
};

function setup(issues = [couldntStart, signInExpired, driveSignIn]) {
  mockIssuesApi(issues, {
    bots: {
      list: jest.fn().mockResolvedValue([]),
      onListChanged: jest.fn(() => "l"),
      removeListener: jest.fn(),
    },
  });
  const dashApi = {
    mcpGetCatalog: jest.fn((ok) => ok(null, { catalog: [] })),
    mcpGetServerStatus: jest.fn((name, ok) =>
      ok(null, { status: "disconnected" }),
    ),
    mcpStopServer: jest.fn((name, ok) => ok()),
    mcpStartServer: jest.fn((name, cfg, creds, ok) => ok(null, { tools: [] })),
  };
  render(
    <AppContext.Provider
      value={{ providers, dashApi, refreshProviders: jest.fn() }}
    >
      <ProvidersSection
        dashApi={dashApi}
        credentials={{ appId: "app" }}
        workspaces={[]}
      />
    </AppContext.Provider>,
  );
  return { dashApi };
}

const list = () => screen.getByRole("list", { name: "Providers" });
const rowOf = (name) =>
  within(list())
    .getAllByRole("button")
    .find(
      (b) =>
        b.querySelector("[data-name]") &&
        b.querySelector("[data-name]").textContent === name,
    );

afterEach(() => {
  __resetIssuesStore();
  delete window.mainApi;
});

describe("ProvidersSection — health from issues", () => {
  it("says Couldn't start / Sign-in expired with the error line", async () => {
    setup();
    await waitFor(() =>
      expect(
        within(rowOf("Notes MCP")).getByText("Couldn't start"),
      ).toBeInTheDocument(),
    );
    expect(
      within(rowOf("Notes MCP")).getByTestId("provider-health-detail"),
    ).toHaveTextContent("connect ECONNREFUSED 127.0.0.1:3845");
    // Already on the Providers page: its "check the Providers page" tip goes.
    expect(
      within(rowOf("Notes MCP")).getByTestId("provider-health-detail"),
    ).not.toHaveTextContent("Providers page");
    expect(
      within(rowOf("Home Assistant MCP")).getByText("Sign-in expired"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("GitHub")).getByText("Starts when used"),
    ).toBeInTheDocument();
    // No sign-in command of its own (OAuth): Reconnect asks again.
    expect(
      screen.getByRole("button", { name: "Reconnect Home Assistant MCP" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in to Home Assistant MCP" }),
    ).toBeNull();
    // Its own sign-in command: Sign in.
    expect(
      screen.getByRole("button", { name: "Sign in to Drive" }),
    ).toBeInTheDocument();
  });

  it("an older issue without a cause is not read as a sign-in from its text", async () => {
    setup([oldExpired]);
    await waitFor(() =>
      expect(
        within(rowOf("GitHub")).getByText("Couldn't start"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Sign-in expired")).toBeNull();
  });

  it("an OAuth provider's expired sign-in: the detail offers Reconnect", async () => {
    setup();
    fireEvent.click(await waitFor(() => rowOf("Home Assistant MCP")));
    await screen.findByTestId("provider-health");
    const detail = screen.getByTestId("provider-detail");
    expect(
      within(detail).getByRole("button", { name: "Reconnect" }),
    ).toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "Sign in" }),
    ).toBeNull();
  });

  it("Reconnect stops the server, then starts it again", async () => {
    const { dashApi } = setup();
    const button = await screen.findByRole("button", {
      name: "Reconnect Notes MCP",
    });
    fireEvent.click(button);
    await waitFor(() => expect(dashApi.mcpStartServer).toHaveBeenCalled());
    expect(dashApi.mcpStopServer.mock.calls[0][0]).toBe("Notes MCP");
    expect(dashApi.mcpStartServer.mock.calls[0].slice(0, 3)).toEqual([
      "Notes MCP",
      providers["Notes MCP"].mcpConfig,
      {},
    ]);
    expect(window.mainApi.issues.resolveAsset).toHaveBeenCalledWith({
      kind: "provider",
      provider: "Notes MCP",
    });
  });

  it("the detail shows the error and Reconnect", async () => {
    setup();
    fireEvent.click(await waitFor(() => rowOf("Notes MCP")));
    const health = await screen.findByTestId("provider-health");
    expect(health).toBeInTheDocument();
    expect(
      within(screen.getByTestId("provider-detail")).getByRole("button", {
        name: "Reconnect",
      }),
    ).toBeInTheDocument();
  });
});
