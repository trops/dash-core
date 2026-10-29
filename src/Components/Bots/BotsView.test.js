import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { BotsView } from "./BotsView";
import { AppContext } from "../../Context/App/AppContext";

const mockEnsureAuthed = jest.fn().mockResolvedValue(true);
jest.mock("../../hooks/useRegistryAuthGate", () => ({
  useRegistryAuthGate: () => ({
    ensureAuthed: mockEnsureAuthed,
    authGate: null,
  }),
}));

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

// The bot page has its own tests (BotPage.test.js); here, what the view
// hands it. Its tab buttons stand in for its tabs.
let mockPageProps;
jest.mock("./BotPage", () => ({
  BotPage: (props) => {
    mockPageProps = props;
    return (
      <div data-testid="bot-page">
        <span data-testid="bot-page-shows">
          {props.botId} on {props.initialTab}
        </span>
        {["conversation", "activity", "settings"].map((t) => (
          <button key={t} onClick={() => props.onTabChange(t)}>
            page-tab-{t}
          </button>
        ))}
        <button onClick={() => props.onDirtyChange(true)}>page-dirty</button>
        {props.onClose ? (
          <button onClick={props.onClose}>page-close</button>
        ) : null}
        {props.onOpenSettings ? (
          <button onClick={() => props.onOpenSettings("providers")}>
            page-open-providers
          </button>
        ) : null}
        {props.actions}
        {props.below}
      </div>
    );
  },
}));
const pageShows = () => screen.getByTestId("bot-page-shows").textContent;

const workspace = { id: 7, name: "Kitchen Sink", layout: [] };
const lead = {
  id: "lead_7",
  name: "Kitchen Lead",
  role: "lead",
  workspaceId: "7",
};
const inbox = {
  id: "b1",
  name: "Inbox Watch",
  instructions: "Watch my inbox",
  workspaceId: "7",
  mcpServers: ["Gmail New"],
  schedules: [{ cron: "0 9 * * *" }],
};
const crm = {
  id: "b2",
  name: "CRM Sync",
  instructions: "Sync",
  workspaceId: "7",
};

function makeTeam(over = {}) {
  const statuses = { lead_7: "Idle", b1: "Running", b2: "Failed" };
  return {
    loading: false,
    lead,
    members: [inbox, crm],
    bots: [lead, inbox, crm],
    statusOf: (id) => statuses[id] || "Idle",
    approvalsFor: () => [],
    approve: jest.fn(),
    refresh: jest.fn(),
    attention: 1,
    ...over,
  };
}

// Most tests cover the List view (TEAM-011); TEAM-014's diagram is the
// default and has its own tests below (mode: null = nothing remembered).
function setup({
  team = makeTeam(),
  narrow = false,
  apiOver = {},
  mode = "list",
} = {}) {
  window.localStorage.clear();
  if (mode) window.localStorage.setItem("dash:botsView:mode", mode);
  const api = {
    getRuns: jest.fn().mockResolvedValue([]),
    run: jest.fn().mockResolvedValue({ status: "completed" }),
    askLead: jest.fn().mockResolvedValue({ status: "completed" }),
    onStream: jest.fn(() => "s1"),
    removeListener: jest.fn(),
    list: jest.fn().mockResolvedValue([lead, inbox, crm]),
    listToolSources: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({ id: "b9" }),
    pauseBot: jest.fn().mockResolvedValue({}),
    resumeBot: jest.fn().mockResolvedValue({}),
    ...apiOver,
  };
  window.mainApi = { bots: api };
  render(
    <AppContext.Provider value={{ providers: {} }}>
      <BotsView
        workspace={workspace}
        workspaces={[workspace]}
        team={team}
        narrow={narrow}
      />
    </AppContext.Provider>,
  );
  return { api, team };
}

afterEach(() => {
  delete window.mainApi;
  window.localStorage.clear();
});

const teamList = () => screen.getByRole("navigation", { name: "Team" });

