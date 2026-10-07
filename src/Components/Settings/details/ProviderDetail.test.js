/**
 * ProviderDetail — Test Connection must never stop a server your dashboards
 * are using. If the provider is already connected, report it as is; only a
 * server the test itself started is stopped afterwards.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProviderDetail } from "./ProviderDetail";
import { AppContext } from "../../../Context/App/AppContext";

const provider = {
  providerClass: "mcp",
  type: "filesystem",
  mcpConfig: { transport: "stdio", command: "npx", args: ["x"] },
  credentials: { root: "/tmp" },
};
const TOOLS = [{ name: "read_file" }, { name: "write_file" }];

function setup({ status, statusFails = false, start } = {}) {
  const dashApi = {
    mcpGetServerStatus: jest.fn((name, onSuccess, onError) => {
      if (statusFails) onError("err", new Error("no status"));
      else onSuccess("ok", status);
      return true;
    }),
    mcpStartServer: jest.fn((name, cfg, creds, onSuccess, onError) => {
      if (start && start.error) onSuccess("ok", start);
      else onSuccess("ok", start || { tools: TOOLS });
      return true;
    }),
    mcpStopServer: jest.fn(() => true),
  };
  render(
    <AppContext.Provider value={{ dashApi }}>
      <ProviderDetail providerName="Filesystem" provider={provider} />
    </AppContext.Provider>,
  );
  return dashApi;
}

const clickTest = () => fireEvent.click(screen.getByText("Test Connection"));

describe("ProviderDetail — Test Connection", () => {
  it("a connected provider is reported as is: no start, no stop", async () => {
    const api = setup({ status: { status: "connected", tools: TOOLS } });
    clickTest();
    expect(
      await screen.findByText("Connected and in use. Found 2 tools."),
    ).toBeInTheDocument();
    expect(api.mcpStartServer).not.toHaveBeenCalled();
    expect(api.mcpStopServer).not.toHaveBeenCalled();
  });

  it("a provider that isn't running is started for the test, then stopped", async () => {
    const api = setup({ status: { status: "disconnected", tools: [] } });
    clickTest();
    expect(
      await screen.findByText("Connected! Found 2 tools."),
    ).toBeInTheDocument();
    expect(api.mcpStartServer).toHaveBeenCalledWith(
      "Filesystem",
      provider.mcpConfig,
      provider.credentials,
      expect.any(Function),
      expect.any(Function),
    );
    await waitFor(() =>
      expect(api.mcpStopServer).toHaveBeenCalledWith(
        "Filesystem",
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it("a failed start shows the error and stops nothing", async () => {
    const api = setup({
      status: { status: "disconnected", tools: [] },
      start: { error: true, message: "Filesystem couldn't start: boom" },
    });
    clickTest();
    expect(
      await screen.findByText("Filesystem couldn't start: boom"),
    ).toBeInTheDocument();
    expect(api.mcpStopServer).not.toHaveBeenCalled();
  });

  it("falls back to start + stop when the status can't be read", async () => {
    const api = setup({ statusFails: true });
    clickTest();
    expect(
      await screen.findByText("Connected! Found 2 tools."),
    ).toBeInTheDocument();
    expect(api.mcpStartServer).toHaveBeenCalled();
    expect(api.mcpStopServer).toHaveBeenCalled();
  });
});

describe("ProviderDetail — built-in provider (bot-capabilities CAP-002)", () => {
  it("shows 'Built into Dash', not stdio or a command", () => {
    render(
      <AppContext.Provider value={{ dashApi: {} }}>
        <ProviderDetail
          providerName="Web Fetch"
          provider={{
            providerClass: "mcp",
            type: "web-fetch",
            mcpConfig: { transport: "in_process", builtin: "web-fetch" },
            credentials: {},
          }}
        />
      </AppContext.Provider>,
    );
    expect(screen.getByText("Built into Dash")).toBeInTheDocument();
    expect(
      screen.getByText("Inside Dash — nothing to install"),
    ).toBeInTheDocument();
    expect(screen.queryByText("stdio")).toBeNull();
    expect(screen.queryByText("Command")).toBeNull();
  });
});
