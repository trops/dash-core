/**
 * BotPage — everything about one bot in one place (app-navigation NAV-016):
 * header actions, the five tabs, approvals, unsaved-changes guard, delete.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";

let mockContacts;
jest.mock("./useBotContacts", () => ({
  useBotContacts: () => mockContacts,
}));
let mockChatProps;
jest.mock("./BotChat", () => ({
  BotChat: (props) => {
    mockChatProps = props;
    return (
      <div data-testid="chat-stub">
        chat with {props.bot.name} ({props.approvals.length} approvals)
      </div>
    );
  },
}));
let mockRunProps;
jest.mock("./BotRunHistory", () => ({
  BotRunHistory: (props) => {
    mockRunProps = props;
    return <div>runs of {props.bot.name}</div>;
  },
}));
jest.mock("./BotSpending", () => ({
  BotSpending: ({ bot }) => <div>spending of {bot.name}</div>,
}));
let mockLogProps;
jest.mock("../AppPages/AuditLogView", () => ({
  AuditLogView: (props) => {
    mockLogProps = props;
    return <div>log</div>;
  },
}));
let mockDetailProps;
jest.mock("../Settings/details/BotDetail", () => ({
  BotDetail: (props) => {
    mockDetailProps = props;
    return (
      <div>
        settings for {props.bot.name}
        <button onClick={() => props.onDirtyChange(true)}>make-dirty</button>
        <button onClick={props.onDelete}>settings-delete</button>
      </div>
    );
  },
}));
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn(() => null) },
}));

import { BotPage } from "./BotPage";

const workspaces = [{ id: 7, name: "Kitchen Sink" }];
const BOTS = [
  { id: "b1", name: "Inbox Watch", workspaceId: 7 },
  { id: "b2", name: "Loose Bot", workspaceId: null },
  { id: "lead7", name: "Kitchen Sink Lead", role: "lead", workspaceId: 7 },
];

function setup(props = {}, contacts = {}) {
  mockContacts = {
    loading: false,
    bots: BOTS,
    approvals: [],
    running: [],
    paused: new Set(),
    budgets: {},
    queued: {},
    lastRuns: {},
    approve: jest.fn(),
    stop: jest.fn(),
    setBotPaused: jest.fn().mockResolvedValue(undefined),
    keepRunning: jest.fn(),
    ...contacts,
  };
  const botsApi = {
    run: jest.fn().mockResolvedValue({ status: "completed" }),
    save: jest.fn().mockResolvedValue({ id: "b1" }),
    delete: jest.fn().mockResolvedValue(true),
  };
  window.mainApi = { bots: botsApi };
  const onOpenInBotsView = jest.fn();
  const onDeleted = jest.fn();
  const onClose = jest.fn();
  const page = (p) => (
    <AppContext.Provider value={{ providers: {} }}>
      <BotPage
        botId="b1"
        workspaces={workspaces}
        onOpenInBotsView={onOpenInBotsView}
        onDeleted={onDeleted}
        {...p}
      />
    </AppContext.Provider>
  );
  const { rerender } = render(page(props));
  rerenderPage = (p) => rerender(page(p));
  return { botsApi, onOpenInBotsView, onDeleted, onClose };
}
let rerenderPage;

const tab = (name) => fireEvent.click(screen.getByRole("radio", { name }));

afterEach(() => {
  delete window.mainApi;
});

describe("BotPage header", () => {
  it("shows the bot, its status and its dashboard; opens the conversation first", () => {
    setup();
    expect(screen.getByText("Inbox Watch")).toBeInTheDocument();
    expect(screen.getByTestId("bot-page-status")).toHaveTextContent(
      "Idle · Kitchen Sink",
    );
    expect(screen.getByTestId("chat-stub")).toHaveTextContent(
      "chat with Inbox Watch",
    );
  });

  it("Run now on a paused bot is a test run that offers Turn on", async () => {
    const { botsApi } = setup({}, { paused: new Set(["b1"]) });
    expect(screen.getByTestId("bot-page-status")).toHaveTextContent("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(botsApi.run).toHaveBeenCalledWith("b1");
    expect(await screen.findByTestId("bot-page-run-status")).toHaveTextContent(
      "It worked. Inbox Watch is still paused — turn it on?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(mockContacts.setBotPaused).toHaveBeenCalledWith("b1", false);
  });

  it("says why a run didn't happen", async () => {
    const { botsApi } = setup();
    botsApi.run.mockResolvedValue({ skipped: true, reason: "over budget" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByTestId("bot-page-run-status")).toHaveTextContent(
      "It didn't run: over budget.",
    );
  });

  it("Pause tells the host so its list updates", async () => {
    const onChanged = jest.fn();
    setup({ onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("Pause, and Stop while running", () => {
    setup({}, { running: [{ id: "b1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(mockContacts.setBotPaused).toHaveBeenCalledWith("b1", true);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mockContacts.stop).toHaveBeenCalledWith("b1");
  });

  it("a lead can't be run or paused directly", () => {
    setup({ botId: "lead7" });
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("Open in Bots view only for a bot on a dashboard", () => {
    const { onOpenInBotsView } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Open in Kitchen Sink's Bots view" }),
    );
    expect(onOpenInBotsView).toHaveBeenCalledWith(workspaces[0], "b1");
  });

  it("no Bots view button for an unassigned bot", () => {
    setup({ botId: "b2" });
    expect(screen.queryByRole("button", { name: /Bots view/ })).toBeNull();
  });

  it("a close button only in the modal", () => {
    const onClose = jest.fn();
    setup({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when the bot is gone", () => {
    setup({ botId: "nope" });
    expect(screen.getByTestId("bot-page-missing")).toHaveTextContent(
      "This bot no longer exists.",
    );
  });

  it("a gone bot can still be closed", () => {
    const onClose = jest.fn();
    setup({ botId: "nope", onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("deleted elsewhere mid-edit: tells the host nothing is unsaved", () => {
    const onDirtyChange = jest.fn();
    setup({ initialTab: "settings", onDirtyChange });
    fireEvent.click(screen.getByText("make-dirty"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    mockContacts = {
      ...mockContacts,
      bots: BOTS.filter((b) => b.id !== "b1"),
    };
    rerenderPage({ initialTab: "settings", onDirtyChange });
    expect(screen.getByTestId("bot-page-missing")).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("BotPage in a dashboard's Bots view (NAV-016 AC6)", () => {
  it("says where an installed bot came from", () => {
    setup(
      {},
      {
        bots: [
          {
            ...BOTS[0],
            installedFrom: { package: "trops/inbox", version: "1.0.0" },
          },
        ],
      },
    );
    expect(screen.getByTestId("bot-page-status")).toHaveTextContent(
      "Idle · Kitchen Sink · From trops/inbox v1.0.0",
    );
  });

  it("shows the host's actions and what goes under the header", () => {
    setup({
      actions: <button>host-action</button>,
      below: <div>host-row</div>,
    });
    expect(screen.getByText("host-action")).toBeInTheDocument();
    expect(screen.getByText("host-row")).toBeInTheDocument();
  });

  it("tells the host which tab is showing", () => {
    const onTabChange = jest.fn();
    setup({ onTabChange });
    tab("Settings");
    expect(onTabChange).toHaveBeenLastCalledWith("settings");
  });

  it("an error's next step opens the app's settings, not the bot's", () => {
    const onOpenSettings = jest.fn();
    setup({ onOpenSettings });
    expect(mockChatProps.onOpenSettings).toBe(onOpenSettings);
    tab("Activity");
    expect(mockRunProps.onOpenSettings).toBe(onOpenSettings);
  });

  it("saving tells the host (its list refreshes)", async () => {
    const onChanged = jest.fn();
    setup({ initialTab: "settings", onChanged });
    await act(async () => {
      await mockDetailProps.onSave({ id: "b1", name: "Inbox Watch" });
    });
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("BotPage tabs", () => {
  it("Activity, Log, Spending and Settings each show this bot", () => {
    setup();
    tab("Activity");
    expect(screen.getByText("runs of Inbox Watch")).toBeInTheDocument();
    tab("Log");
    expect(mockLogProps.botIds).toEqual(["b1"]);
    expect(mockLogProps.hideBotFilter).toBe(true);
    tab("Spending");
    expect(screen.getByText("spending of Inbox Watch")).toBeInTheDocument();
    tab("Settings");
    expect(screen.getByText("settings for Inbox Watch")).toBeInTheDocument();
    // The budget lives on Spending, not twice.
    expect(mockDetailProps.showBudget).toBe(false);
  });

  it("opens on the tab asked for", () => {
    setup({ initialTab: "settings" });
    expect(screen.getByText("settings for Inbox Watch")).toBeInTheDocument();
  });

  it("waiting approvals show above every tab but the conversation", () => {
    const approval = {
      id: "a1",
      request: { botId: "b1", toolName: "send_email", serverName: "Gmail" },
    };
    setup({}, { approvals: [approval] });
    expect(screen.getByTestId("chat-stub")).toHaveTextContent("1 approvals");
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    tab("Activity");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(mockContacts.approve).toHaveBeenCalledWith("a1", { allow: true });
  });
});

describe("BotPage settings", () => {
  it("asks before leaving unsaved changes", () => {
    setup({ initialTab: "settings" });
    fireEvent.click(screen.getByText("make-dirty"));
    tab("Activity");
    const modal = screen.getByTestId("confirmation-modal");
    expect(
      within(modal).getByText("Discard unsaved changes?"),
    ).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Discard"));
    expect(screen.getByText("runs of Inbox Watch")).toBeInTheDocument();
  });

  it("tells the host when Settings has unsaved changes", () => {
    const onDirtyChange = jest.fn();
    setup({ initialTab: "settings", onDirtyChange });
    fireEvent.click(screen.getByText("make-dirty"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("a failed delete says so and keeps the bot", async () => {
    const { botsApi, onDeleted } = setup({ initialTab: "settings" });
    botsApi.delete.mockRejectedValue(new Error("its folder is in use"));
    fireEvent.click(screen.getByText("settings-delete"));
    fireEvent.click(
      within(screen.getByTestId("confirmation-modal")).getByText("Delete"),
    );
    expect(await screen.findByTestId("bot-page-run-status")).toHaveTextContent(
      "Couldn't delete Inbox Watch: its folder is in use.",
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("delete asks first, then removes the bot", async () => {
    const { botsApi, onDeleted } = setup({ initialTab: "settings" });
    fireEvent.click(screen.getByText("settings-delete"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(within(modal).getByText("Delete bot?")).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Delete"));
    await waitFor(() => expect(botsApi.delete).toHaveBeenCalledWith("b1"));
    expect(onDeleted).toHaveBeenCalledWith("b1");
  });
});