describe("BotsView — team diagram (TEAM-014 slice 1)", () => {
  it("opens on the diagram by default, with the lead's summary beside it", () => {
    setup({ mode: null });
    expect(screen.getByTestId("diagram-card-lead_7")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-card-b1")).toBeInTheDocument();
    const side = screen.getByRole("complementary", { name: "Selected bot" });
    expect(within(side).getByText("Kitchen Lead")).toBeInTheDocument();
    expect(
      within(side).getByRole("button", { name: "Ask the lead" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("clicking a bot opens its conversation beside the diagram; × goes back to its summary", () => {
    setup({ mode: null });
    fireEvent.click(screen.getByRole("button", { name: "Inbox Watch" }));
    // The bot page, on its conversation (QA 2026-10-28); the diagram stays.
    expect(pageShows()).toBe("b1 on activity");
    expect(screen.getByTestId("diagram-card-b1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("page-close"));
    expect(screen.queryByTestId("bot-page")).toBeNull();
    const side = screen.getByRole("complementary", { name: "Selected bot" });
    expect(within(side).getByText("Inbox Watch")).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: "Activity" }));
    expect(pageShows()).toBe("b1 on activity");
  });

  it("the summary's Run now runs it and opens its Activity", () => {
    const { api } = setup({ mode: null });
    fireEvent.click(screen.getByRole("button", { name: "Inbox Watch" }));
    fireEvent.click(screen.getByText("page-close"));
    fireEvent.click(
      within(
        screen.getByRole("complementary", { name: "Selected bot" }),
      ).getByRole("button", { name: "Run now" }),
    );
    expect(api.run).toHaveBeenCalledWith("b1", "", false);
    expect(pageShows()).toBe("b1 on activity");
  });

  it("a just-created bot shows Loading, not the empty form, until the team has it", async () => {
    const { api } = setup();
    fireEvent.click(screen.getByText("Add bot"));
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Fresh" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Do it." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(await screen.findByTestId("bots-view-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });

  it("a card's Settings icon opens that bot's Settings", () => {
    setup({ mode: null });
    fireEvent.mouseEnter(screen.getByTestId("diagram-card-b2"));
    fireEvent.click(
      screen.getByRole("button", { name: "Settings — CRM Sync" }),
    );
    expect(pageShows()).toBe("b2 on settings");
  });

  it("the same bot on another tab reopens the page on it", () => {
    setup({ mode: null });
    fireEvent.mouseEnter(screen.getByTestId("diagram-card-b2"));
    fireEvent.click(
      screen.getByRole("button", { name: "Settings — CRM Sync" }),
    );
    fireEvent.click(screen.getByText("page-close"));
    fireEvent.click(
      within(
        screen.getByRole("complementary", { name: "Selected bot" }),
      ).getByRole("button", { name: "Activity" }),
    );
    expect(pageShows()).toBe("b2 on activity");
  });

  describe("the bot panel beside the diagram is resizable", () => {
    // The view's content box: 1200px wide → 1184px after the 16px gap,
    // so the panel starts at half (592px) and the diagram keeps ≥ 320px.
    let RealRO;
    beforeEach(() => {
      RealRO = global.ResizeObserver;
      global.ResizeObserver = class {
        constructor(cb) {
          this.cb = cb;
        }
        observe() {
          this.cb([{ contentRect: { width: 1200 } }]);
        }
        disconnect() {}
      };
    });
    afterEach(() => {
      global.ResizeObserver = RealRO;
    });

    const openActivity = () => {
      fireEvent.click(screen.getByRole("button", { name: "Inbox Watch" }));
      fireEvent.click(screen.getByText("page-tab-activity"));
    };
    const panel = () => screen.getByRole("region", { name: "Selected bot" });
    const handle = () =>
      screen.getByRole("separator", { name: "Resize bot panel" });

    it("has a handle; the panel starts at half and steps with the arrow keys", () => {
      setup({ mode: null });
      openActivity();
      expect(panel().style.width).toBe("592px");
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      expect(panel().style.width).toBe("608px");
    });

    it("the width is remembered; double-click goes back to half", () => {
      setup({ mode: null });
      openActivity();
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      expect(window.localStorage.getItem("dash:botsView:panelWidth")).toBe(
        "608",
      );
      fireEvent.doubleClick(handle());
      expect(panel().style.width).toBe("592px");
      expect(
        window.localStorage.getItem("dash:botsView:panelWidth"),
      ).toBeNull();
    });

    it("keeps the diagram at least 320px and the panel at least 360px", () => {
      setup({ mode: null });
      openActivity();
      for (let i = 0; i < 60; i++) {
        fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      }
      expect(panel().style.width).toBe("864px"); // 1184 − 320
      for (let i = 0; i < 60; i++) {
        fireEvent.keyDown(handle(), { key: "ArrowRight" });
      }
      expect(panel().style.width).toBe("360px");
    });

    it("no handle in the List view", () => {
      setup({ mode: "list" });
      expect(
        screen.queryByRole("separator", { name: "Resize bot panel" }),
      ).toBeNull();
    });
  });

  it("+ Add bot opens the new-bot form beside the diagram", () => {
    setup({ mode: null });
    fireEvent.click(screen.getByRole("button", { name: "Add bot" }));
    expect(screen.getByRole("tab", { name: "New bot" })).toBeInTheDocument();
    expect(screen.getByTestId("diagram-card-lead_7")).toBeInTheDocument();
  });

  it("List switches to the list (with avatars) and is remembered", () => {
    setup({ mode: null });
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(within(teamList()).getAllByTestId("bot-avatar")).toHaveLength(3);
    expect(window.localStorage.getItem("dash:botsView:mode")).toBe("list");
  });

  it("dragging one bot onto another saves a trigger on the second (with the note)", async () => {
    // The saved bot is newer than the view's copy (a trigger added elsewhere).
    const get = jest.fn().mockResolvedValue({
      ...crm,
      provider: "claude-code",
      subscriptions: [{ eventType: "Notepad[1].saved" }],
    });
    const { api } = setup({ mode: null, apiOver: { get } });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Drag to wire Inbox Watch" }),
    );
    fireEvent.pointerUp(screen.getByTestId("diagram-card-b2"));
    const dialog = screen.getByRole("dialog", { name: "Trigger for CRM Sync" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Sync what it found." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add trigger" }),
    );
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const saved = api.save.mock.calls[0][0];
    expect(saved.id).toBe("b2");
    // Only the triggers are sent, built on the latest saved copy.
    expect(get).toHaveBeenCalledWith("b2");
    expect(Object.keys(saved).sort()).toEqual(["id", "subscriptions"]);
    expect(saved.subscriptions).toEqual([
      { eventType: "Notepad[1].saved" },
      expect.objectContaining({
        eventType: "bot:local/inbox-watch[b1].completed",
        note: "Sync what it found.",
        source: expect.objectContaining({ kind: "bot", instanceId: "b1" }),
      }),
    ]);
  });

  it("wiring is off while a bot's Settings is open", () => {
    setup({ mode: null });
    fireEvent.mouseEnter(screen.getByTestId("diagram-card-b2"));
    fireEvent.click(
      screen.getByRole("button", { name: "Settings — CRM Sync" }),
    );
    expect(
      screen.queryByRole("button", { name: "Drag to wire Inbox Watch" }),
    ).toBeNull();
  });

  it("narrow windows keep the bot picker (no diagram)", () => {
    setup({ mode: null, narrow: true });
    expect(screen.queryByTestId("diagram-card-lead_7")).toBeNull();
  });
});

describe("BotsView — team list", () => {
  it("lists the lead first, then members, with status labels", () => {
    setup();
    const items = within(teamList()).getAllByRole("button", {
      name: /Lead|Watch|Sync/,
    });
    expect(items[0]).toHaveTextContent("Kitchen Lead");
    expect(items[0]).toHaveTextContent("Lead");
    expect(within(teamList()).getByText("Inbox Watch")).toBeInTheDocument();
    expect(within(teamList()).getByLabelText("Running")).toBeInTheDocument();
    expect(within(teamList()).getByLabelText("Failed")).toBeInTheDocument();
  });

  it("opens on the lead's bot page, with Turn off lead — no Drafts (2c-2)", () => {
    setup();
    expect(pageShows()).toBe("lead_7 on activity");
    expect(mockPageProps.chatProps).toBeUndefined();
    expect(screen.queryByText("Drafts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByText("Turn off lead")).toBeInTheDocument();
    expect(screen.queryByText("Publish bot…")).toBeNull();
  });
  it("selecting a member shows its bot page, with this team's actions", () => {
    setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    expect(pageShows()).toBe("b1 on activity");
    expect(mockPageProps.workspaces).toEqual([workspace]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    for (const a of [
      "Show on dashboard",
      "Publish bot…",
      "Remove from team",
      "Delete",
    ]) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });
});

describe("BotsView — tabs and actions", () => {
  it("a change on the page refreshes the team", () => {
    const { team } = setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    mockPageProps.onChanged();
    expect(team.refresh).toHaveBeenCalled();
  });

  it("+ Add bot opens a new bot's form on this team", () => {
    setup();
    fireEvent.click(screen.getByText("Add bot"));
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toHaveValue("7");
  });

  it("a deleted bot refreshes the team (the lead is shown again)", () => {
    const { team } = setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    mockPageProps.onDeleted("b1");
    expect(team.refresh).toHaveBeenCalled();
  });
});

describe("BotsView — unsaved changes", () => {
  it("asks before leaving a bot page with unsaved changes", () => {
    setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("page-dirty"));
    fireEvent.click(within(teamList()).getByText("CRM Sync"));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep editing"));
    expect(pageShows()).toBe("b1 on activity");
    fireEvent.click(within(teamList()).getByText("CRM Sync"));
    fireEvent.click(screen.getByText("Discard"));
    expect(pageShows()).toBe("b2 on activity");
  });

  it("the page's tab is the view's: wiring is off on Settings", () => {
    setup({ mode: null });
    fireEvent.click(screen.getByRole("button", { name: "Inbox Watch" }));
    expect(
      screen.getByRole("button", { name: "Drag to wire Inbox Watch" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("page-tab-settings"));
    expect(
      screen.queryByRole("button", { name: "Drag to wire Inbox Watch" }),
    ).toBeNull();
  });
});

describe("BotsView — narrow windows", () => {
  it("collapses the team list into a bot picker", () => {
    setup({ narrow: true });
    expect(screen.queryByRole("navigation", { name: "Team" })).toBeNull();
    const picker = screen.getByLabelText("Bot");
    fireEvent.change(picker, { target: { value: "b2" } });
    expect(pageShows()).toBe("b2 on activity");
    // No summary to go back to: the page has no ×.
    expect(screen.queryByText("page-close")).toBeNull();
  });
});

describe("BotsView — approvals", () => {});

describe("BotsView — focus requests (B3 monitor)", () => {
  function renderWithFocus(focus) {
    setup();
    // setup() rendered once without focus; render a fresh tree with it.
    document.body.innerHTML = "";
    const team = makeTeam();
    const ui = (f) => (
      <AppContext.Provider value={{ providers: {} }}>
        <BotsView
          workspace={workspace}
          workspaces={[workspace]}
          team={team}
          narrow={false}
          focus={f}
        />
      </AppContext.Provider>
    );
    const utils = render(ui(focus));
    return { ...utils, rerender: (f) => utils.rerender(ui(f)) };
  }

  it("opens on the requested bot and tab", async () => {
    renderWithFocus({ botId: "b1", tab: "activity", seq: 1 });
    expect(pageShows()).toBe("b1 on activity");
  });

  it("opens on the page's own tabs too (Log, Spending)", () => {
    renderWithFocus({ botId: "b1", tab: "spending", seq: 1 });
    expect(pageShows()).toBe("b1 on spending");
  });
  it("a later request re-selects, even the same bot on another tab", () => {
    const { rerender } = renderWithFocus({
      botId: "b1",
      tab: "conversation",
      seq: 1,
    });
    rerender({ botId: "b2", tab: "conversation", seq: 2 });
    expect(pageShows()).toBe("b2 on activity");
    rerender({ botId: "b2", tab: "activity", seq: 3 });
    expect(pageShows()).toBe("b2 on activity");
  });
  it("asks first when Settings has unsaved changes", () => {
    const { rerender } = renderWithFocus({
      botId: "b1",
      tab: "settings",
      seq: 1,
    });
    fireEvent.click(screen.getByText("page-dirty"));
    rerender({ botId: "b2", tab: "conversation", seq: 2 });
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Discard"));
    expect(pageShows()).toBe("b2 on activity");
  });
  it("applies once the team loads (team arrives after mount)", () => {
    setup();
    document.body.innerHTML = "";
    const empty = makeTeam({ lead: null, members: [], bots: [] });
    const full = makeTeam();
    const ui = (team) => (
      <AppContext.Provider value={{ providers: {} }}>
        <BotsView
          workspace={workspace}
          workspaces={[workspace]}
          team={team}
          narrow={false}
          focus={{ botId: "b2", tab: "activity", seq: 1 }}
        />
      </AppContext.Provider>
    );
    const { rerender } = render(ui(empty));
    rerender(ui(full));
    expect(pageShows()).toBe("b2 on activity");
  });
  it("an unknown bot is ignored", () => {
    renderWithFocus({ botId: "nope", tab: "activity", seq: 1 });
    expect(pageShows()).toBe("lead_7 on activity");
  });
});

describe("BotsView — discard, dirty state, settings hand-off (TEAM-011 gaps)", () => {
  function renderView(props = {}, runsFor = () => []) {
    setup();
    document.body.innerHTML = "";
    window.mainApi.bots.getRuns = jest.fn(async (id) => runsFor(id));
    return render(
      <AppContext.Provider value={{ providers: {} }}>
        <BotsView
          workspace={workspace}
          workspaces={[workspace]}
          team={makeTeam()}
          narrow={false}
          {...props}
        />
      </AppContext.Provider>,
    );
  }

  it("the page's unsaved edits are reported to the host", () => {
    const onDirtyChange = jest.fn();
    renderView({ onDirtyChange });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("page-dirty"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("a provider error on the page opens Settings › Providers", () => {
    const onOpenSettings = jest.fn();
    renderView({ onOpenSettings });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("page-open-providers"));
    expect(onOpenSettings).toHaveBeenCalledWith("providers");
  });
});

describe("BotsView — bots changed elsewhere (TEAM-011 refresh)", () => {
  it("re-loads its all-bots list (names, event sources)", async () => {
    let changed = null;
    setup();
    window.mainApi.bots.onListChanged = jest.fn((cb) => ((changed = cb), "lc"));
    document.body.innerHTML = "";
    const { unmount } = render(
      <AppContext.Provider value={{ providers: {} }}>
        <BotsView
          workspace={workspace}
          workspaces={[workspace]}
          team={makeTeam()}
          narrow={false}
        />
      </AppContext.Provider>,
    );
    const calls = window.mainApi.bots.list.mock.calls.length;
    await act(async () => {
      changed({});
    });
    expect(window.mainApi.bots.list.mock.calls.length).toBe(calls + 1);
    unmount();
    expect(window.mainApi.bots.removeListener).toHaveBeenCalledWith("lc");
  });
});

describe("BotsView — team export/import (TEAM-006/007 slice 1)", () => {
  const preview = {
    fileName: "Daily Brief.team.json",
    manifest: {
      name: "Daily Brief",
      description: "",
      members: [
        {
          role: "agenda",
          embedded: {
            type: "bot",
            name: "Agenda",
            instructions: "Read the calendar.",
            modelSource: "claude-code",
            approvalPolicy: "ask",
            schedules: [],
            providers: [],
          },
        },
      ],
      wiring: [],
    },
    plan: { members: [{ role: "agenda", needs: [] }], wiring: [] },
  };

  it("exports the team and says what was saved and left out", async () => {
    const exportTeam = jest.fn().mockResolvedValue({
      saved: true,
      filePath: "/x/Kitchen Sink.team.json",
      members: 2,
      notIncluded: [
        'CRM Sync: the trigger "Inbox › newMail" (a widget on this dashboard)',
      ],
    });
    setup({ apiOver: { exportTeam } });
    fireEvent.click(within(teamList()).getByText("Export team"));
    await waitFor(() =>
      expect(exportTeam).toHaveBeenCalledWith(7, { name: "Kitchen Sink" }),
    );
    expect(
      await screen.findByText("Saved Kitchen Sink.team.json (2 bots)."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not included:/)).toBeInTheDocument();
    expect(screen.getByText(/CRM Sync: the trigger/)).toBeInTheDocument();
  });

  it("imports: review first, then installs paused bots and refreshes the team", async () => {
    const previewTeamImport = jest.fn().mockResolvedValue(preview);
    const installTeam = jest.fn().mockResolvedValue({
      installed: [{ role: "agenda", id: "bot_n1", name: "Agenda" }],
    });
    const { team } = setup({ apiOver: { previewTeamImport, installTeam } });
    fireEvent.click(within(teamList()).getByText("Import team"));
    expect(
      await screen.findByText("Import team: Daily Brief"),
    ).toBeInTheDocument();
    expect(previewTeamImport).toHaveBeenCalledWith(7);
    expect(installTeam).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Install team"));
    await waitFor(() =>
      expect(installTeam).toHaveBeenCalledWith(7, preview.manifest, {}, null),
    );
    expect(
      await screen.findByText(
        "Added 1 paused bot from Daily Brief. Turn it on when you're ready.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import team: Daily Brief")).toBeNull();
    expect(team.refresh).toHaveBeenCalled();
  });

  it("shows why a file couldn't be imported, and does nothing on cancel", async () => {
    const previewTeamImport = jest
      .fn()
      .mockResolvedValueOnce({
        error: "That isn't a Dash team file.",
        errors: ['type must be "bot-team"'],
      })
      .mockResolvedValueOnce({ canceled: true });
    setup({ apiOver: { previewTeamImport } });
    fireEvent.click(within(teamList()).getByText("Import team"));
    expect(
      await screen.findByText(
        /That isn't a Dash team file. type must be "bot-team"/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(teamList()).getByText("Import team"));
    await waitFor(() => expect(previewTeamImport).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Import team:/)).toBeNull();
  });
});

describe("BotsView — publish to the registry (TEAM-006 slice 3a)", () => {
  const preview = (kind) => ({
    kind,
    signedIn: true,
    username: "trops",
    notIncluded: [],
    last: null,
    suggested: {
      displayName: kind === "team" ? "Kitchen Sink" : "Inbox Watch",
      name: kind === "team" ? "kitchen-sink" : "inbox-watch",
      version: "1.0.0",
      description: "",
      visibility: "private",
    },
    pkg:
      kind === "team"
        ? {
            type: "bot-team",
            members: [
              {
                role: "inbox-watch",
                embedded: {
                  name: "Inbox Watch",
                  instructions: "Watch my inbox",
                  providers: [],
                },
              },
            ],
            wiring: [],
          }
        : {
            type: "bot",
            bot: {
              name: "Inbox Watch",
              instructions: "Watch my inbox",
              providers: [],
            },
          },
  });

  it("publishes the team after a sign-in check, private by default", async () => {
    const previewPublish = jest.fn().mockResolvedValue(preview("team"));
    const publish = jest.fn().mockResolvedValue({
      success: true,
      package: "trops/kitchen-sink",
      version: "1.0.0",
      visibility: "private",
    });
    setup({ apiOver: { previewPublish, publish } });
    fireEvent.click(within(teamList()).getByText("Publish team…"));
    expect(
      await screen.findByText("Publish team to the registry"),
    ).toBeInTheDocument();
    expect(mockEnsureAuthed).toHaveBeenCalled();
    expect(previewPublish).toHaveBeenCalledWith({
      kind: "team",
      workspaceId: 7,
      name: "Kitchen Sink",
    });
    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith({
        kind: "team",
        workspaceId: 7,
        name: "Kitchen Sink",
        meta: expect.objectContaining({
          name: "kitchen-sink",
          visibility: "private",
        }),
      }),
    );
    expect(
      await screen.findByText("Published trops/kitchen-sink v1.0.0 (private)."),
    ).toBeInTheDocument();
  });

  it("publishes one bot from its … menu (never offered for the lead)", async () => {
    const previewPublish = jest.fn().mockResolvedValue(preview("bot"));
    setup({ apiOver: { previewPublish, publish: jest.fn() } });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByText("Publish bot…"));
    expect(
      await screen.findByText("Publish bot to the registry"),
    ).toBeInTheDocument();
    expect(previewPublish).toHaveBeenCalledWith({
      kind: "bot",
      workspaceId: 7,
      botId: "b1",
      name: "Kitchen Sink",
    });
  });

  it("does nothing when the user cancels sign-in", async () => {
    mockEnsureAuthed.mockResolvedValueOnce(false);
    const previewPublish = jest.fn();
    setup({ apiOver: { previewPublish } });
    fireEvent.click(within(teamList()).getByText("Publish team…"));
    await waitFor(() => expect(mockEnsureAuthed).toHaveBeenCalled());
    expect(previewPublish).not.toHaveBeenCalled();
  });

  it("shows the registry's error in the dialog", async () => {
    const previewPublish = jest.fn().mockResolvedValue(preview("team"));
    const publish = jest.fn().mockResolvedValue({
      success: false,
      error: "Version 1.0.0 already exists",
    });
    setup({ apiOver: { previewPublish, publish } });
    fireEvent.click(within(teamList()).getByText("Publish team…"));
    fireEvent.click(await screen.findByText("Publish"));
    expect(
      await screen.findByText("Version 1.0.0 already exists"),
    ).toBeInTheDocument();
  });
});

describe("BotsView — install from the registry (TEAM-007 slice 3b)", () => {
  const regPreview = {
    previewId: "rp_1",
    kind: "team",
    source: {
      package: "trops/daily-brief-test",
      version: "1.0.0",
      author: "trops",
    },
    manifest: {
      name: "Daily Brief (test)",
      description: "",
      members: [
        {
          role: "agenda",
          embedded: {
            type: "bot",
            name: "Agenda",
            instructions: "Calendar.",
            modelSource: "claude-code",
            approvalPolicy: "ask",
            schedules: [],
            providers: [],
          },
        },
        {
          role: "inbox",
          embedded: {
            type: "bot",
            name: "Inbox",
            instructions: "Mail.",
            modelSource: "claude-code",
            approvalPolicy: "ask",
            schedules: [],
            providers: [],
          },
        },
      ],
      wiring: [{ role: "inbox", on: { role: "agenda", event: "completed" } }],
    },
    plan: {
      members: [
        { role: "agenda", needs: [] },
        { role: "inbox", needs: [] },
      ],
      wiring: [{ role: "inbox", on: { role: "agenda", event: "completed" } }],
    },
  };
  const searchRegistry = () =>
    jest.fn().mockResolvedValue([
      {
        ref: "trops/daily-brief-test",
        displayName: "Daily Brief (test)",
        author: "trops",
        type: "bot-team",
        version: "1.0.0",
        providerTypes: [],
        team: {
          members: [
            { role: "agenda", name: "Agenda" },
            { role: "inbox", name: "Inbox" },
          ],
        },
      },
    ]);

  it("finds a team, reviews it, and installs just the ticked bots from the checked copy", async () => {
    const previewRegistryInstall = jest.fn().mockResolvedValue(regPreview);
    const installFromRegistry = jest.fn().mockResolvedValue({
      installed: [{ role: "inbox", id: "bot_n2", name: "Inbox" }],
      droppedWiring: [
        { role: "inbox", on: { role: "agenda", event: "completed" } },
      ],
    });
    const installTeam = jest.fn();
    const { team } = setup({
      apiOver: {
        searchRegistry: searchRegistry(),
        previewRegistryInstall,
        installFromRegistry,
        installTeam,
      },
    });
    fireEvent.click(within(teamList()).getByText("Find in registry"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Review Daily Brief (test)" }),
    );
    await waitFor(() =>
      expect(previewRegistryInstall).toHaveBeenCalledWith(
        7,
        "trops/daily-brief-test",
      ),
    );
    expect(
      await screen.findByText(
        "From the registry: trops/daily-brief-test v1.0.0 by trops",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Agenda" }));
    fireEvent.click(screen.getByText("Install 1 bot"));
    await waitFor(() =>
      expect(installFromRegistry).toHaveBeenCalledWith(7, "rp_1", {}, [
        "inbox",
      ]),
    );
    expect(installTeam).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Added 1 paused bot from Daily Brief (test). Turn it on when you're ready.",
      ),
    ).toBeInTheDocument();
    expect(team.refresh).toHaveBeenCalled();
  });

  it("shows why a registry package couldn't be opened", async () => {
    const previewRegistryInstall = jest.fn().mockResolvedValue({
      error: "The package failed verification: bad signature",
    });
    setup({
      apiOver: { searchRegistry: searchRegistry(), previewRegistryInstall },
    });
    fireEvent.click(within(teamList()).getByText("Find in registry"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Review Daily Brief (test)" }),
    );
    expect(
      await screen.findByText("The package failed verification: bad signature"),
    ).toBeInTheDocument();
  });
});

describe("BotsView — show bots on the dashboard (TEAM-012)", () => {
  it("shows a bot's results on the dashboard from its … menu", async () => {
    const addBotWidget = jest
      .fn()
      .mockResolvedValue({ added: true, widgetId: 5 });
    setup({ apiOver: { addBotWidget } });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByText("Show on dashboard"));
    await waitFor(() =>
      expect(addBotWidget).toHaveBeenCalledWith(7, {
        kind: "results",
        botId: "b1",
      }),
    );
    expect(
      await screen.findByText("Added Inbox Watch's results to the dashboard."),
    ).toBeInTheDocument();
  });

  it("shows the team's activity on the dashboard", async () => {
    const addBotWidget = jest
      .fn()
      .mockResolvedValue({ added: true, widgetId: 6 });
    setup({ apiOver: { addBotWidget } });
    fireEvent.click(within(teamList()).getByText("Show team activity"));
    await waitFor(() =>
      expect(addBotWidget).toHaveBeenCalledWith(7, { kind: "activity" }),
    );
    expect(
      await screen.findByText("Added Bot activity to the dashboard."),
    ).toBeInTheDocument();
  });

  it("says why it couldn't add the widget", async () => {
    const addBotWidget = jest.fn().mockResolvedValue({
      error: "Save the dashboard first, then try again.",
    });
    setup({ apiOver: { addBotWidget } });
    fireEvent.click(within(teamList()).getByText("Show team activity"));
    expect(
      await screen.findByText("Save the dashboard first, then try again."),
    ).toBeInTheDocument();
  });

  it("a new bot shows its results on the dashboard when the box is ticked", async () => {
    const addBotWidget = jest
      .fn()
      .mockResolvedValue({ added: true, widgetId: 7 });
    const save = jest.fn().mockResolvedValue({ id: "bot_new", name: "Digest" });
    setup({ apiOver: { addBotWidget, save } });
    fireEvent.click(within(teamList()).getByText("Add bot"));
    fireEvent.change(await screen.findByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Digest" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Summarise" },
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() =>
      expect(addBotWidget).toHaveBeenCalledWith(7, {
        kind: "results",
        botId: "bot_new",
      }),
    );
  });
});
