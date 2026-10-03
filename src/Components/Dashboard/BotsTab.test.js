import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { BotsTab } from "./BotsTab";
import { STATUS_DOT } from "../Bots/teamUtils";

const workspace = { id: 7, name: "Kitchen Sink", layout: [] };
const workspaces = [workspace, { id: 9, name: "Sales", layout: [] }];

const lead = {
  id: "lead_7",
  name: "Kitchen Sink Lead",
  role: "lead",
  workspaceId: "7",
};
const allBots = [
  {
    id: "b1",
    name: "Inbox Watch",
    instructions: "x",
    workspaceId: "7",
    schedules: [{ cron: "0 7 * * *" }],
    subscriptions: [{ eventType: "e" }],
  },
  { id: "b2", name: "Notifier", instructions: "x", workspaceId: 7 },
  { id: "b3", name: "Sales Bot", instructions: "x", workspaceId: "9" },
  { id: "b4", name: "Loose", instructions: "x", workspaceId: null },
];

function setup({
  bots = allBots,
  running = [],
  paused = [],
  approvals = [],
  onOpenBotsView = jest.fn(),
} = {}) {
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    listRunning: jest.fn().mockResolvedValue(running),
    getPauseState: jest.fn().mockResolvedValue({ global: false, bots: paused }),
    listApprovals: jest.fn().mockResolvedValue(approvals),
    getRuns: jest.fn().mockResolvedValue([]),
    onRunActive: jest.fn(() => "l1"),
    onApprovalPending: jest.fn(() => "l2"),
    onStream: jest.fn(() => "l3"),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  render(
    <BotsTab
      workspace={workspace}
      workspaces={workspaces}
      onOpenBotsView={onOpenBotsView}
    />,
  );
  return { api, onOpenBotsView };
}

afterEach(() => {
  delete window.mainApi;
});

describe("BotsTab — summary (TEAM-011)", () => {
  it("lists only this dashboard's bots (ids compared as strings)", async () => {
    setup();
    expect(await screen.findByText("Inbox Watch")).toBeInTheDocument();
    expect(screen.getByText("Notifier")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).toBeNull();
    expect(screen.queryByText("Loose")).toBeNull();
  });

  it("shows each bot's status and how it starts", async () => {
    setup({ running: [{ id: "b1", name: "Inbox Watch" }], paused: ["b2"] });
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("On a schedule · on 1 event")).toBeInTheDocument();
    expect(screen.getByText("Runs manually")).toBeInTheDocument();
  });

  it("names the lead and counts the team", async () => {
    setup({ bots: [...allBots, lead] });
    expect(await screen.findByText("Kitchen Sink Lead")).toBeInTheDocument();
    expect(screen.getByText(/2 bots/)).toBeInTheDocument();
  });

  it("says what needs attention", async () => {
    setup({
      approvals: [{ id: "a1", request: { botId: "b1" } }],
    });
    expect(await screen.findByText(/1 needs? attention/)).toBeInTheDocument();
  });

  it("Open in Bots view hands off to the Bots view", async () => {
    const { onOpenBotsView } = setup();
    await screen.findByText("Inbox Watch");
    fireEvent.click(screen.getByText("Open in Bots view"));
    expect(onOpenBotsView).toHaveBeenCalled();
  });

  it("is read-only — no per-bot editing here", async () => {
    setup();
    await screen.findByText("Inbox Watch");
    expect(screen.queryByLabelText("Edit Inbox Watch")).toBeNull();
    expect(screen.queryByLabelText("Remove Notifier from team")).toBeNull();
  });

  it("shows status as a Bots-view dot + text, not a grey tag", async () => {
    setup({ running: [{ id: "b1", name: "Inbox Watch" }], paused: ["b2"] });
    const running = await screen.findByText("Running");
    expect(running.closest("[data-testid='bot-status']")).not.toBeNull();
    const dots = screen.getAllByTestId("bot-status-dot");
    expect(dots[0]).toHaveClass("rounded-full", STATUS_DOT.Running);
    expect(dots[1]).toHaveClass(STATUS_DOT.Paused);
    expect(screen.queryAllByTestId("tag")).toHaveLength(0);
  });

  it("marks the lead with a LEAD label, like the Bots view", async () => {
    setup({ bots: [...allBots, lead] });
    await screen.findByText("Kitchen Sink Lead");
    expect(screen.getByText("Lead")).toHaveClass("uppercase");
    expect(screen.queryAllByTestId("tag")).toHaveLength(0);
  });

  it("empty team points to the Bots view", async () => {
    setup({ bots: [] });
    expect(
      await screen.findByText(/No bots on this dashboard yet/),
    ).toBeInTheDocument();
    expect(screen.getByText("Open in Bots view")).toBeInTheDocument();
  });
});
