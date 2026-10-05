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
    refresh: jest.fn(),
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
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(botsApi.setSettings).toHaveBeenCalledWith({ autoLeads: false });
  });
});

describe("BotsPage detail (NAV-006 AC2)", () => {
  it("shows the selected bot: handle, team, providers + tools, last run", async () => {
    const { botsApi } = setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    const d = detail();
    expect(within(d).getByText("Inbox Watch")).toBeInTheDocument();
    expect(within(d).getByText("local/inbox-watch")).toBeInTheDocument();
    expect(within(d).getByText("Kitchen Sink")).toBeInTheDocument();
    expect(within(d).getByText("Gmail 3")).toBeInTheDocument();
    expect(within(d).getByText("search_emails")).toBeInTheDocument();
    expect(botsApi.getRuns).toHaveBeenCalledWith("b1", 1);
    expect(await within(d).findByText(/Sent 3 emails/)).toBeInTheDocument();
  });

  it("labels a stopped last run as Stopped", async () => {
    const { botsApi } = setup();
    botsApi.getRuns.mockResolvedValue([
      { status: "stopped", endedAt: "2026-10-05T09:00:00Z", output: "" },
    ]);
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    expect(await within(detail()).findByText(/^Stopped ·/)).toBeInTheDocument();
  });

  it("a lead uses team tools only and can't be run directly", () => {
    setup();
    fireEvent.click(within(list()).getByText("Kitchen Sink Lead"));
    expect(within(detail()).getByText("Team tools only")).toBeInTheDocument();
    expect(
      within(detail()).queryByRole("button", { name: "Run now" }),
    ).toBeNull();
  });

  it("allows or denies a waiting approval inline", () => {
    setup();
    fireEvent.click(within(list()).getByText("Inbox Watch"));
    expect(
      within(detail()).getByText("Wants to use send_email on Gmail 3."),
    ).toBeInTheDocument();
    fireEvent.click(within(detail()).getByRole("button", { name: "Allow" }));
    expect(mockApprove).toHaveBeenCalledWith("a1", { allow: true });
    fireEvent.click(within(detail()).getByRole("button", { name: "Deny" }));
    expect(mockApprove).toHaveBeenCalledWith("a1", { allow: false });
  });

  it("runs a bot now", () => {
    const { botsApi } = setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Run now" }));
    expect(botsApi.run).toHaveBeenCalledWith("b2");
  });

  it("opens the bot in its team's Bots view (not for Unassigned)", () => {
    const { onOpenBotInBotsView } = setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(
      within(detail()).getByRole("button", {
        name: "Open in Mail's Bots view",
      }),
    );
    expect(onOpenBotInBotsView).toHaveBeenCalledWith(workspaces[1], "b2");
    fireEvent.click(within(list()).getByText("Loose Bot"));
    expect(
      within(detail()).queryByRole("button", { name: /Bots view/ }),
    ).toBeNull();
  });
});

describe("BotsPage edit / create / delete (NAV-006 AC3)", () => {
  it("Edit shows the bot editor in the detail panel; Cancel goes back", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("editing Digest")).toBeInTheDocument();
    fireEvent.click(screen.getByText("editor-cancel"));
    expect(screen.queryByTestId("bot-editor")).toBeNull();
  });

  it("Back to details leaves the editor (BotDetail has no Cancel when editing)", () => {
    setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    expect(screen.queryByTestId("bot-editor")).toBeNull();
    expect(within(detail()).getByText("local/digest")).toBeInTheDocument();
  });

  it("the header's New Bot opens a blank editor and saving selects the new bot", async () => {
    const onCreateAcknowledged = jest.fn();
    const { botsApi } = setup({ createRequested: true, onCreateAcknowledged });
    expect(screen.getByText("creating")).toBeInTheDocument();
    expect(onCreateAcknowledged).toHaveBeenCalled();
    fireEvent.click(screen.getByText("editor-save"));
    await waitFor(() =>
      expect(botsApi.save).toHaveBeenCalledWith({ name: "Saved" }),
    );
    await waitFor(() => expect(screen.queryByTestId("bot-editor")).toBeNull());
  });

  it("delete asks first, then removes the bot", async () => {
    const { botsApi } = setup();
    fireEvent.click(within(list()).getByText("Digest"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("editor-delete"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(within(modal).getByText("Delete bot?")).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Delete"));
    await waitFor(() => expect(botsApi.delete).toHaveBeenCalledWith("b2"));
  });
});
