/**
 * BotsPage — the Bots Manage page as list + detail
 * (app-navigation PRD NAV-006).
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";

const mockApprove = jest.fn();
const mockRefresh = jest.fn();
jest.mock("./useAllBots", () => ({
  useAllBots: () => ({
    loading: false,
    bots: [
      {
        id: "lead7",
        name: "Kitchen Sink Lead",
        role: "lead",
        workspaceId: 7,
      },
      {
        id: "b1",
        name: "Inbox Watch",
        workspaceId: 7,
        mcpServers: ["Gmail 3"],
        toolSelections: { "Gmail 3": ["search_emails"] },
        schedules: [{ cron: "0 9 * * *" }],
      },
      { id: "b2", name: "Digest", workspaceId: 9 },
      { id: "b3", name: "Loose Bot", workspaceId: null },
    ],
    statusOf: (id) =>
      ({ b1: "Needs approval", b2: "Running", b3: "Paused" })[id] || "Idle",
    approvalsFor: (id) =>
      id === "b1"
        ? [
            {
              id: "a1",
              request: {
                botId: "b1",
                toolName: "send_email",
                serverName: "Gmail 3",
              },
            },
          ]
        : [],
    lastRunOf: () => null,
    approve: mockApprove,
    refresh: mockRefresh,
  }),
}));
jest.mock("../Settings/details/BotDetail", () => ({
  BotDetail: ({ bot, isCreating, onSave, onCancel, onDelete }) => (
    <div data-testid="bot-editor">
      <span>{isCreating ? "creating" : `editing ${bot && bot.name}`}</span>
      <button onClick={() => onSave({ name: "Saved" })}>editor-save</button>
      {onCancel ? <button onClick={onCancel}>editor-cancel</button> : null}
      {onDelete ? <button onClick={onDelete}>editor-delete</button> : null}
    </div>
  ),
}));
jest.mock("../Bots/BotPage", () => ({
  BotPage: ({
    botId,
    onOpenInBotsView,
    onDeleted,
    onDirtyChange,
    onChanged,
  }) => (
    <div data-testid="bot-page-stub">
      <span>bot page {botId}</span>
      <button onClick={() => onOpenInBotsView({ id: 9 }, botId)}>
        stub-open-bots-view
      </button>
      <button onClick={() => onDeleted(botId)}>stub-deleted</button>
      <button onClick={() => onDirtyChange(true)}>stub-dirty</button>
      <button onClick={() => onChanged()}>stub-changed</button>
    </div>
  ),
}));
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn(() => null) },
}));

import { BotsPage } from "./BotsPage";

const workspaces = [
  { id: 7, name: "Kitchen Sink" },
  { id: 9, name: "Mail" },
];

function setup(props = {}) {
  const botsApi = {
    getSettings: jest.fn().mockResolvedValue({ autoLeads: true }),
    setSettings: jest.fn().mockResolvedValue(true),
    getRuns: jest.fn().mockResolvedValue([
      {
        status: "completed",
        endedAt: "2026-10-03T09:00:00Z",
        output: "Sent 3 emails",
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 12000, outputTokens: 2230 },
        cost: { usd: 0.06, includedInPlan: false, estimated: false },
      },
    ]),
    run: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue({ id: "b9" }),
    delete: jest.fn().mockResolvedValue(true),
  };
  window.mainApi = { bots: botsApi };
  const onOpenBotInBotsView = jest.fn();
  const utils = render(
    <AppContext.Provider value={{ providers: {} }}>
      <BotsPage
        workspaces={workspaces}
        dashApi={{ bots: botsApi }}
        onOpenBotInBotsView={onOpenBotInBotsView}
        {...props}
      />
    </AppContext.Provider>,
  );
  return { ...utils, botsApi, onOpenBotInBotsView };
}

const list = () => screen.getByRole("list", { name: "Bots" });
const detail = () => screen.getByTestId("bot-detail");
const rowNames = () =>
  within(list())
    .queryAllByRole("button")
    .map((b) => b.querySelector("[data-name]").textContent);

afterEach(() => {
  delete window.mainApi;
  mockApprove.mockReset();
});

describe("BotsPage list (NAV-006 AC1)", () => {
  it("groups bots by team, Unassigned last, with a LEAD label", () => {
    setup();
    const labels = within(list())
      .getAllByText(/Kitchen Sink$|^Mail$|Unassigned/)
      .map((n) => n.textContent);
    expect(labels).toEqual(["Kitchen Sink", "Mail", "Unassigned"]);
    expect(rowNames()).toEqual([
      "Kitchen Sink Lead",
      "Inbox Watch",
      "Digest",
      "Loose Bot",
    ]);
    expect(within(list()).getByText("Lead")).toBeInTheDocument();
  });

  it("shows each bot's avatar, trigger and status", () => {
    setup();
    expect(within(list()).getAllByTestId("bot-avatar")).toHaveLength(4);
    expect(within(list()).getByText("On a schedule")).toBeInTheDocument();
    const inbox = within(list()).getByText("Inbox Watch").closest("button");
    expect(within(inbox).getByText("Needs approval")).toBeInTheDocument();
  });

  it("search matches names and handles", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "local/digest" },
    });
    expect(rowNames()).toEqual(["Digest"]);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "inbox" },
    });
    expect(rowNames()).toEqual(["Inbox Watch"]);
  });

  it("filters by team and by status", () => {
    setup();
    const team = screen.getByRole("group", { name: "Team filter" });
    fireEvent.click(within(team).getByLabelText(/Mail/));
    expect(rowNames()).toEqual(["Digest"]);
    fireEvent.click(within(team).getByLabelText(/Mail/));
    fireEvent.click(screen.getByRole("radio", { name: "Paused" }));
    expect(rowNames()).toEqual(["Loose Bot"]);
    fireEvent.click(screen.getByRole("radio", { name: "Needs approval" }));
    expect(rowNames()).toEqual(["Inbox Watch"]);
  });

  it("turns automatic team leads on and off", async () => {
    const { botsApi } = setup();
    const box = await screen.findByLabelText("Create team leads automatically");
    // A setting under the list, not a filter in the toolbar.
    expect(screen.getByTestId("auto-leads-setting")).toContainElement(box);
    expect(box).toHaveAttribute("role", "switch");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(botsApi.setSettings).toHaveBeenCalledWith({ autoLeads: false });
  });
});

// The detail is the bot's page (NAV-016) — its header and tabs are tested in
// Bots/BotPage.test.js.
describe("BotsPage detail (NAV-006 AC2, NAV-016)", () => {
  it("shows the first bot's page, then the one you pick", () => {
    setup();
    expect(within(detail()).getByText("bot page lead7")).toBeInTheDocument();
    fireEvent.click(within(list()).getByText("Digest"));
    expect(within(detail()).getByText("bot page b2")).toBeInTheDocument();
  });

  it("passes Open in Bots view through", () => {
    const { onOpenBotInBotsView } = setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-open-bots-view"));
    expect(onOpenBotInBotsView).toHaveBeenCalledWith({ id: 9 }, "b2");
  });

  it("a deleted bot leaves the detail", async () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-deleted"));
    await waitFor(() =>
      expect(within(detail()).queryByText("bot page b2")).toBeNull(),
    );
  });
});

describe("BotsPage — unsaved changes on a bot's page (NAV-016 AC3)", () => {
  it("asks before another bot replaces it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.click(within(list()).getByText("Loose Bot"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(
      within(modal).getByText("Discard unsaved changes?"),
    ).toBeInTheDocument();
    expect(within(detail()).getByText("bot page b2")).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Discard"));
    expect(within(detail()).getByText("bot page b3")).toBeInTheDocument();
  });

  it("asks before switching to Log", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-log-view")).toBeNull();
  });

  it("keeps showing the bot when a filter would hide it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "inbox" },
    });
    expect(within(detail()).getByText("bot page b2")).toBeInTheDocument();
  });
});

describe("BotsPage — the list follows Turn on / Pause", () => {
  it("refreshes when the bot's page changes it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-changed"));
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe("BotsPage — Spending (bot-factory US-019 AC5)", () => {
  it("Bots | Spending switches the page to this month's spending and back", async () => {
    setup();
    window.mainApi.bots.spendingSummary = jest.fn().mockResolvedValue({
      month: "2026-10",
      overall: { usd: 0, tokens: 0, planTokens: 0, budget: null, state: "ok" },
      bots: [],
      dashboards: [],
      providers: [],
    });
    fireEvent.click(screen.getByRole("radio", { name: "Spending" }));
    expect(await screen.findByTestId("spending-view")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Bots" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Bots" }));
    expect(screen.getByRole("list", { name: "Bots" })).toBeInTheDocument();
  });
});

describe("BotsPage — Log (bot-factory US-003 AC5, US-014 AC9)", () => {
  it("Bots | Log shows every bot's log", async () => {
    setup();
    window.mainApi.bots.auditLog = jest
      .fn()
      .mockResolvedValue({ entries: [], more: false });
    fireEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(await screen.findByTestId("audit-log-view")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.mainApi.bots.auditLog).toHaveBeenCalledWith({
        botIds: [],
        kinds: [],
        limit: 50,
      }),
    );
  });
});
