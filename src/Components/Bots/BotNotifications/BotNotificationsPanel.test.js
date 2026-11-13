/**
 * BotNotificationsPanel (lead-workspace release 4, frames 22, 27–29): the
 * shown dashboard's lead and Open conversation; Needs you from every
 * dashboard, answered here or opened in its conversation; Activity for this
 * dashboard or all.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { WorkspaceContext } from "../../../Context/WorkspaceContext";
import { BotNotificationsPanel } from "./BotNotificationsPanel";

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();

const BOTS = [
  { id: "inbox", name: "Inbox Watch", workspaceId: 7, mcpServers: ["Gmail"] },
  { id: "index", name: "Index Watch", workspaceId: 9 },
  { id: "lead_7", name: "Kitchen Sink Lead", role: "lead", workspaceId: 7 },
];

function setup({
  approvals = [],
  lastRuns = {},
  recents = [],
  runs = [],
} = {}) {
  window.localStorage.removeItem("dash:botNotifications:seenAt");
  window.mainApi = {
    bots: {
      list: jest.fn().mockResolvedValue(BOTS),
      listApprovals: jest.fn().mockResolvedValue(approvals),
      listRunning: jest.fn().mockResolvedValue([]),
      listRecentRuns: jest.fn().mockResolvedValue(runs),
      lastRuns: jest.fn().mockResolvedValue(lastRuns),
      getPauseState: jest.fn().mockResolvedValue({ bots: [] }),
      budgetStatus: jest.fn().mockResolvedValue({}),
      listDashTeam: jest.fn().mockResolvedValue([]),
      listLeads: jest.fn().mockResolvedValue([
        {
          botId: "lead_7",
          leadName: "Kitchen Sink Lead",
          dashboardId: 7,
          dashboardName: "Kitchen Sink",
        },
        {
          botId: "lead_9",
          leadName: "Algolia Search Lead",
          dashboardId: 9,
          dashboardName: "Algolia Search",
        },
      ]),
      listCreateRecent: jest.fn().mockResolvedValue(recents),
      approve: jest.fn().mockResolvedValue({}),
      run: jest.fn().mockResolvedValue({ status: "completed" }),
      removeListener: jest.fn(),
    },
  };
  const onNeedsChange = jest.fn();
  const utils = render(
    <WorkspaceContext.Provider
      value={{
        workspaceData: { id: 7, name: "Kitchen Sink" },
        workspaces: [
          { id: 7, name: "Kitchen Sink" },
          { id: 9, name: "Algolia Search" },
        ],
      }}
    >
      <BotNotificationsPanel
        onClose={jest.fn()}
        onNeedsChange={onNeedsChange}
      />
    </WorkspaceContext.Provider>,
  );
  return { ...utils, onNeedsChange };
}
afterEach(() => {
  delete window.mainApi;
});

test("the shown dashboard's lead heads it, with Open conversation (frame 22)", async () => {
  const opened = jest.fn();
  window.addEventListener("dash:open-workspace", opened);
  setup();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Open conversation with Kitchen Sink Lead",
    }),
  );
  window.removeEventListener("dash:open-workspace", opened);
  expect(opened.mock.calls[0][0].detail).toEqual({ key: "lead:lead_7" });
  expect(
    screen.getByText("Your contact for this dashboard's bots"),
  ).toBeInTheDocument();
});

test("nothing needs you: just the log (frame 28)", async () => {
  const { onNeedsChange } = setup();
  expect(
    await screen.findByTestId("bot-notifications-quiet"),
  ).toHaveTextContent("Nothing needs you right now.");
  await waitFor(() =>
    expect(onNeedsChange).toHaveBeenLastCalledWith({ count: 0, newestAt: 0 }),
  );
});

test("an approval shows the exact command it asks to run", async () => {
  setup({
    approvals: [
      {
        id: "a1",
        createdAt: iso(5),
        request: {
          botId: "inbox",
          toolName: "Bash",
          input: { command: "date +%Y-%m-%d", description: "Get the date" },
        },
      },
    ],
  });
  const [item] = await screen.findAllByTestId("bot-notifications-item");
  expect(within(item).getByTestId("approval-preview")).toHaveTextContent(
    "Command · Get the date",
  );
  expect(within(item).getByText("date +%Y-%m-%d")).toBeInTheDocument();
});

test("an approval is answered here: Allow once / Deny", async () => {
  const { onNeedsChange } = setup({
    approvals: [
      {
        id: "a1",
        createdAt: iso(5),
        request: { botId: "inbox", toolName: "gmail_send", input: {} },
      },
      {
        id: "a2",
        createdAt: iso(3),
        request: { botId: "index", toolName: "algolia_reindex", input: {} },
      },
    ],
  });
  const items = await screen.findAllByTestId("bot-notifications-item");
  expect(items).toHaveLength(2);
  // Another dashboard's is tagged with it.
  expect(items[0]).toHaveTextContent("Index Watch · Algolia Search");
  expect(within(items[0]).getByText("Algolia Search")).toBeInTheDocument();
  expect(screen.getByText("Needs you · 2")).toBeInTheDocument();
  await waitFor(() =>
    expect(onNeedsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 2 }),
    ),
  );
  fireEvent.click(within(items[1]).getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(window.mainApi.bots.approve).toHaveBeenCalledWith("a1", {
      allow: true,
    }),
  );
  fireEvent.click(within(items[0]).getByRole("button", { name: "Deny" }));
  await waitFor(() =>
    expect(window.mainApi.bots.approve).toHaveBeenCalledWith("a2", {
      allow: false,
    }),
  );
  await waitFor(() =>
    expect(screen.queryAllByTestId("bot-notifications-item")).toHaveLength(0),
  );
});

test("a failed bot: Retry runs it; a connection problem opens the Providers page", async () => {
  const pages = jest.fn();
  window.addEventListener("dash:open-page", pages);
  setup({
    lastRuns: {
      inbox: {
        at: iso(30),
        status: "failed",
        error: "Request failed: 401 Unauthorized",
      },
      index: { at: iso(20), status: "failed", error: "It timed out." },
    },
  });
  const items = await screen.findAllByTestId("bot-notifications-item");
  fireEvent.click(within(items[0]).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(window.mainApi.bots.run).toHaveBeenCalledWith("index"),
  );
  fireEvent.click(
    within(items[1]).getByRole("button", { name: "Reconnect Gmail" }),
  );
  window.removeEventListener("dash:open-page", pages);
  expect(pages.mock.calls[0][0].detail).toEqual({
    page: "providers",
    providerName: "Gmail",
  });
});

test("a plan waiting for a yes opens its own conversation", async () => {
  const opened = jest.fn();
  window.addEventListener("dash:open-workspace", opened);
  setup({
    recents: [
      {
        id: "q1",
        kind: "question",
        planned: true,
        with: "lead:lead_7",
        title: "Add an AWS bill widget",
        updatedAt: iso(10),
      },
    ],
  });
  const [item] = await screen.findAllByTestId("bot-notifications-item");
  expect(item).toHaveTextContent("A plan is ready: Add an AWS bill widget");
  expect(item).toHaveTextContent("In your conversation with Kitchen Sink Lead");
  fireEvent.click(
    within(item).getByRole("button", { name: "Review in conversation" }),
  );
  window.removeEventListener("dash:open-workspace", opened);
  expect(opened.mock.calls[0][0].detail).toEqual({
    key: "lead:lead_7",
    recentId: "q1",
  });
});

test("Activity: this dashboard, or All with each tagged (frame 29)", async () => {
  setup({
    runs: [
      {
        botId: "inbox",
        botName: "Inbox Watch",
        workspaceId: 7,
        run: {
          status: "completed",
          endedAt: iso(15),
          output: "Checked 41 emails",
        },
      },
      {
        botId: "index",
        botName: "Index Watch",
        workspaceId: 9,
        run: {
          status: "completed",
          endedAt: iso(25),
          output: "Logged 1,204 searches",
        },
      },
    ],
  });
  await waitFor(() =>
    expect(screen.getAllByTestId("bot-notifications-log")).toHaveLength(1),
  );
  expect(screen.getByTestId("bot-notifications-log")).toHaveTextContent(
    "Inbox Watch Checked 41 emails",
  );
  fireEvent.click(screen.getByRole("radio", { name: "All" }));
  const rows = screen.getAllByTestId("bot-notifications-log");
  expect(rows).toHaveLength(2);
  expect(rows[1]).toHaveTextContent(
    "Index Watch Logged 1,204 searches · Algolia Search",
  );
});

describe("Always allow in Needs you (always-allow frames 1–3)", () => {
  const gmailAsk = {
    id: "a1",
    createdAt: iso(5),
    request: {
      botId: "inbox",
      serverName: "Gmail",
      toolName: "search_messages",
      input: { query: "newer_than:1d" },
    },
  };
  const fetchAsk = {
    id: "a2",
    createdAt: iso(4),
    request: {
      botId: "inbox",
      toolName: "WebFetch",
      input: { url: "https://news.example.com/today", prompt: "headlines" },
    },
  };

  test("a provider tool: Allow once, Always allow, Deny — and what Always allow means", async () => {
    setup({ approvals: [gmailAsk] });
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    for (const name of ["Allow once", "Always allow", "Deny"]) {
      expect(within(item).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(item).toHaveTextContent(
      "Always allow: this bot uses Search messages on Gmail without asking, every run.",
    );
  });

  test("a shell command can't be always allowed", async () => {
    setup({
      approvals: [
        {
          id: "a3",
          createdAt: iso(5),
          request: {
            botId: "inbox",
            toolName: "Bash",
            input: { command: "ls" },
          },
        },
      ],
    });
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    expect(
      within(item).queryByRole("button", { name: "Always allow" }),
    ).toBeNull();
    expect(item).not.toHaveTextContent("Always allow:");
  });

  test("Always allow saves it; the card says what, with Undo", async () => {
    setup({ approvals: [gmailAsk] });
    window.mainApi.bots.approve.mockResolvedValue({
      ok: true,
      remembered: true,
    });
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    fireEvent.click(within(item).getByRole("button", { name: "Always allow" }));
    await waitFor(() =>
      expect(window.mainApi.bots.approve).toHaveBeenCalledWith("a1", {
        allow: true,
        remember: true,
      }),
    );
    const card = await screen.findByTestId("bot-notifications-saved");
    expect(card).toHaveTextContent("Always allowed");
    expect(card).toHaveTextContent(
      "Inbox Watch uses Search messages on Gmail without asking, from now on.",
    );
    expect(screen.queryByTestId("bot-notifications-quiet")).toBeNull();

    const opened = jest.fn();
    window.addEventListener("dash:open-bot", opened);
    fireEvent.click(
      within(card).getByRole("button", {
        name: "See what it may do without asking ›",
      }),
    );
    window.removeEventListener("dash:open-bot", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({
      botId: "inbox",
      tab: "settings",
    });

    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(window.mainApi.bots.approve).toHaveBeenCalledWith("a1", {
        undo: true,
      }),
    );
    expect(screen.queryByTestId("bot-notifications-saved")).toBeNull();
  });

  test("not saved: the card says it was allowed once, with no Undo", async () => {
    setup({ approvals: [gmailAsk] });
    window.mainApi.bots.approve.mockResolvedValue({ ok: true });
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    fireEvent.click(within(item).getByRole("button", { name: "Always allow" }));
    const card = await screen.findByTestId("bot-notifications-saved");
    expect(card).toHaveTextContent("Allowed this once");
    expect(card).toHaveTextContent("couldn't save Always allow");
    expect(within(card).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  test("an Undo that didn't work keeps the card and says what to do", async () => {
    setup({ approvals: [gmailAsk] });
    window.mainApi.bots.approve.mockImplementation((id, d) =>
      Promise.resolve(
        d && d.undo ? { ok: false } : { ok: true, remembered: true },
      ),
    );
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    fireEvent.click(within(item).getByRole("button", { name: "Always allow" }));
    const card = await screen.findByTestId("bot-notifications-saved");
    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(card).toHaveTextContent(
        "couldn't undo this — use Ask again in the bot's settings",
      ),
    );
  });

  test("a web fetch: choose the whole site or only this page", async () => {
    setup({ approvals: [fetchAsk] });
    window.mainApi.bots.approve.mockResolvedValue({
      ok: true,
      remembered: true,
    });
    const [item] = await screen.findAllByTestId("bot-notifications-item");
    expect(item).toHaveTextContent("Always allow covers");
    expect(item).toHaveTextContent("Pages on news.example.com");
    expect(item).toHaveTextContent(
      "news.example.com/today — and any page on this site it redirects to",
    );
    expect(item).toHaveTextContent(
      "reads pages on news.example.com without asking",
    );
    fireEvent.click(within(item).getByLabelText(/Only this page/));
    expect(item).toHaveTextContent(
      "reads news.example.com/today without asking",
    );
    fireEvent.click(within(item).getByRole("button", { name: "Always allow" }));
    await waitFor(() =>
      expect(window.mainApi.bots.approve).toHaveBeenCalledWith("a2", {
        allow: true,
        remember: true,
        scope: "page",
      }),
    );
    expect(
      await screen.findByTestId("bot-notifications-saved"),
    ).toHaveTextContent(
      "Inbox Watch reads news.example.com/today without asking, from now on.",
    );
  });
});
