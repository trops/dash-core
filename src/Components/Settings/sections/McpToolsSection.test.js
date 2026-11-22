/**
 * @jest-environment jsdom
 *
 * Settings › MCP Server › Tools (DASH-37): the counts, a tool's switch,
 * a group's Choose, and the bot tools' passphrase switch and teams.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("../../Dashboard/ConfigListRow", () => ({
  useConfigTokens: () => ({
    muted: "muted",
    strong: "strong",
    hairline: "hairline",
    fieldBg: "field",
  }),
}));

import { McpToolsSection } from "./McpToolsSection";

const TOOLS = [
  {
    name: "list_bots",
    description: "List the bots. More words.",
    group: "bots",
    groupLabel: "Bots",
    on: false,
    defaultOff: true,
  },
  {
    name: "create_bot",
    description: "Make a bot.",
    group: "bots",
    groupLabel: "Bots",
    on: false,
    defaultOff: true,
  },
  {
    name: "list_dashboards",
    description: "List dashboards.",
    group: "dashboards",
    groupLabel: "Dashboards",
    on: true,
    defaultOff: false,
  },
  {
    name: "get_dashboard",
    description: "One dashboard.",
    group: "dashboards",
    groupLabel: "Dashboards",
    on: true,
    defaultOff: false,
  },
];

function installApi() {
  const mcp = {
    listTools: jest.fn().mockResolvedValue(TOOLS),
    setToolOn: jest.fn((name, on) =>
      Promise.resolve(TOOLS.map((t) => (t.name === name ? { ...t, on } : t))),
    ),
  };
  const bots = {
    getMcpBotSettings: jest
      .fn()
      .mockResolvedValue({ asksPassphrase: true, teams: ["1"] }),
    setAsksBotPassphrase: jest.fn((on) =>
      Promise.resolve({ asksPassphrase: on, teams: ["1"] }),
    ),
    setTakesMcpBots: jest.fn((id, on) =>
      Promise.resolve({
        asksPassphrase: true,
        teams: on ? ["1", String(id)] : [],
      }),
    ),
  };
  window.mainApi = { mcpDashServer: mcp, bots };
  return { mcp, bots };
}

const workspaces = [
  { id: 1, name: "Sales" },
  { id: 2, name: "Ops" },
];

afterEach(() => {
  delete window.mainApi;
});

test("shows the counts and the bots group first", async () => {
  installApi();
  render(<McpToolsSection workspaces={workspaces} />);
  expect(await screen.findByTestId("mcp-tools-count")).toHaveTextContent(
    "2 of 4 on",
  );
  expect(screen.getByTestId("mcp-tools-count-Bots")).toHaveTextContent(
    "0 of 2 on",
  );
  expect(screen.getByTestId("mcp-tools-count-Dashboards")).toHaveTextContent(
    "2 of 2 on",
  );
  expect(screen.getByText("New · off by default")).toBeInTheDocument();
  expect(
    screen.getByText(
      "What MCP clients connected to Dash can do. A tool that's off isn't offered to them at all.",
    ),
  ).toBeInTheDocument();
  // Only the first sentence of a description.
  expect(screen.getByText("List the bots.")).toBeInTheDocument();
});

test("a tool's switch calls the API and the count follows", async () => {
  const { mcp } = installApi();
  render(<McpToolsSection workspaces={workspaces} />);
  fireEvent.click(await screen.findByRole("switch", { name: "list_bots" }));
  expect(mcp.setToolOn).toHaveBeenCalledWith("list_bots", true);
  await waitFor(() =>
    expect(screen.getByTestId("mcp-tools-count-Bots")).toHaveTextContent(
      "1 of 2 on",
    ),
  );
  expect(screen.getByTestId("mcp-tools-count")).toHaveTextContent("3 of 4 on");
});

test("other groups open with Choose", async () => {
  const { mcp } = installApi();
  render(<McpToolsSection workspaces={workspaces} />);
  await screen.findByTestId("mcp-tools-count");
  expect(screen.queryByRole("switch", { name: "get_dashboard" })).toBeNull();
  fireEvent.click(screen.getByText("Choose"));
  fireEvent.click(screen.getByRole("switch", { name: "get_dashboard" }));
  expect(mcp.setToolOn).toHaveBeenCalledWith("get_dashboard", false);
  expect(screen.getByText("Done")).toBeInTheDocument();
});

test("the passphrase switch and Which teams call the bots API", async () => {
  const { bots } = installApi();
  render(<McpToolsSection workspaces={workspaces} />);
  const ask = await screen.findByRole("switch", {
    name: "Ask for the task passphrase to create or change a bot",
  });
  expect(ask).toBeChecked();
  fireEvent.click(ask);
  expect(bots.setAsksBotPassphrase).toHaveBeenCalledWith(false);

  const sales = screen.getByRole("checkbox", { name: "Sales" });
  const ops = screen.getByRole("checkbox", { name: "Ops" });
  expect(sales).toBeChecked();
  expect(ops).not.toBeChecked();
  fireEvent.click(ops);
  expect(bots.setTakesMcpBots).toHaveBeenCalledWith(2, true);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Ops" })).toBeChecked(),
  );
});

test("a switch that fails says so", async () => {
  const { mcp } = installApi();
  mcp.setToolOn.mockRejectedValueOnce(new Error("nope"));
  render(<McpToolsSection workspaces={workspaces} />);
  fireEvent.click(await screen.findByRole("switch", { name: "create_bot" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't turn create_bot on. Try again.",
  );
});

test("bot settings that can't be loaded say so", async () => {
  const { bots } = installApi();
  bots.getMcpBotSettings.mockRejectedValueOnce(new Error("nope"));
  render(<McpToolsSection workspaces={workspaces} />);
  expect(
    await screen.findByTestId("mcp-bot-settings-failed"),
  ).toHaveTextContent("Couldn't load the passphrase and team settings");
  expect(
    screen.queryByRole("switch", {
      name: "Ask for the task passphrase to create or change a bot",
    }),
  ).toBeNull();
});
