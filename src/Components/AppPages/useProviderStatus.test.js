import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";

const mockConfig = jest.fn((name) =>
  name === "SlackWidget" ? { providers: [{ type: "slack" }] } : null,
);
jest.mock("../../ComponentManager", () => ({
  ComponentManager: {
    config: (...args) => mockConfig(...args),
  },
}));

import {
  useProviderStatus,
  useProvidersNeedingSetup,
} from "./useProviderStatus";

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
};
const workspaces = [
  {
    id: 1,
    name: "Kitchen Sink",
    layout: [{ id: 1, component: "SlackWidget", dashboardId: 1 }],
  },
];

function makeDashApi() {
  return {
    mcpGetServerStatus: jest.fn((name, ok) =>
      ok(null, { status: name === "Slack" ? "connected" : "disconnected" }),
    ),
    mcpGetCatalog: jest.fn((ok) =>
      ok(null, {
        catalog: [
          {
            id: "slack",
            credentialSchema: {
              teamId: { displayName: "Team", required: true },
            },
          },
        ],
      }),
    ),
  };
}

function setupBots() {
  const listeners = {};
  window.mainApi = {
    bots: {
      list: jest
        .fn()
        .mockResolvedValue([
          { id: "b1", name: "Digest", workspaceId: 1, mcpServers: ["Slack"] },
        ]),
      onListChanged: jest.fn((cb) => {
        listeners.list = cb;
        return "l";
      }),
      removeListener: jest.fn(),
    },
  };
  return listeners;
}

afterEach(() => {
  delete window.mainApi;
});

describe("useProviderStatus (app-navigation NAV-007)", () => {
  it("asks which MCP servers are running and works out each status", async () => {
    setupBots();
    const dashApi = makeDashApi();
    const { result } = renderHook(() =>
      useProviderStatus({ providers, workspaces, dashApi, catalog: [] }),
    );
    await waitFor(() =>
      expect(result.current.statusOf("Slack").key).toBe("connected"),
    );
    expect(dashApi.mcpGetServerStatus).toHaveBeenCalledTimes(2);
    expect(result.current.statusOf("GitHub").key).toBe("needsSetup");
    expect(result.current.statusOf("Algolia").label).toBe("Saved");
  });

  it("uses the catalog's 'one of these' credential options", async () => {
    setupBots();
    const stableDashApi = makeDashApi();
    const catalog = (credentialOptions) => [
      {
        id: "slack",
        credentialSchema: {
          xoxbToken: { displayName: "Bot Token" },
          xoxpToken: { displayName: "User Token", required: true },
        },
        credentialOptions,
      },
    ];
    // Without options the (required) user token is missing…
    const without = renderHook(() =>
      useProviderStatus({
        providers,
        workspaces,
        dashApi: stableDashApi,
        catalog: catalog(undefined),
      }),
    );
    await waitFor(() =>
      expect(without.result.current.statusOf("Slack").key).toBe("needsSetup"),
    );
    // …with options, the filled bot token is enough.
    const withOptions = renderHook(() =>
      useProviderStatus({
        providers,
        workspaces,
        dashApi: stableDashApi,
        catalog: catalog([["xoxbToken"], ["xoxpToken"]]),
      }),
    );
    await waitFor(() =>
      expect(withOptions.result.current.statusOf("Slack").key).not.toBe(
        "needsSetup",
      ),
    );
  });

  it("uses the catalog's required fields", async () => {
    setupBots();
    const stableDashApi = makeDashApi();
    const { result } = renderHook(() =>
      useProviderStatus({
        providers,
        workspaces,
        dashApi: stableDashApi,
        catalog: [
          {
            id: "slack",
            credentialSchema: {
              teamId: { displayName: "Team", required: true },
            },
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(result.current.statusOf("Slack").missing).toEqual(["Team"]),
    );
  });

  it("knows which dashboards and bots use a provider", async () => {
    setupBots();
    const stableDashApi = makeDashApi();
    const { result } = renderHook(() =>
      useProviderStatus({
        providers,
        workspaces,
        dashApi: stableDashApi,
        catalog: [],
      }),
    );
    await waitFor(() =>
      expect(result.current.usageOf("Slack").bots).toHaveLength(1),
    );
    expect(result.current.usageOf("Slack").dashboards).toEqual([
      { workspaceId: 1, workspaceName: "Kitchen Sink", widgets: 1 },
    ]);
    expect(result.current.usageOf("GitHub").count).toBe(0);
  });

  it("re-checks running servers when the window regains focus", async () => {
    setupBots();
    const dashApi = makeDashApi();
    renderHook(() =>
      useProviderStatus({ providers, workspaces, dashApi, catalog: [] }),
    );
    await waitFor(() =>
      expect(dashApi.mcpGetServerStatus).toHaveBeenCalledTimes(2),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(dashApi.mcpGetServerStatus).toHaveBeenCalledTimes(4);
  });
});

describe("useProviderStatus — work out widget bindings once (perf)", () => {
  it("looks each widget up once, however many providers ask 'used by'", async () => {
    setupBots();
    const stableDashApi = makeDashApi();
    const { result } = renderHook(() =>
      useProviderStatus({
        providers,
        workspaces,
        dashApi: stableDashApi,
        catalog: [],
      }),
    );
    await waitFor(() =>
      expect(result.current.usageOf("Slack").bots).toHaveLength(1),
    );
    mockConfig.mockClear();
    for (const name of Object.keys(providers)) result.current.usageOf(name);
    for (const name of Object.keys(providers)) result.current.usageOf(name);
    // Cached from the first lookup above: no further widget lookups.
    expect(mockConfig).not.toHaveBeenCalled();
    expect(result.current.usageOf("Slack").dashboards).toEqual([
      { workspaceId: 1, workspaceName: "Kitchen Sink", widgets: 1 },
    ]);
  });
});

describe("useProvidersNeedingSetup (left-nav attention)", () => {
  it("counts the providers that need setup, using the catalog", async () => {
    const dashApi = makeDashApi();
    const wrapper = ({ children }) => (
      <AppContext.Provider value={{ providers, dashApi }}>
        {children}
      </AppContext.Provider>
    );
    const { result } = renderHook(() => useProvidersNeedingSetup(), {
      wrapper,
    });
    // GitHub (empty token) + Slack (catalog-required Team is empty).
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("is 0 without providers", () => {
    const { result } = renderHook(() => useProvidersNeedingSetup());
    expect(result.current).toBe(0);
  });
});
