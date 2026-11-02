/**
 * @jest-environment jsdom
 *
 * A team's "Takes tasks via MCP" switch and its tasks, and the Dash Lead's
 * routing log (bot-teams TEAM-016).
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@trops/dash-react", () => {
  const R = require("react");
  return {
    ThemeContext: R.createContext({ currentTheme: {} }),
    Button: ({ title, onClick }) => <button onClick={onClick}>{title}</button>,
    Button3: ({ title, onClick }) => <button onClick={onClick}>{title}</button>,
    StatusBadge: ({ label, state }) => (
      <span data-testid="badge" data-state={state}>
        {label}
      </span>
    ),
    Switch: ({ checked, onChange, ariaLabel }) => (
      <button
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onChange(!checked)}
      />
    ),
  };
});

jest.mock("../Dashboard/ConfigListRow", () => ({
  useConfigTokens: () => ({
    muted: "muted",
    strong: "strong",
    hairline: "hairline",
    selectedBg: "selected",
    fieldBg: "field",
  }),
}));

import { McpTasksPanel, McpRoutingLog } from "./McpTasksPanel";

const lead = { id: "lead_7", role: "lead", workspaceId: "7", name: "Lead" };
const bots = [
  lead,
  { id: "b7", workspaceId: "7", name: "Designer" },
  { id: "x", workspaceId: "8", name: "Other" },
];
const at = (h, m) => new Date(2026, 10, 1, h, m).toISOString();

function install({ takes = false, tasks = [], routes = [], set = true } = {}) {
  let changed = null;
  const api = {
    getTeamSettings: jest.fn().mockResolvedValue({ takesMcpTasks: takes }),
    listMcpTasks: jest.fn().mockResolvedValue(tasks),
    listMcpRoutes: jest.fn().mockResolvedValue(routes),
    getTaskPassphraseState: jest.fn().mockResolvedValue({ set }),
    setTakesMcpTasks: jest.fn().mockResolvedValue({}),
    onMcpTasksChanged: jest.fn((cb) => {
      changed = cb;
      return "1";
    }),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  return { api, fireChanged: () => changed && changed() };
}

const doneTask = {
  id: "t1",
  task: "Design the guest bedroom, boho, lots of plants",
  teamName: "Room Design",
  from: "ha-bridge",
  status: "done",
  createdAt: at(9, 4),
  confirmedAt: at(9, 4),
  endedAt: at(9, 11),
  summary: "Added to Rooms: a boho layout, six large plants.",
};

describe("McpTasksPanel", () => {
  it("off: says agents can't see the team; the switch turns it on", async () => {
    const { api } = install();
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    expect(await screen.findByTestId("mcp-tasks-empty")).toHaveTextContent(
      "With this off, agents connected to Dash can't see or give tasks to this team.",
    );
    const sw = screen.getByRole("switch", { name: "Takes tasks via MCP" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await act(async () => fireEvent.click(sw));
    expect(api.setTakesMcpTasks).toHaveBeenCalledWith("7", true);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Each starts after your passphrase/)).toBeTruthy();
  });

  it("on with no passphrase: says no task can start", async () => {
    install({ takes: true, set: false });
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    expect(
      await screen.findByTestId("mcp-tasks-no-passphrase"),
    ).toHaveTextContent("Set one in Settings › MCP Server.");
  });

  it("lists tasks; a row opens in place with the whole answer", async () => {
    install({ takes: true, tasks: [doneTask] });
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    const row = await screen.findByTestId("mcp-task-row");
    expect(row).toHaveTextContent("Design the guest bedroom");
    expect(row).toHaveTextContent(
      /via MCP · ha-bridge · confirmed with passphrase/,
    );
    expect(screen.getByTestId("badge")).toHaveTextContent("Done");
    fireEvent.click(
      screen.getByText("Design the guest bedroom, boho, lots of plants"),
    );
    const detail = screen.getByTestId("mcp-task-detail");
    expect(detail).toHaveTextContent(/Started 9:04 AM · Done 9:11 AM/);
    expect(detail).toHaveTextContent("What the team said");
  });

  it("a team bot waiting on approval: Open, then Allow / Deny", async () => {
    install({
      takes: true,
      tasks: [{ ...doneTask, status: "running", summary: undefined }],
    });
    const onApprove = jest.fn();
    render(
      <McpTasksPanel
        lead={lead}
        workspaceId="7"
        bots={bots}
        approvals={[
          {
            id: "ap1",
            request: {
              botId: "b7",
              toolName: "send_email",
              serverName: "gmail",
            },
            createdAt: at(9, 6),
          },
        ]}
        onApprove={onApprove}
      />,
    );
    expect(await screen.findByTestId("badge")).toHaveTextContent(
      "Waiting for your approval",
    );
    expect(screen.getByTestId("mcp-task-row")).toHaveTextContent(
      "Designer wants to use send_email on gmail.",
    );
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Allow"));
    expect(onApprove).toHaveBeenCalledWith("ap1", true);
  });

  it("a paused bot: needs you, not done", async () => {
    install({
      takes: true,
      tasks: [
        { ...doneTask, needsYou: "Designer didn't run: this bot is paused." },
      ],
    });
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    expect(await screen.findByTestId("badge")).toHaveTextContent("Needs you");
    expect(screen.getByTestId("badge")).toHaveAttribute(
      "data-state",
      "warning",
    );
  });

  it("refreshes when tasks change", async () => {
    const { api, fireChanged } = install({ takes: true });
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    expect(await screen.findByText("No tasks via MCP yet.")).toBeTruthy();
    api.listMcpTasks.mockResolvedValue([doneTask]);
    await act(async () => fireChanged());
    expect(await screen.findByTestId("mcp-task-row")).toBeInTheDocument();
  });
});

describe("McpTasksPanel — switching teams", () => {
  it("another team's panel never shows the last team's tasks", async () => {
    const { api } = install({ takes: true, tasks: [doneTask] });
    const { rerender, unmount } = render(
      <McpTasksPanel lead={lead} workspaceId="7" bots={bots} />,
    );
    expect(await screen.findByTestId("mcp-task-row")).toBeInTheDocument();
    let release;
    api.listMcpTasks.mockReturnValue(new Promise((r) => (release = r)));
    api.getTeamSettings.mockReturnValue(new Promise(() => {}));
    rerender(<McpTasksPanel lead={lead} workspaceId="8" bots={bots} />);
    expect(screen.queryByTestId("mcp-task-row")).toBeNull();
    await act(async () => release([]));
    unmount();
    expect(api.removeListener).toHaveBeenCalled();
  });

  it("an opened row doesn't repeat its summary", async () => {
    install({ takes: true, tasks: [doneTask] });
    render(<McpTasksPanel lead={lead} workspaceId="7" bots={bots} />);
    await screen.findByTestId("mcp-task-row");
    expect(screen.getAllByText(doneTask.summary)).toHaveLength(1);
    fireEvent.click(screen.getByText(doneTask.task));
    expect(screen.getAllByText(doneTask.summary)).toHaveLength(1);
  });
});

describe("McpRoutingLog", () => {
  it("nothing routed: shows nothing", async () => {
    install();
    const { container } = render(<McpRoutingLog />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("lists what the Dash Lead routed", async () => {
    install({
      routes: [
        {
          id: "r2",
          at: at(9, 4),
          from: "ha-bridge",
          task: "Design the guest bedroom",
          team: { id: "7", name: "Room Design" },
        },
        { id: "r1", at: at(8, 30), task: "order groceries", none: true },
      ],
    });
    render(<McpRoutingLog />);
    expect(await screen.findByText("Routed via MCP")).toBeInTheDocument();
    const rows = screen.getAllByTestId("mcp-route-row");
    expect(rows[0]).toHaveTextContent(
      "Sent 'Design the guest bedroom' to Room Design",
    );
    expect(rows[1]).toHaveTextContent(
      "No team takes tasks like 'order groceries'",
    );
  });
});
