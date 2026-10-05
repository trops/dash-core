import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotActivityContent } from "./BotActivityWidget";

// The widget frame and team hook pull in the whole layout system; these
// tests cover the content.
jest.mock("../../Widget", () => ({ Widget: ({ children }) => children }));
jest.mock("../../Components/Bots/useTeamBots", () => ({
  useTeamBots: () => ({}),
}));

const runs = [
  {
    botId: "bot_w",
    botName: "Writer",
    workspaceId: "7",
    run: {
      status: "completed",
      trigger: "event",
      endedAt: "2026-10-05T14:33:00.000Z",
      output:
        "I'll load the tools I need.\n\nMorning brief saved.\nTop priority: check the AWS alarm",
      source: { label: "Inbox › Completed", chain: ["bot_i", "bot_w"] },
    },
  },
  {
    botId: "bot_x",
    botName: "Elsewhere",
    workspaceId: "9",
    run: {
      status: "completed",
      endedAt: "2026-10-05T14:32:00.000Z",
      output: "Other dashboard",
    },
  },
  {
    botId: "bot_i",
    botName: "Inbox",
    workspaceId: "7",
    run: {
      status: "failed",
      trigger: "manual",
      endedAt: "2026-10-05T14:31:00.000Z",
      error: '401 {"error":"invalid x-api-key"}',
    },
  },
];

function setup({ approvals = [] } = {}) {
  const api = {
    listRecentRuns: jest.fn().mockResolvedValue(runs),
    onStream: jest.fn(() => "s1"),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  const events = [];
  const onOpen = (e) => events.push(e.detail);
  window.addEventListener("dash:open-bots-view", onOpen);
  const team = {
    bots: [
      { id: "bot_w", name: "Writer" },
      { id: "bot_i", name: "Inbox" },
    ],
    approvals,
    refresh: jest.fn(),
  };
  render(<BotActivityContent dashboardId={7} team={team} />);
  return {
    api,
    events,
    cleanup: () => window.removeEventListener("dash:open-bots-view", onOpen),
  };
}

afterEach(() => {
  delete window.mainApi;
});

describe("BotActivityContent (TEAM-012)", () => {
  it("lists this dashboard's runs, newest first, with readable first lines", async () => {
    setup();
    const rows = await screen.findAllByTestId("bot-activity-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Writer");
    // The run's last line (its conclusion), not the opening narration.
    expect(rows[0]).toHaveTextContent("Top priority: check the AWS alarm");
    expect(rows[0]).not.toHaveTextContent("load the tools");
    // Trigger chains use bot names, never ids.
    expect(rows[0]).toHaveTextContent(
      "Triggered by Inbox › Completed · Inbox → Writer",
    );
    expect(rows[0]).not.toHaveTextContent("bot_i");
    expect(rows[1]).toHaveTextContent("Inbox");
    expect(rows[1]).toHaveTextContent("invalid x-api-key");
    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("opens a run's bot in the Bots view", async () => {
    const { events, cleanup } = setup();
    const rows = await screen.findAllByTestId("bot-activity-row");
    fireEvent.click(rows[1]);
    expect(events).toEqual([
      { workspaceId: 7, botId: "bot_i", tab: "activity" },
    ]);
    cleanup();
  });

  it("lists waiting approvals at the top", async () => {
    setup({
      approvals: [
        {
          id: "a1",
          request: {
            botId: "bot_w",
            toolName: "write_file",
            serverName: "Filesystem_pipeline",
          },
        },
      ],
    });
    expect(
      await screen.findByText(
        "Writer wants to use write_file on Filesystem_pipeline",
      ),
    ).toBeInTheDocument();
  });

  it("refreshes when a team bot finishes", async () => {
    const { api } = setup();
    await screen.findAllByTestId("bot-activity-row");
    const cb = api.onStream.mock.calls[0][0];
    cb({ botId: "bot_i", event: { type: "done" } });
    await waitFor(() => expect(api.listRecentRuns).toHaveBeenCalledTimes(2));
    cb({ botId: "bot_x", event: { type: "done" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listRecentRuns).toHaveBeenCalledTimes(2);
  });

  it("says when the team hasn't run anything", async () => {
    window.mainApi = {
      bots: {
        listRecentRuns: jest.fn().mockResolvedValue([]),
        onStream: jest.fn(() => "s1"),
        removeListener: jest.fn(),
      },
    };
    render(
      <BotActivityContent dashboardId={7} team={{ bots: [], approvals: [] }} />,
    );
    expect(
      await screen.findByText(/No bot runs on this dashboard yet/),
    ).toBeInTheDocument();
  });
});
