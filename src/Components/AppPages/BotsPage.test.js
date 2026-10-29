/**
 * BotsPage — managing bots, teams first (lead-workspace release 5, frames
 * 14, 15, 23–26; app-navigation NAV-006 / NAV-016).
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
// The Dash team, listed first when a test sets it.
let mockDashTeam = [];
const MOCK_BOTS = [
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
];
let mockBots = MOCK_BOTS;
jest.mock("./useAllBots", () => ({
  useAllBots: () => ({
    loading: false,
    dashTeam: mockDashTeam,
    bots: mockBots,
    statusOf: (id) =>
      ({ b1: "Needs approval", b2: "Running", b3: "Paused" })[id] || "Idle",
    approvals: [
      {
        id: "a1",
        request: { botId: "b1", toolName: "send_email", serverName: "Gmail 3" },
      },
    ],
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
    manageOnly,
    onOpenInBotsView,
    onDeleted,
    onDirtyChange,
    onChanged,
  }) => (
    <div data-testid="bot-page-stub">
      <span>bot page {botId}</span>
      {manageOnly ? <span>manage only</span> : null}
      <button onClick={() => onOpenInBotsView({ id: 9 }, botId)}>
        stub-open-bots-view
      </button>
      <button onClick={() => onDeleted(botId)}>stub-deleted</button>
      <button onClick={() => onDirtyChange(true)}>stub-dirty</button>
      <button onClick={() => onChanged()}>stub-changed</button>
    </div>
  ),
}));
jest.mock("../Bots/DashTeamPage", () => ({
  DashTeamPage: ({ role, manageOnly, initialTab, onDirtyChange }) => (
    <div data-testid="dash-team-page-stub">
      {`dash team ${role} ${initialTab}${manageOnly ? " manage" : ""}`}
      <button onClick={() => onDirtyChange(true)}>team-dirty</button>
    </div>
  ),
}));
jest.mock("../Bots/useSpending", () => ({
  useSpending: () => ({
    summary: {
      month: "2026-10",
      overall: {
        usd: 1.2,
        tokens: 0,
        planTokens: 0,
        budget: null,
        state: "ok",
      },
      bots: [
        {
          id: "b1",
          name: "Inbox Watch",
          usd: 1.2,
          tokens: 0,
          planTokens: 0,
          budget: null,
          state: "ok",
        },
      ],
      dashboards: [],
      providers: [],
    },
    setBudget: jest.fn(),
    keepRunning: jest.fn(),
    reload: jest.fn(),
  }),
}));
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn(() => null) },
}));

import { BotsPage } from "./BotsPage";

const workspaces = [
  { id: 7, name: "Kitchen Sink" },
  { id: 9, name: "Mail" },
  { id: 11, name: "Calendar" },
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
  const onOpenWorkspace = jest.fn();
  const utils = render(
    <AppContext.Provider value={{ providers: {} }}>
      <BotsPage
        workspaces={workspaces}
        dashApi={{ bots: botsApi }}
        onOpenBotInBotsView={onOpenBotInBotsView}
        onOpenWorkspace={onOpenWorkspace}
        {...props}
      />
    </AppContext.Provider>,
  );
  return { ...utils, botsApi, onOpenBotInBotsView, onOpenWorkspace };
}

const list = () => screen.getByRole("list", { name: "Teams and bots" });
const detail = () => screen.getByTestId("bot-detail");
const teamRows = () =>
  screen.getAllByTestId("bots-tree-team").map((t) => {
    const b = within(t).getAllByRole("button")[0];
    return [
      b.querySelector("[data-name]").textContent,
      b.getAttribute("aria-expanded"),
      b.textContent,
    ];
  });
const botNames = () =>
  screen
    .queryAllByTestId("bots-tree-bot")
    .map((b) => (b.querySelector("[data-name]") || b).textContent);
const team = (name) =>
  within(list())
    .getAllByRole("button", { expanded: expect.anything() })
    .find((b) => b.textContent.includes(name));
const teamButton = (name) =>
  screen
    .getAllByTestId("bots-tree-team")
    .map((t) => within(t).getAllByRole("button")[0])
    .find(
      (b) => b.textContent.startsWith(name) || b.textContent.includes(name),
    );

afterEach(() => {
  delete window.mainApi;
  mockApprove.mockReset();
  mockDashTeam = [];
  mockBots = MOCK_BOTS;
});

describe("BotsPage — teams first (frame 23)", () => {
  it("teams, closed unless picked or needing you; Needs you on top", () => {
    setup();
    const rows = teamRows();
    expect(rows.map((r) => r[0])).toEqual([
      "Kitchen Sink",
      "Mail",
      "Dashboards with no bots",
      "On no dashboard",
    ]);
    // Kitchen Sink needs you (and is picked by default): open; the rest closed.
    expect(rows.map((r) => r[1])).toEqual(["true", "false", "false", "true"]);
    expect(rows[0][2]).toMatch(/1 bot · Kitchen Sink Lead/);
    expect(rows[0][2]).toMatch(/1 needs you/);
    expect(rows[1][2]).toMatch(/1 running/);
    // On no dashboard is open too (talked to directly).
    expect(botNames()).toEqual([
      "Kitchen Sink Lead",
      "Inbox Watch",
      "Loose Bot",
    ]);
    const needs = screen.getByTestId("bots-tree-needs");
    expect(needs).toHaveTextContent(/Inbox Watch wants to .* · Kitchen Sink/);
    // The team needing you is shown first.
    expect(screen.getByTestId("team-overview")).toHaveTextContent(
      "Bots on this team",
    );
  });

  it("a team row opens and closes, and picks the team", () => {
    setup();
    fireEvent.click(teamButton("Mail"));
    expect(teamButton("Mail")).toHaveAttribute("aria-expanded", "true");
    expect(botNames()).toContain("Digest");
    expect(within(detail()).getByText("Mail")).toBeInTheDocument();
    fireEvent.click(teamButton("Mail"));
    expect(teamButton("Mail")).toHaveAttribute("aria-expanded", "false");
  });

  it("dashboards with no bots, as one group (frame 26)", () => {
    setup();
    fireEvent.click(teamButton("Dashboards with no bots"));
    expect(botNames()).toEqual(expect.arrayContaining(["Calendar"]));
    const overview = screen.getByTestId("team-overview");
    expect(overview).toHaveTextContent("1 dashboard · each has a lead");
    expect(within(overview).getByText("Calendar")).toBeInTheDocument();
  });

  it("search opens only matching teams (frame 25)", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "digest" },
    });
    expect(teamRows().map((r) => [r[0], r[1]])).toEqual([["Mail", "true"]]);
    expect(botNames()).toEqual(["Digest"]);
    expect(screen.queryByTestId("bots-tree-needs")).toBeNull();
  });

  it("status: Needs you / Running / Paused", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Paused" }));
    expect(botNames()).toEqual(["Loose Bot"]);
    fireEvent.click(screen.getByRole("radio", { name: "Needs you" }));
    expect(botNames()).toEqual(["Inbox Watch"]);
  });

  it("turns automatic team leads on and off", async () => {
    const { botsApi } = setup();
    const box = await screen.findByLabelText("Create team leads automatically");
    expect(screen.getByTestId("auto-leads-setting")).toContainElement(box);
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(botsApi.setSettings).toHaveBeenCalledWith({ autoLeads: false });
  });
});

describe("BotsPage — a team's overview (frame 23)", () => {
  it("its bots with how they run, status and this month; Open conversation and Open dashboard", () => {
    const opened = jest.fn();
    window.addEventListener("dash:open-workspace", opened);
    const { onOpenWorkspace } = setup();
    const overview = screen.getByTestId("team-overview");
    expect(overview).toHaveTextContent("Kitchen Sink");
    expect(overview).toHaveTextContent("1 bot · lead: Kitchen Sink Lead");
    expect(overview).toHaveTextContent(
      /Inbox Watch.*On a schedule.*Needs approval.*\$1\.20/,
    );
    // What needs you: answered in the lead's conversation.
    expect(screen.getByTestId("team-needs")).toHaveTextContent(
      "Answer in the conversation",
    );
    fireEvent.click(
      within(overview).getByRole("button", { name: "Open conversation" }),
    );
    window.removeEventListener("dash:open-workspace", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({ key: "lead:lead7" });
    fireEvent.click(
      within(overview).getByRole("button", { name: "Open dashboard" }),
    );
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
    // A row opens that bot.
    fireEvent.click(
      within(overview).getByRole("button", { name: "Inbox Watch" }),
    );
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
  });

  it("Needs you on top opens that bot inside its team", () => {
    setup();
    fireEvent.click(teamButton("Kitchen Sink"));
    expect(teamButton("Kitchen Sink")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(
      within(screen.getByTestId("bots-tree-needs")).getByRole("button"),
    );
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
    expect(teamButton("Kitchen Sink")).toHaveAttribute("aria-expanded", "true");
  });
});

// The detail is the bot's page (NAV-016), management only — its header and
// tabs are tested in Bots/BotPage.test.js.
describe("BotsPage — a bot: management only (frames 14, 15, 24)", () => {
  it("opens the bot's page without its conversation", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
    expect(within(detail()).getByText("manage only")).toBeInTheDocument();
  });

  it("passes Open in Bots view through", () => {
    const { onOpenBotInBotsView } = setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-open-bots-view"));
    expect(onOpenBotInBotsView).toHaveBeenCalledWith({ id: 9 }, "b1");
  });

  it("a deleted bot leaves the detail", async () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-deleted"));
    await waitFor(() =>
      expect(within(detail()).queryByText("bot page b1")).toBeNull(),
    );
  });

  it("refreshes when the bot's page changes it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-changed"));
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe("BotsPage — unsaved changes on a bot's page (NAV-016 AC3)", () => {
  it("asks before another bot or team replaces it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.click(teamButton("Mail"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(
      within(modal).getByText("Discard unsaved changes?"),
    ).toBeInTheDocument();
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Discard"));
    expect(screen.getByTestId("team-overview")).toHaveTextContent("Mail");
  });

  it("asks before switching to Log", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-log-view")).toBeNull();
  });

  it("keeps showing the bot when a search would hide it", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "digest" },
    });
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
  });
});

describe("BotsPage — Spending and Log", () => {
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
    expect(screen.queryByRole("list", { name: "Teams and bots" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Bots" }));
    expect(list()).toBeInTheDocument();
  });

  it("Bots | Log shows every bot's log", async () => {
    setup();
    window.mainApi.bots.auditLog = jest
      .fn()
      .mockResolvedValue({ entries: [], more: false });
    fireEvent.click(screen.getByRole("radio", { name: "Log" }));
    expect(await screen.findByTestId("audit-log-view")).toBeInTheDocument();
  });
});

describe("BotsPage — the Dash team", () => {
  const dashTeam = [
    { id: "dt_l", name: "Dash Lead", role: "dashlead", system: "dash-team" },
    { id: "dt_p", name: "Planner", role: "planner", system: "dash-team" },
    { id: "dt_b", name: "Builder", role: "builder", system: "dash-team" },
  ];

  it("is listed first, led by the Dash Lead; a role opens management only", () => {
    mockDashTeam = dashTeam;
    setup();
    expect(teamRows()[0][0]).toBe("Dash team");
    expect(teamRows()[0][2]).toMatch(/2 bots · Dash Lead/);
    // Still opens on the team that needs you.
    expect(screen.getByTestId("team-overview")).toHaveTextContent(
      "Kitchen Sink",
    );
    fireEvent.click(teamButton("Dash team"));
    expect(botNames().slice(0, 3)).toEqual(["Dash Lead", "Planner", "Builder"]);
    fireEvent.click(within(list()).getByText("Planner"));
    expect(screen.getByTestId("dash-team-page-stub")).toHaveTextContent(
      "dash team planner activity manage",
    );
  });

  it("its overview opens the Dash Lead's conversation and the team's settings", () => {
    mockDashTeam = dashTeam;
    const opened = jest.fn();
    window.addEventListener("dash:open-workspace", opened);
    setup();
    fireEvent.click(teamButton("Dash team"));
    const overview = screen.getByTestId("team-overview");
    fireEvent.click(
      within(overview).getByRole("button", { name: "Open conversation" }),
    );
    window.removeEventListener("dash:open-workspace", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({ key: "role:dashlead" });
    fireEvent.click(
      within(overview).getByRole("button", { name: "Dash team settings" }),
    );
    expect(screen.getByTestId("dash-team-page-stub")).toHaveTextContent(
      // The team's Settings: no role picked, so the Dash team's header.
      "dash team null settings manage",
    );
  });

  it("unsaved role edits: picking another bot asks first", () => {
    mockDashTeam = dashTeam;
    setup();
    fireEvent.click(teamButton("Dash team"));
    fireEvent.click(within(list()).getByText("Planner"));
    fireEvent.click(screen.getByText("team-dirty"));
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    expect(screen.getByTestId("dash-team-page-stub")).toBeInTheDocument();
  });
});

describe("BotsPage — the pick goes away, and leaving unsaved edits from anywhere", () => {
  it("a picked bot that's gone (deleted elsewhere) falls back to the default", () => {
    const { rerender } = setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
    mockBots = MOCK_BOTS.filter((b) => b.id !== "b1");
    rerender(
      <AppContext.Provider value={{ providers: {} }}>
        <BotsPage
          workspaces={workspaces}
          dashApi={{ bots: window.mainApi.bots }}
        />
      </AppContext.Provider>,
    );
    expect(within(detail()).queryByText("bot page b1")).toBeNull();
    expect(screen.getByTestId("team-overview")).toBeInTheDocument();
  });

  it("asks first from Needs you and from a team's table", () => {
    setup();
    fireEvent.click(teamButton("Mail"));
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(screen.getByText("stub-dirty"));
    fireEvent.click(
      within(screen.getByTestId("bots-tree-needs")).getByRole("button"),
    );
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    expect(within(detail()).getByText("bot page b2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Discard"));
    expect(within(detail()).getByText("bot page b1")).toBeInTheDocument();
  });
});
