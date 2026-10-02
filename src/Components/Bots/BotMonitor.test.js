import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BotMonitor, relativeTime } from "./BotMonitor";

const workspaces = [
  { id: 7, name: "Kitchen Sink" },
  { id: 9, name: "Sales" },
];
const bots = {
  b1: { id: "b1", name: "Inbox Watch", workspaceId: "7" },
  b2: { id: "b2", name: "Loose", workspaceId: null },
  b3: { id: "b3", name: "CRM Sync", workspaceId: 9 },
};

function makeMonitor(over = {}) {
  return {
    loading: false,
    approvals: [],
    running: [],
    recent: [],
    botById: (id) => bots[id] || null,
    approve: jest.fn(),
    stop: jest.fn(),
    ...over,
  };
}

function renderMonitor(monitor, props = {}) {
  const onOpenBotsView = jest.fn();
  const onOpenSettings = jest.fn();
  render(
    <BotMonitor
      monitor={monitor}
      workspaces={workspaces}
      onOpenBotsView={onOpenBotsView}
      onOpenSettings={onOpenSettings}
      {...props}
    />,
  );
  return { onOpenBotsView, onOpenSettings };
}

const section = (name) => screen.getByRole("region", { name });

describe("BotMonitor — Needs you", () => {
  const approval = {
    id: "a1",
    request: { botId: "b1", serverName: "Slack", toolName: "send_message" },
  };

  it("labels each approval with its bot and dashboard", () => {
    renderMonitor(makeMonitor({ approvals: [approval] }));
    const s = section("Needs you");
    expect(
      within(s).getByText("Inbox Watch · Kitchen Sink"),
    ).toBeInTheDocument();
    expect(within(s).getByText(/send_message/)).toBeInTheDocument();
    expect(within(s).getByText(/Slack/)).toBeInTheDocument();
  });

  it("decides approvals (Allow once / Always allow / Deny)", () => {
    const monitor = makeMonitor({ approvals: [approval] });
    renderMonitor(monitor);
    fireEvent.click(screen.getByText("Always allow"));
    expect(monitor.approve).toHaveBeenCalledWith("a1", {
      allow: true,
      remember: true,
    });
    fireEvent.click(screen.getByText("Allow once"));
    expect(monitor.approve).toHaveBeenCalledWith("a1", { allow: true });
    fireEvent.click(screen.getByText("Deny"));
    expect(monitor.approve).toHaveBeenCalledWith("a1", { allow: false });
  });

  it("built-in tools can't be remembered", () => {
    renderMonitor(
      makeMonitor({
        approvals: [{ id: "a2", request: { botId: "b1", toolName: "Bash" } }],
      }),
    );
    expect(screen.queryByText("Always allow")).toBeNull();
  });

  it("Open in Bots view goes to the bot's conversation", () => {
    const { onOpenBotsView } = renderMonitor(
      makeMonitor({ approvals: [approval] }),
    );
    fireEvent.click(
      within(section("Needs you")).getByText("Open in Bots view"),
    );
    expect(onOpenBotsView).toHaveBeenCalledWith("7", "b1", "conversation");
  });
});

describe("BotMonitor — Running now", () => {
  it("shows running bots with Stop", () => {
    const monitor = makeMonitor({
      running: [
        {
          id: "b3",
          name: "CRM Sync",
          workspaceId: "9",
          startedAt: new Date(Date.now() - 3 * 60000).toISOString(),
        },
      ],
    });
    renderMonitor(monitor);
    const s = section("Running now");
    expect(within(s).getByText("CRM Sync · Sales")).toBeInTheDocument();
    expect(within(s).getByText(/3 min/)).toBeInTheDocument();
    fireEvent.click(within(s).getByText("Stop"));
    expect(monitor.stop).toHaveBeenCalledWith("b3");
  });
});

describe("BotMonitor — Recent", () => {
  const recent = [
    {
      botId: "b1",
      botName: "Inbox Watch",
      workspaceId: "7",
      run: {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: "Token expired",
      },
    },
    {
      botId: "b3",
      botName: "CRM Sync",
      workspaceId: "9",
      run: {
        status: "completed",
        endedAt: new Date().toISOString(),
        output: "**Synced** 4 deals\nmore",
      },
    },
  ];

  it("lists recent runs with status and the answer's first line (plain text)", () => {
    renderMonitor(makeMonitor({ recent }));
    const s = section("Recent");
    expect(within(s).getByText("Token expired")).toBeInTheDocument();
    expect(within(s).getByText("Synced 4 deals")).toBeInTheDocument();
    expect(within(s).getByLabelText("Failed")).toBeInTheDocument();
  });

  it("clicking a run opens the bot's Activity", () => {
    const { onOpenBotsView } = renderMonitor(makeMonitor({ recent }));
    fireEvent.click(within(section("Recent")).getByText("Token expired"));
    expect(onOpenBotsView).toHaveBeenCalledWith("7", "b1", "activity");
  });
});

describe("BotMonitor — bots with no dashboard", () => {
  it("are labelled and open in Settings instead", () => {
    const { onOpenSettings, onOpenBotsView } = renderMonitor(
      makeMonitor({
        approvals: [{ id: "a3", request: { botId: "b2", toolName: "Bash" } }],
      }),
    );
    const s = section("Needs you");
    expect(within(s).getByText("Loose · No dashboard")).toBeInTheDocument();
    expect(within(s).queryByText("Open in Bots view")).toBeNull();
    fireEvent.click(within(s).getByText("Open in Settings"));
    expect(onOpenSettings).toHaveBeenCalledWith("b2");
    expect(onOpenBotsView).not.toHaveBeenCalled();
  });
});

describe("BotMonitor — empty", () => {
  it("says all quiet and doesn't offer a run form", () => {
    renderMonitor(makeMonitor());
    expect(screen.getByText(/All quiet/)).toBeInTheDocument();
    expect(screen.queryByText(/Run a bot/)).toBeNull();
  });

  it("hides open actions when the host can't open the Bots view", () => {
    render(
      <BotMonitor
        monitor={makeMonitor({
          approvals: [{ id: "a1", request: { botId: "b1", toolName: "x" } }],
        })}
        workspaces={workspaces}
      />,
    );
    expect(screen.queryByText("Open in Bots view")).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-02T12:00:00.000Z");
  it("formats recent times", () => {
    expect(relativeTime("2026-10-02T11:59:40.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-02T11:55:00.000Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-10-02T09:00:00.000Z", now)).toBe("3 h ago");
    expect(relativeTime(null, now)).toBe("");
  });
});
