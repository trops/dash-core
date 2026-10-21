/**
 * BotContacts — the Bots dock panel (bot-teams TEAM-015): a contacts list of
 * bots; pick one to open its bot page (NAV-016 AC5); Needs you at the top.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BotContacts } from "./BotContacts";
import { WorkspaceContext } from "../../Context/WorkspaceContext";

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

test("Needs you opens the waiting bot's page", () => {
  const onOpenBot = jest.fn();
  const c = contacts({
    approvals: [
      {
        id: "a1",
        createdAt: new Date().toISOString(),
        request: { botId: "is", toolName: "gmail.send", serverName: "Gmail" },
      },
    ],
  });
  render(
    <BotContacts contacts={c} workspaces={workspaces} onOpenBot={onOpenBot} />,
  );
  expect(screen.getByTestId("bot-contacts-needs-you")).toHaveTextContent(
    "Inbox Sorter needs you",
  );
  expect(screen.getByText("1 to approve")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(onOpenBot).toHaveBeenCalledWith("is", "conversation");
});

test("a bot opens its page; the panel stays the list (NAV-016 AC5)", () => {
  const onOpenBot = jest.fn();
  render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenBot={onOpenBot}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^PR Digest:/ }));
  expect(onOpenBot).toHaveBeenCalledWith("pr", "conversation");
  expect(screen.getByTestId("bot-contacts")).toBeInTheDocument();
  expect(screen.queryByLabelText("Message")).toBeNull();
});

test("with no host handler, a bot click asks the app to open it", () => {
  const seen = [];
  const listen = (e) => seen.push(e.detail);
  window.addEventListener("dash:open-bot", listen);
  render(<BotContacts contacts={contacts()} workspaces={workspaces} />);
  fireEvent.click(screen.getByRole("button", { name: /^Inbox Sorter:/ }));
  window.removeEventListener("dash:open-bot", listen);
  expect(seen).toEqual([{ botId: "is", tab: "conversation" }]);
});

test("a clicked notification opens that bot, again for a later click (US-018 AC5)", () => {
  const onOpenBot = jest.fn();
  const { rerender } = render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenBot={onOpenBot}
      openRequest={{ botId: "is" }}
    />,
  );
  expect(onOpenBot).toHaveBeenCalledTimes(1);
  rerender(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenBot={onOpenBot}
      openRequest={{ botId: "is" }}
    />,
  );
  expect(onOpenBot).toHaveBeenCalledTimes(2);
  expect(onOpenBot).toHaveBeenLastCalledWith("is", "conversation");
});

test("reopening the panel doesn't replay an old notification", () => {
  const onOpenBot = jest.fn();
  const request = { botId: "is" };
  const props = { contacts: contacts(), workspaces, onOpenBot };
  const { unmount } = render(<BotContacts {...props} openRequest={request} />);
  expect(onOpenBot).toHaveBeenCalledTimes(1);
  unmount();
  render(<BotContacts {...props} openRequest={request} />);
  expect(onOpenBot).toHaveBeenCalledTimes(1);
});

test("an open request with no bot (tray: Open Bots panel) just shows the list", () => {
  const onOpenBot = jest.fn();
  render(
    <BotContacts
      contacts={contacts()}
      workspaces={workspaces}
      onOpenBot={onOpenBot}
      openRequest={{ botId: null }}
    />,
  );
  expect(onOpenBot).not.toHaveBeenCalled();
  expect(screen.getByTestId("bot-contacts")).toBeInTheDocument();
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

  test("Needs you lists an over-budget bot; Review opens its page", () => {
    const onOpenBot = jest.fn();
    render(
      <BotContacts
        contacts={contacts({ budgets: { is: over } })}
        workspaces={workspaces}
        onOpenBot={onOpenBot}
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
    expect(onOpenBot).toHaveBeenCalledWith("is", "conversation");
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

describe("pinned: this dashboard's lead and the Dash team (consolidation Phase 4a)", () => {
  const onDashboard = (id, over = {}) =>
    render(
      <WorkspaceContext.Provider
        value={{ workspaceData: id === null ? null : { id, name: "x" } }}
      >
        <BotContacts
          contacts={contacts(over)}
          workspaces={workspaces}
          {...(over.props || {})}
        />
      </WorkspaceContext.Provider>,
    );
  const pinned = () => screen.queryByTestId("bot-contacts-pinned");

  test("the open dashboard's lead is pinned with Dash team, and not repeated below", () => {
    onDashboard(1);
    const box = pinned();
    expect(box).toHaveTextContent("Pinned");
    expect(
      within(box)
        .getByTestId("bot-contact-row")
        .querySelector("button")
        .getAttribute("aria-label"),
    ).toMatch(/^Slack Pack Lead, lead: All quiet/);
    expect(box).toHaveTextContent("This dashboard · All quiet");
    expect(within(box).getByTestId("bot-contact-dash-team")).toHaveTextContent(
      "Ask about anything, or plan something new",
    );
    // Below: the other bots only.
    const below = screen.getAllByTestId("bot-contacts-section").flatMap((s) =>
      within(s)
        .queryAllByTestId("bot-contact-row")
        .map((r) => r.textContent),
    );
    expect(below.join(" ")).not.toMatch(/Slack Pack Lead/);
    expect(below.join(" ")).toMatch(/Inbox Sorter/);
  });

  test("no dashboard open (a Manage page): only Dash team is pinned", () => {
    onDashboard(null);
    expect(within(pinned()).queryByTestId("bot-contact-row")).toBeNull();
    expect(
      within(pinned()).getByTestId("bot-contact-dash-team"),
    ).toBeInTheDocument();
    expect(rowNames()).toContain("Slack Pack Lead, lead");
  });

  test("a dashboard with no lead: only Dash team is pinned", () => {
    onDashboard(2);
    expect(within(pinned()).queryByTestId("bot-contact-row")).toBeNull();
  });

  test("the pinned lead opens its page; Dash team opens the team's page", () => {
    const onOpenBot = jest.fn();
    onDashboard(1, { props: { onOpenBot } });
    fireEvent.click(
      within(pinned()).getByTestId("bot-contact-row").querySelector("button"),
    );
    expect(onOpenBot).toHaveBeenCalledWith("sl", "conversation");
    const opened = jest.fn();
    window.addEventListener("dash:open-dash-team", opened);
    fireEvent.click(
      within(pinned())
        .getByTestId("bot-contact-dash-team")
        .querySelector("button"),
    );
    window.removeEventListener("dash:open-dash-team", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({ tab: "conversation" });
  });

  test("search filters the pinned rows too", () => {
    onDashboard(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search bots" }), {
      target: { value: "inbox" },
    });
    expect(pinned()).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search bots" }), {
      target: { value: "dash" },
    });
    expect(
      within(pinned()).getByTestId("bot-contact-dash-team"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No bots match/)).toBeNull();
  });

  test("By team off: pinned stays, the rest is one labelled list", () => {
    window.localStorage.setItem("dash:bot-contacts:by-team", "false");
    onDashboard(1);
    expect(pinned()).toBeInTheDocument();
    const sections = screen.getAllByTestId("bot-contacts-section");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toHaveTextContent(/^All bots/);
  });

  test("no bots yet: Dash team is still there, and says it can make one", () => {
    onDashboard(null, { bots: [] });
    expect(
      within(pinned()).getByTestId("bot-contact-dash-team"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your bots show up here. Ask the Dash team to make one.",
      ),
    ).toBeInTheDocument();
  });
});
