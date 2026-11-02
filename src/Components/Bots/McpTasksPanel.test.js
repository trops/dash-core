/**
 * @jest-environment jsdom
 *
 * A team lead's task settings (Settings tab), its Activity as one list of
 * runs and tasks via MCP, and the Dash Lead's routing log (bot-teams
 * TEAM-016, round 2).
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
    SegmentedControl: ({ options, value, onChange }) => (
      <span>
        {options.map((o) => (
          <button
            key={o.value}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </span>
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

// A run's opened details have their own tests (BotRunHistory.test.js).
jest.mock("./BotRunHistory", () => ({
  RunDetails: ({ run }) => (
    <div data-testid="run-details">{run.output || ""}</div>
  ),
}));

import { McpTaskSettings, LeadActivity, McpRoutingLog } from "./McpTasksPanel";

const lead = { id: "lead_7", role: "lead", workspaceId: "7", name: "Lead" };
const bots = [
  lead,
  { id: "b7", workspaceId: "7", name: "Designer" },
  { id: "x", workspaceId: "8", name: "Other" },
];
// Today, so times read the same whenever this runs.
const today = new Date();
const at = (h, m) =>
  new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    h,
    m,
  ).toISOString();

function install({
  takes = false,
  asks = false,
  tasks = [],
  runs = [],
  routes = [],
  set = true,
} = {}) {
  let changed = null;
  const api = {
    getTeamSettings: jest
      .fn()
      .mockResolvedValue({ takesMcpTasks: takes, asksTaskPassphrase: asks }),
    listMcpTasks: jest.fn().mockResolvedValue(tasks),
    // Oldest first, like the store.
    getRuns: jest.fn().mockResolvedValue([...runs].reverse()),
    listMcpRoutes: jest.fn().mockResolvedValue(routes),
    getTaskPassphraseState: jest.fn().mockResolvedValue({ set }),
    setTakesMcpTasks: jest.fn().mockResolvedValue({}),
    setAsksTaskPassphrase: jest.fn().mockResolvedValue({}),
    onMcpTasksChanged: jest.fn((cb) => {
      changed = cb;
      return "1";
    }),
    onStream: jest.fn(() => "2"),
    onRunActive: jest.fn(() => "3"),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  return { api, fireChanged: () => changed && changed() };
}

const doneTask = {
  id: "t1",
  task: "Design the guest bedroom, boho, lots of plants",
  teamName: "Room Design",
  from: "voice-assistant",
  status: "done",
  needsPassphrase: false,
  createdAt: at(9, 4),
  confirmedAt: at(9, 4),
  endedAt: at(9, 11),
  runAt: at(9, 4),
  summary: "Added to Rooms: a boho layout, six large plants.",
};
const taskRun = {
  startedAt: at(9, 4),
  endedAt: at(9, 11),
  status: "completed",
  trigger: "ask",
  via: "mcp-task:voice-assistant",
  prompt:
    "Design the guest bedroom, boho, lots of plants\n\n(A task given via MCP by voice-assistant. Do it…)",
  output: "Added to Rooms: a boho layout, six large plants.",
};
const askedRun = {
  startedAt: at(9, 5),
  status: "completed",
  trigger: "ask",
  via: "create",
  prompt: "What did Designer find yesterday?",
  output: "Three layouts and twelve images.",
};
const scheduledRun = {
  startedAt: at(7, 0),
  status: "completed",
  trigger: "schedule",
  output: "Nothing waiting on you.",
};

describe("McpTaskSettings", () => {
  it("off: agents can't see the team; turning it on shows the passphrase switch", async () => {
    const { api } = install();
    render(<McpTaskSettings workspaceId="7" />);
    const takes = await screen.findByRole("switch", {
      name: "Takes tasks via MCP",
    });
    expect(takes).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/can't see this team or give it tasks/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: "Ask for a passphrase first" }),
    ).toBeNull();
    await act(async () => fireEvent.click(takes));
    expect(api.setTakesMcpTasks).toHaveBeenCalledWith("7", true);
    const asks = screen.getByRole("switch", {
      name: "Ask for a passphrase first",
    });
    expect(asks).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Off: a task starts as soon as an app gives it."),
    ).toBeTruthy();
    await act(async () => fireEvent.click(asks));
    expect(api.setAsksTaskPassphrase).toHaveBeenCalledWith("7", true);
    expect(
      screen.getByText("These apply right away — no Save needed."),
    ).toBeTruthy();
    // Dash is for anyone: no one user's own setup in its wording.
    expect(document.body.textContent).not.toMatch(/home assistant|ha-bridge/i);
  });

  it("asks for a passphrase, none set: says so, with a way to set it", async () => {
    install({ takes: true, asks: true, set: false });
    const open = jest.fn();
    render(<McpTaskSettings workspaceId="7" onOpenMcpSettings={open} />);
    expect(
      await screen.findByTestId("mcp-task-no-passphrase"),
    ).toHaveTextContent(
      "No passphrase is set yet, so this team's tasks can't start.",
    );
    fireEvent.click(screen.getByText("Set it in Settings › MCP Server"));
    expect(open).toHaveBeenCalled();
  });

  it("a change that fails goes back and says so", async () => {
    const { api } = install();
    api.setTakesMcpTasks.mockRejectedValue(new Error("Couldn't save."));
    render(<McpTaskSettings workspaceId="7" />);
    const takes = await screen.findByRole("switch", {
      name: "Takes tasks via MCP",
    });
    await act(async () => fireEvent.click(takes));
    expect(takes).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Couldn't save.")).toBeTruthy();
  });
});

describe("LeadActivity", () => {
  it("one list, newest first: the task run tagged, its task shown once, plus other runs and tasks that never ran", async () => {
    const waiting = {
      id: "t2",
      task: "Redo the office with a standing desk",
      from: "voice-assistant",
      status: "waiting",
      needsPassphrase: true,
      createdAt: at(9, 20),
      expiresAt: at(9, 30),
    };
    install({
      takes: true,
      tasks: [waiting, doneTask],
      runs: [askedRun, taskRun, scheduledRun],
    });
    render(<LeadActivity lead={lead} bots={bots} />);
    const rows = await screen.findAllByTestId("lead-activity-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Redo the office with a standing desk");
    expect(rows[0]).toHaveTextContent("via MCP · voice-assistant");
    expect(rows[0]).toHaveTextContent(/Waiting for passphrase/);
    expect(rows[1]).toHaveTextContent("You asked");
    expect(rows[1]).toHaveTextContent("What did Designer find yesterday?");
    expect(rows[2]).toHaveTextContent("via MCP · voice-assistant");
    expect(rows[2]).toHaveTextContent("Design the guest bedroom");
    expect(rows[2]).toHaveTextContent("Done");
    expect(rows[3]).toHaveTextContent("On its schedule");
    expect(screen.getByTestId("lead-task-setting")).toHaveTextContent(
      "Takes tasks via MCP · starts them without a passphrase",
    );
  });

  it("filters: via MCP, Asked, Scheduled", async () => {
    install({
      takes: true,
      tasks: [doneTask],
      runs: [askedRun, taskRun, scheduledRun],
    });
    render(<LeadActivity lead={lead} bots={bots} />);
    await screen.findAllByTestId("lead-activity-row");
    fireEvent.click(screen.getByText("via MCP"));
    expect(screen.getAllByTestId("lead-activity-row")).toHaveLength(1);
    fireEvent.click(screen.getByText("Asked"));
    expect(screen.getAllByTestId("lead-activity-row")[0]).toHaveTextContent(
      "What did Designer find yesterday?",
    );
    fireEvent.click(screen.getByText("Scheduled"));
    expect(screen.getAllByTestId("lead-activity-row")).toHaveLength(1);
  });

  it("a task row opens in place: the task, then its run's details", async () => {
    install({ takes: true, tasks: [doneTask], runs: [taskRun] });
    render(<LeadActivity lead={lead} bots={bots} />);
    fireEvent.click(await screen.findByText(doneTask.task));
    expect(screen.getByTestId("mcp-task-detail")).toHaveTextContent(
      /Started 9:04 AM · Done 9:11 AM/,
    );
    expect(screen.getByTestId("run-details")).toHaveTextContent(
      "Added to Rooms",
    );
  });

  it("a team bot waiting on approval: Open, then Allow / Deny", async () => {
    install({
      takes: true,
      tasks: [
        {
          ...doneTask,
          status: "running",
          runAt: undefined,
          summary: undefined,
        },
      ],
    });
    const onApprove = jest.fn();
    render(
      <LeadActivity
        lead={lead}
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
    const row = await screen.findByTestId("lead-activity-row");
    expect(row).toHaveTextContent("Waiting for your approval");
    expect(row).toHaveTextContent("Designer wants to use send_email on gmail.");
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Allow"));
    expect(onApprove).toHaveBeenCalledWith("ap1", true);
  });

  it("a paused bot: needs you, not done", async () => {
    install({
      takes: true,
      tasks: [{ ...doneTask, needsYou: "Designer is paused." }],
      runs: [taskRun],
    });
    render(<LeadActivity lead={lead} bots={bots} />);
    const row = await screen.findByTestId("lead-activity-row");
    const badges = row.querySelectorAll('[data-testid="badge"]');
    const status = badges[badges.length - 1];
    expect(status).toHaveTextContent("Needs you");
    expect(status).toHaveAttribute("data-state", "warning");
  });

  it("Change in Settings opens the Settings tab", async () => {
    install();
    const open = jest.fn();
    render(<LeadActivity lead={lead} bots={bots} onOpenTaskSettings={open} />);
    expect(await screen.findByTestId("lead-task-setting")).toHaveTextContent(
      "Doesn't take tasks via MCP",
    );
    fireEvent.click(screen.getByText("Change in Settings"));
    expect(open).toHaveBeenCalled();
  });

  it("follows task changes, and stops listening when closed", async () => {
    const { api, fireChanged } = install({ takes: true, runs: [askedRun] });
    const { unmount } = render(<LeadActivity lead={lead} bots={bots} />);
    expect(await screen.findAllByTestId("lead-activity-row")).toHaveLength(1);
    api.listMcpTasks.mockResolvedValue([
      { ...doneTask, runAt: null, confirmedAt: null },
    ]);
    await act(async () => fireChanged());
    expect(screen.getAllByTestId("lead-activity-row")).toHaveLength(2);
    unmount();
    expect(api.removeListener).toHaveBeenCalledWith("1");
  });

  it("a slow reply for the last lead never lands in the next one's list", async () => {
    const { api } = install({ takes: true });
    let releaseA;
    api.getRuns.mockImplementation((id) =>
      id === "lead_7"
        ? new Promise((r) => (releaseA = r))
        : Promise.resolve([{ ...askedRun, prompt: "Lead 8's own question" }]),
    );
    const other = {
      id: "lead_8",
      role: "lead",
      workspaceId: "8",
      name: "Other lead",
    };
    const { rerender } = render(<LeadActivity lead={lead} bots={bots} />);
    rerender(<LeadActivity lead={other} bots={bots} />);
    expect(await screen.findByText("Lead 8's own question")).toBeTruthy();
    await act(async () => releaseA([{ ...scheduledRun }]));
    const rows = screen.getAllByTestId("lead-activity-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Lead 8's own question");
  });

  it("nothing yet: says so", async () => {
    install();
    render(<LeadActivity lead={lead} bots={bots} />);
    expect(await screen.findByText("Lead hasn't run yet.")).toBeTruthy();
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
          from: "voice-assistant",
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
