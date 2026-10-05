import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotResultsContent } from "./BotResultsWidget";

// The widget frame and team hook pull in the whole layout system; these
// tests cover the content.
jest.mock("../../Widget", () => ({ Widget: ({ children }) => children }));
jest.mock("../../Components/Bots/useTeamBots", () => ({
  useTeamBots: () => ({}),
}));

const team = (over = {}) => {
  const inbox = { id: "bot_i", name: "Inbox", workspaceId: "7" };
  const lead = {
    id: "bot_l",
    name: "Daily Lead",
    role: "lead",
    workspaceId: "7",
  };
  return {
    loading: false,
    lead,
    members: [inbox],
    bots: [lead, inbox],
    lastRunByBot: {
      bot_i: {
        status: "completed",
        trigger: "event",
        endedAt: "2026-10-05T14:30:00.000Z",
        output: "**Important unread (2):**\n1. AWS alarm",
        source: { label: "Agenda › Completed", chain: [] },
      },
    },
    statusOf: (id) => (id === "bot_i" ? "Idle" : "Idle"),
    approvalsFor: () => [],
    refresh: jest.fn(),
    ...over,
  };
};

function setup(props = {}) {
  const api = {
    run: jest.fn().mockResolvedValue({ status: "completed" }),
    bindBotWidget: jest.fn().mockResolvedValue({ bound: true }),
  };
  window.mainApi = { bots: api };
  const events = [];
  const onOpen = (e) => events.push(e.detail);
  window.addEventListener("dash:open-bots-view", onOpen);
  render(
    <BotResultsContent
      botId="bot_i"
      dashboardId={7}
      widgetId={12}
      team={team()}
      {...props}
    />,
  );
  return {
    api,
    events,
    cleanup: () => window.removeEventListener("dash:open-bots-view", onOpen),
  };
}

afterEach(() => {
  delete window.mainApi;
});

describe("BotResultsContent (TEAM-012)", () => {
  it("shows the bot, its status, what triggered it, and its latest answer as plain text", () => {
    setup();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(
      screen.getByText(/Triggered by Agenda › Completed/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bot-results-answer")).toHaveTextContent(
      "Important unread (2): 1. AWS alarm",
    );
    expect(screen.getByTestId("bot-results-answer")).not.toHaveTextContent(
      "**",
    );
  });

  it("starts the answer scrolled to the end, where the result is", () => {
    const proto = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    try {
      setup();
      expect(screen.getByTestId("bot-results-scroll").scrollTop).toBe(500);
    } finally {
      if (proto)
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", proto);
      else delete HTMLElement.prototype.scrollHeight;
    }
  });

  it("names the bots in a trigger chain", () => {
    setup({
      team: team({
        lastRunByBot: {
          bot_i: {
            status: "completed",
            trigger: "event",
            output: "Done.",
            source: { label: "Agenda › Completed", chain: ["bot_l", "bot_i"] },
          },
        },
      }),
    });
    expect(
      screen.getByText(/Agenda › Completed · Daily Lead → Inbox/),
    ).toBeInTheDocument();
  });

  it("runs the bot, and opens it in the Bots view", async () => {
    const { api, events, cleanup } = setup();
    fireEvent.click(screen.getByText("Run now"));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("bot_i", "", false),
    );
    fireEvent.click(screen.getByText("Open in Bots view"));
    expect(events).toEqual([
      { workspaceId: 7, botId: "bot_i", tab: "conversation" },
    ]);
    cleanup();
  });

  it("says when approvals are waiting, and opens them", () => {
    const { events, cleanup } = setup({
      team: team({
        statusOf: () => "Needs approval",
        approvalsFor: (id) => (id === "bot_i" ? [{ id: "a1" }] : []),
      }),
    });
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 approval waiting"));
    expect(events).toEqual([
      { workspaceId: 7, botId: "bot_i", tab: "conversation" },
    ]);
    cleanup();
  });

  it("shows a failed run's readable error", () => {
    setup({
      team: team({
        lastRunByBot: {
          bot_i: {
            status: "failed",
            error: '400 {"type":"error","error":{"message":"Out of credits"}}',
            endedAt: "2026-10-05T14:30:00.000Z",
          },
        },
        statusOf: () => "Failed",
      }),
    });
    expect(screen.getByText("Out of credits")).toBeInTheDocument();
  });

  it("says when the bot hasn't run yet", () => {
    setup({ team: team({ lastRunByBot: {} }) });
    expect(screen.getByText(/hasn.t run yet/)).toBeInTheDocument();
  });

  it("lets you pick a bot when it isn't linked, and saves the link", async () => {
    const { api } = setup({ botId: undefined });
    expect(
      screen.getByText(/Pick a bot from this dashboard/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Bot"), {
      target: { value: "bot_i" },
    });
    await waitFor(() =>
      expect(api.bindBotWidget).toHaveBeenCalledWith(7, 12, "bot_i"),
    );
    expect(await screen.findByText("Run now")).toBeInTheDocument();
  });

  it("asks again when the linked bot is gone", () => {
    setup({ botId: "bot_gone" });
    expect(
      screen.getByText(/isn.t on this dashboard any more/),
    ).toBeInTheDocument();
  });

  it("a lead shows its answer but no Run now", () => {
    setup({
      botId: "bot_l",
      team: team({
        lastRunByBot: { bot_l: { status: "completed", output: "All good." } },
      }),
    });
    expect(screen.getByText("All good.")).toBeInTheDocument();
    expect(screen.queryByText("Run now")).toBeNull();
    expect(screen.getByText("Open in Bots view")).toBeInTheDocument();
  });
});
