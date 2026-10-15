/**
 * BotContacts — the Bots dock panel (bot-teams TEAM-015): a contacts list of
 * bots; pick one to chat or see its activity; Needs you at the top.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotContacts } from "./BotContacts";

const workspaces = [
  { id: 1, name: "Slack Pack" },
  { id: 2, name: "Morning Brief" },
];
const bots = [
  { id: "sl", name: "Slack Pack Lead", role: "lead", workspaceId: 1 },
  { id: "is", name: "Inbox Sorter", workspaceId: 2 },
  { id: "pr", name: "PR Digest", workspaceId: null },
];
const lastRuns = {
  sl: { at: new Date().toISOString(), status: "completed", text: "All quiet" },
  is: {
    at: new Date(Date.now() - 3600000).toISOString(),
    status: "completed",
    text: "Sorted 14",
  },
};

function contacts(over = {}) {
  return {
    loading: false,
    bots,
    approvals: [],
    running: [],
    lastRuns,
    paused: new Set(),
    approve: jest.fn(),
    stop: jest.fn(),
    setBotPaused: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.mainApi = {
    bots: {
      getRuns: jest.fn().mockResolvedValue([]),
      run: jest.fn().mockResolvedValue({ status: "completed" }),
      askLead: jest.fn().mockResolvedValue({ status: "completed" }),
      onStream: jest.fn(() => "s1"),
      removeListener: jest.fn(),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

const rowNames = () =>
  screen
    .getAllByTestId("bot-contact-row")
    .map(
      (r) => r.querySelector("button").getAttribute("aria-label").split(":")[0],
    );

test("lists bots under their dashboards, newest first, with what they last did", () => {
  render(<BotContacts contacts={contacts()} workspaces={workspaces} />);
  expect(screen.getByText("Bots")).toBeInTheDocument();
  expect(
    screen.getAllByTestId("bot-contacts-section").map((s) => s.textContent),
  ).toEqual([
    expect.stringMatching(/^Slack Pack/),
    expect.stringMatching(/^Morning Brief/),
    expect.stringMatching(/^No dashboard/),
  ]);
  expect(rowNames()).toEqual([
    "Slack Pack Lead, lead",
    "Inbox Sorter",
    "PR Digest",
  ]);
  expect(screen.getByText("All quiet")).toBeInTheDocument();
  expect(screen.getByText("Hasn't run yet")).toBeInTheDocument();
});

test("A–Z and By team are remembered", () => {
  const { unmount } = render(
    <BotContacts contacts={contacts()} workspaces={workspaces} />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "A–Z" }));
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.queryByTestId("bot-contacts-section")).toBeInTheDocument();
  expect(rowNames()).toEqual([
    "Inbox Sorter",
    "PR Digest",
    "Slack Pack Lead, lead",
  ]);
  unmount();
  render(<BotContacts contacts={contacts()} workspaces={workspaces} />);
  expect(rowNames()).toEqual([
    "Inbox Sorter",
    "PR Digest",
    "Slack Pack Lead, lead",
  ]);
});

test("search narrows the list", () => {
  render(<BotContacts contacts={contacts()} workspaces={workspaces} />);
  fireEvent.change(screen.getByLabelText("Search bots"), {
    target: { value: "digest" },
  });
  expect(rowNames()).toEqual(["PR Digest"]);
});

test("Needs you opens the waiting bot's chat, with the approval in it", async () => {
  const c = contacts({
    approvals: [
      {
        id: "a1",
        createdAt: new Date().toISOString(),
        request: { botId: "is", toolName: "gmail.send", serverName: "Gmail" },
      },
    ],
  });
  render(<BotContacts contacts={c} workspaces={workspaces} />);
  expect(screen.getByTestId("bot-contacts-needs-you")).toHaveTextContent(
    "Inbox Sorter needs you",
  );
  expect(screen.getByText("1 to approve")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByTestId("bot-contact")).toBeInTheDocument();
  expect(screen.getByText("Needs your approval")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  expect(c.approve).toHaveBeenCalledWith("a1", { allow: true });
});

test("a bot opens on its conversation; Activity, Open in Bots view and back", async () => {
  const onOpenBotsView = jest.fn();
  render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenBotsView={onOpenBotsView}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Inbox Sorter:/ }));
  expect(await screen.findByTestId("bot-contact-subtitle")).toHaveTextContent(
    "Morning Brief",
  );
  expect(screen.getByLabelText("Message")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Activity" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  expect(window.mainApi.bots.run).toHaveBeenCalledWith("is", "", false);
  fireEvent.click(screen.getByRole("button", { name: "Open in Bots view" }));
  expect(onOpenBotsView).toHaveBeenCalledWith("2", "is", "activity");
  fireEvent.click(screen.getByRole("button", { name: "All bots" }));
  expect(screen.getByTestId("bot-contacts")).toBeInTheDocument();
});

test("a clicked notification opens that bot's chat, again for a later click (US-018 AC5)", async () => {
  const { rerender } = render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      openRequest={{ botId: "is" }}
    />,
  );
  expect(await screen.findByTestId("bot-contact-subtitle")).toHaveTextContent(
    "Morning Brief",
  );
  fireEvent.click(screen.getByRole("button", { name: "All bots" }));
  expect(screen.getByTestId("bot-contacts")).toBeInTheDocument();
  rerender(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      openRequest={{ botId: "is" }}
    />,
  );
  expect(await screen.findByTestId("bot-contact-subtitle")).toHaveTextContent(
    "Morning Brief",
  );
});

test("a paused bot: Resume from its chat", async () => {
  const c = contacts({ paused: new Set(["is"]) });
  render(<BotContacts contacts={c} workspaces={workspaces} />);
  fireEvent.click(screen.getByRole("button", { name: /^Inbox Sorter:/ }));
  expect(await screen.findByTestId("bot-chat-paused")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(c.setBotPaused).toHaveBeenCalledWith("is", false);
});

test("a bot on no dashboard opens in Settings", async () => {
  const onOpenSettings = jest.fn();
  render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenSettings={onOpenSettings}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^PR Digest:/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Open in Settings" }),
  );
  expect(onOpenSettings).toHaveBeenCalledWith("pr");
});

test("no bots yet: says where to make one", () => {
  render(<BotContacts contacts={contacts({ bots: [] })} workspaces={[]} />);
  expect(screen.getByText("No bots yet")).toBeInTheDocument();
});

describe("budgets in the dock (US-019)", () => {
  const over = {
    overall: "exceeded",
    over: true,
    limit: { scope: "bot:is", budget: 5 },
  };

  test("Needs you lists an over-budget bot; its chat offers Keep running this month", async () => {
    const keepRunning = jest.fn();
    render(
      <BotContacts
        contacts={contacts({ budgets: { is: over }, keepRunning })}
        workspaces={workspaces}
      />,
    );
    expect(screen.getByTestId("bot-contacts-needs-you")).toHaveTextContent(
      "Inbox Sorter needs you",
    );
    expect(screen.getByTestId("bot-contacts-needs-you")).toHaveTextContent(
      "Over its $5.00 monthly budget",
    );
    expect(screen.getAllByText("Over budget").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByTestId("bot-contact-subtitle")).toHaveTextContent(
      "over budget",
    );
    expect(screen.getByTestId("bot-chat-over-budget")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep running this month" }),
    );
    expect(keepRunning).toHaveBeenCalledWith("is");
  });

  test("80% of budget is a word on the row", () => {
    render(
      <BotContacts
        contacts={contacts({
          budgets: { sl: { overall: "warn", over: false, limit: null } },
        })}
        workspaces={workspaces}
      />,
    );
    expect(screen.getByText("80% of budget")).toBeInTheDocument();
    expect(screen.queryByTestId("bot-contacts-needs-you")).toBeNull();
  });
});
