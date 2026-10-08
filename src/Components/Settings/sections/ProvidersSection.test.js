/**
 * ProvidersSection — the Providers Manage page (app-navigation PRD
 * NAV-007): a page-style filter bar over a list grouped by class with each
 * provider's status, a detail with status and Used by, and deep links that
 * select a provider or start the create flow. The create / edit forms are
 * mocked — their behaviour is unchanged and tested on their own.
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
  CustomMcpServerForm: ({ initialName }) => (
    <div data-testid="mcp-edit">{initialName}</div>
  ),
}));
jest.mock("../details/WebSocketProviderForm", () => ({
  WebSocketProviderForm: () => <div data-testid="ws-form" />,
}));
jest.mock("../details/NewProviderPicker", () => ({
  NewProviderPicker: () => <div data-testid="class-chooser" />,
}));

import { ProvidersSection } from "./ProvidersSection";

const providers = {
  Slack: {
    type: "slack",
    providerClass: "mcp",
    isDefaultForType: true,
    mcpConfig: { transport: "stdio", envMapping: { T: "xoxbToken" } },
    credentials: { xoxbToken: "x" },
  },
  GitHub: {
    type: "github",
    providerClass: "mcp",
    mcpConfig: { transport: "stdio", envMapping: { T: "token" } },
    credentials: { token: "" },
  },
  Algolia: { type: "algolia", credentials: { apiKey: "k" } },
  Echo: {
    type: "websocket",
    providerClass: "websocket",
    wsConfig: { url: "wss://echo" },
  },
};
const workspaces = [
  {
    id: 1,
    name: "Kitchen Sink",
    layout: [{ id: 1, component: "SlackWidget", dashboardId: 1 }],
  },
];

function setup({ appProviders = providers, ...props } = {}) {
  window.mainApi = {
    bots: {
      list: jest.fn().mockResolvedValue([
        { id: "b1", name: "Digest", workspaceId: 1, mcpServers: ["Slack"] },
        { id: "b2", name: "Loose", mcpServers: ["Slack"] },
      ]),
      onListChanged: jest.fn(() => "l"),
      removeListener: jest.fn(),
    },
  };
  const dashApi = {
    mcpGetCatalog: jest.fn((ok) => ok(null, { catalog: [] })),
    mcpGetServerStatus: jest.fn((name, ok) =>
      ok(null, { status: name === "Slack" ? "connected" : "disconnected" }),
    ),
    deleteProvider: jest.fn((appId, name, ok) => ok()),
    saveWorkspace: jest.fn((appId, ws, ok) => ok(null, {})),
    mcpStopServer: jest.fn(),
  };
  const onOpenWorkspace = jest.fn();
  const onOpenBotInBotsView = jest.fn();
  const utils = render(
    <AppContext.Provider
      value={{ providers: appProviders, dashApi, refreshProviders: jest.fn() }}
    >
      <ProvidersSection
        dashApi={dashApi}
        credentials={{ appId: "app" }}
        workspaces={workspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotInBotsView={onOpenBotInBotsView}
        {...props}
      />
    </AppContext.Provider>,
  );
  return { ...utils, dashApi, onOpenWorkspace, onOpenBotInBotsView };
}

const list = () => screen.getByRole("list", { name: "Providers" });
const detail = () => screen.getByTestId("provider-detail");
const names = () =>
  within(list())
    .getAllByRole("button")
    .map((b) => b.querySelector("[data-name]").textContent);
const row = (name) =>
  within(list())
    .getAllByRole("button")
    .find((b) => b.querySelector("[data-name]").textContent === name);

afterEach(() => {
  delete window.mainApi;
});

describe("ProvidersSection list (NAV-007 AC1)", () => {
  it("groups providers by class with each one's status", async () => {
    setup();
    const headings = within(list())
      .getAllByTestId("provider-group")
      .map((h) => h.textContent);
    expect(headings).toEqual(["MCP servers", "API credentials", "WebSocket"]);
    expect(names()).toEqual(["GitHub", "Slack", "Algolia", "Echo"]);
    await waitFor(() =>
      expect(within(row("Slack")).getByText("Connected")).toBeInTheDocument(),
    );
    expect(within(row("GitHub")).getByText("Needs setup")).toBeInTheDocument();
    expect(within(row("Algolia")).getByText("Saved")).toBeInTheDocument();
  });

  it("filters by class, search and Needs setup", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "MCP" }));
    expect(names()).toEqual(["GitHub", "Slack"]);
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "algo" },
    });
    expect(names()).toEqual(["Algolia"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Needs setup only"));
    expect(names()).toEqual(["GitHub"]);
  });
});

describe("ProvidersSection detail (NAV-007)", () => {
  it("selects the first provider and shows its status and what's missing", () => {
    setup();
    expect(within(detail()).getByText("GitHub")).toBeInTheDocument();
    expect(within(detail()).getByText("Needs setup")).toBeInTheDocument();
    expect(within(detail()).getByText("Missing: Token")).toBeInTheDocument();
  });

  it("shows the dashboards and bots using it, with Open", async () => {
    const { onOpenWorkspace, onOpenBotInBotsView } = setup();
    fireEvent.click(row("Slack"));
    await waitFor(() =>
      expect(within(detail()).getByText("Digest")).toBeInTheDocument(),
    );
    const usedBy = within(detail()).getByTestId("provider-used-by");
    // The dashboard row (with its widget count) and the bot's team.
    expect(within(usedBy).getAllByText("Kitchen Sink")).toHaveLength(2);
    expect(within(usedBy).getByText("1 widget")).toBeInTheDocument();
    fireEvent.click(within(usedBy).getByRole("button", { name: "Open" }));
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
    fireEvent.click(
      within(usedBy).getByRole("button", { name: "Open in Bots view" }),
    );
    expect(onOpenBotInBotsView).toHaveBeenCalledWith(workspaces[0], "b1");
    // An unassigned bot has no team view to open.
    expect(
      within(usedBy).getAllByRole("button", { name: "Open in Bots view" }),
    ).toHaveLength(1);
  });

  it("Edit opens the provider's edit form", () => {
    setup();
    fireEvent.click(row("Slack"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("mcp-edit")).toHaveTextContent("Slack");
  });

  it("Delete asks first, then deletes", () => {
    const { dashApi } = setup();
    fireEvent.click(row("Algolia"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByTestId("confirmation-modal")).getByText("Delete"),
    );
    expect(dashApi.deleteProvider).toHaveBeenCalledWith(
      "app",
      "Algolia",
      expect.any(Function),
      expect.any(Function),
    );
  });
});

describe("ProvidersSection Choose where to use… (NAV-015)", () => {
  it("moves a widget and a bot to this provider, saves, and reloads dashboards", async () => {
    const appProviders = {
      ...providers,
      Slack: { ...providers.Slack, isDefaultForType: false },
      "Slack Comms": {
        type: "slack",
        providerClass: "mcp",
        mcpConfig: { transport: "stdio", envMapping: { T: "xoxbToken" } },
        credentials: { xoxbToken: "y" },
      },
    };
    const boundWorkspaces = [
      {
        id: 1,
        name: "Kitchen Sink",
        layout: [
          {
            id: 1,
            component: "SlackWidget",
            dashboardId: 1,
            selectedProviders: { slack: "Slack" },
          },
        ],
      },
    ];
    const onReloadWorkspaces = jest.fn();
    const { dashApi } = setup({
      appProviders,
      workspaces: boundWorkspaces,
      onReloadWorkspaces,
    });
    window.mainApi.bots.save = jest.fn(async (d) => d);
    fireEvent.click(row("Slack Comms"));
    // Bots load asynchronously; wait for them before opening the dialog.
    await waitFor(() => expect(window.mainApi.bots.list).toHaveBeenCalled());
    await waitFor(() => Promise.resolve());
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Choose where to use…" }),
    );
    const modal = screen.getByTestId("modal");
    expect(within(modal).getByText("Use Slack Comms for…")).toBeInTheDocument();
    fireEvent.click(within(modal).getByLabelText("SlackWidget"));
    fireEvent.click(within(modal).getByLabelText("Digest"));
    fireEvent.click(
      within(modal).getByRole("button", { name: "Save — 2 changes" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("provider-use-summary")).toBeInTheDocument(),
    );
    const saved = dashApi.saveWorkspace.mock.calls[0][1];
    expect(saved.layout[0].selectedProviders.slack).toBe("Slack Comms");
    expect(saved.selectedProviders["1"].slack).toBe("Slack Comms");
    expect(window.mainApi.bots.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b1",
        mcpServers: ["Slack", "Slack Comms"],
      }),
    );
    expect(onReloadWorkspaces).toHaveBeenCalled();
  });
});

describe("ProvidersSection deep links (NAV-007 AC2)", () => {
  it("a link to a provider selects it", () => {
    setup({ initialProviderName: "Echo" });
    expect(within(detail()).getByText("Echo")).toBeInTheDocument();
  });

  it("a create link opens the create flow for that class and type", () => {
    setup({
      initialCreateRequested: true,
      initialProviderClass: "mcp",
      initialProviderType: "gmail",
    });
    expect(screen.getByTestId("mcp-catalog")).toHaveTextContent("gmail");
  });

  it("saves new MCP providers through the shared saveMcpProvider", () => {
    // Pinned in source: the same save (unique custom types, the
    // dash:provider-installed announcement — see saveMcpProvider.test.js) as
    // the draft review's Add/Install dialog.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "ProvidersSection.js"),
      "utf8",
    );
    expect(src).toMatch(/function handleMcpSave[\s\S]{0,800}saveMcpProvider\(/);
  });

  it("after a create link, the header's New Provider still shows the class chooser", () => {
    const utils = setup({
      initialCreateRequested: true,
      initialProviderClass: "mcp",
      initialProviderType: "gmail",
    });
    expect(screen.getByTestId("mcp-catalog")).toBeInTheDocument();
    utils.rerender(
      <AppContext.Provider
        value={{
          providers,
          dashApi: utils.dashApi,
          refreshProviders: jest.fn(),
        }}
      >
        <ProvidersSection
          dashApi={utils.dashApi}
          credentials={{ appId: "app" }}
          workspaces={workspaces}
          initialCreateRequested={true}
          initialProviderClass="mcp"
          initialProviderType="gmail"
          createRequested={true}
        />
      </AppContext.Provider>,
    );
    expect(screen.getByTestId("class-chooser")).toBeInTheDocument();
  });

  it("the header's New Provider shows the class chooser", () => {
    const onCreateAcknowledged = jest.fn();
    setup({ createRequested: true, onCreateAcknowledged });
    expect(screen.getByTestId("class-chooser")).toBeInTheDocument();
    expect(onCreateAcknowledged).toHaveBeenCalled();
  });
});
