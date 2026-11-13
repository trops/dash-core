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
  it("shows the bot, its status, what triggered it, and its answer as rows", () => {
    setup();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(
      screen.getByText(/Triggered by Agenda › Completed/),
    ).toBeInTheDocument();
    // The line before the list, then one row per entry — never raw marks.
    expect(screen.getByText("Important unread (2):")).toBeInTheDocument();
    expect(screen.getAllByTestId("bot-results-item")).toHaveLength(1);
    expect(screen.getByText("AWS alarm")).toBeInTheDocument();
    expect(screen.getByTestId("bot-results-answer")).not.toHaveTextContent(
      "**",
    );
  });

  it("each row's action is a badge; the whole answer is a click away", () => {
    setup({
      team: team({
        lastRunByBot: {
          bot_i: {
            status: "completed",
            trigger: "schedule",
            endedAt: "2026-10-05T14:30:00.000Z",
            output:
              "You have 7 unread; 2 matter.\n\n1. **Dana Whitfield** — asks to move the review. Action: reply.\n2. **Google** — new sign-in from a Mac. Action: check it was you.\n\n5 newsletters left out.",
          },
        },
      }),
    });
    expect(
      screen.getByText("You have 7 unread; 2 matter."),
    ).toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
    expect(screen.getByText("Check it was you")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show the whole answer" }),
    );
    expect(screen.getByTestId("bot-results-answer")).toHaveTextContent(
      "1. Dana Whitfield — asks to move the review.",
    );
  });

  it("a short answer is said large", () => {
    setup({
      team: team({
        lastRunByBot: {
          bot_i: {
            status: "completed",
            output:
              "Searching now.\n\nYou have no unread emails from the last 24 hours.",
          },
        },
      }),
    });
    expect(screen.getByTestId("bot-results-answer")).toHaveTextContent(
      /^You have no unread emails from the last 24 hours\./,
    );
    // What came before it is a click away.
    fireEvent.click(
      screen.getByRole("button", { name: "Show the whole answer" }),
    );
    expect(screen.getByTestId("bot-results-answer")).toHaveTextContent(
      "Searching now.",
    );
  });

  it("long text starts scrolled to the end, where the result is; a list starts at the top", () => {
    const proto = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    try {
      const long =
        "Let me look. ".repeat(30) + "\n\n" + "Found it. ".repeat(30);
      setup({
        team: team({
          lastRunByBot: { bot_i: { status: "completed", output: long } },
        }),
      });
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
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("bot_i", "", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in Bots view" }));
    expect(events).toEqual([
      { workspaceId: 7, botId: "bot_i", tab: "conversation" },
    ]);
    cleanup();
  });

  it("an approval is answered right in the widget", () => {
    const approve = jest.fn();
    setup({
      team: team({
        statusOf: () => "Needs approval",
        approve,
        approvalsFor: (id) =>
          id === "bot_i"
            ? [
                {
                  id: "a1",
                  request: {
                    botId: "bot_i",
                    toolName: "mcp__Gmail__modify_labels",
                    serverName: "Gmail",
                  },
                },
              ]
            : [],
      }),
    });
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByTestId("bot-results-approval")).toHaveTextContent(
      "Wants to use modify_labels on Gmail",
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(approve).toHaveBeenCalledWith("a1", { allow: true });
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(approve).toHaveBeenCalledWith("a1", { allow: true, remember: true });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(approve).toHaveBeenCalledWith("a1", { allow: false });
  });

  it("running: what it's doing, Stop, and the last result faded", () => {
    const { api } = setup({
      team: team({ statusOf: () => "Running" }),
    });
    api.stop = jest.fn();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByTestId("bot-results-running")).toHaveTextContent(
      "Working on it…",
    );
    expect(screen.getByText("Last result")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.stop).toHaveBeenCalledWith("bot_i");
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
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "See what went wrong" }),
    ).toBeInTheDocument();
  });

  it("a run waiting for an approval is still running — no second run, no 'hasn't run'", () => {
    setup({
      team: team({
        lastRunByBot: {},
        running: ["bot_i"],
        statusOf: () => "Needs approval",
        approvalsFor: (id) =>
          id === "bot_i"
            ? [{ id: "a1", request: { botId: "bot_i", toolName: "send" } }]
            : [],
      }),
    });
    expect(screen.getByRole("button", { name: "Running…" }).disabled).toBe(
      true,
    );
    expect(screen.getByTestId("bot-results-running")).toBeInTheDocument();
    expect(screen.queryByText(/hasn.t run yet/)).toBeNull();
  });

  it("a failed run's own words aren't shown as a last result", () => {
    setup({
      team: team({
        lastRunByBot: {
          bot_i: {
            status: "failed",
            error: "boom",
            output: "I'll search Gmail.",
          },
        },
        statusOf: () => "Failed",
      }),
    });
    expect(screen.queryByText("Last result")).toBeNull();
    expect(screen.queryByText("I'll search Gmail.")).toBeNull();
  });

  it("says when the bot hasn't run yet", () => {
    setup({ team: team({ lastRunByBot: {} }) });
    expect(screen.getByText(/hasn.t run yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run it now" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: "Run now" }),
    ).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in Bots view" }),
    ).toBeInTheDocument();
  });
});
