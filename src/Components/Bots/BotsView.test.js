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

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

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

function setup({ team = makeTeam(), narrow = false } = {}) {
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
});

const teamList = () => screen.getByRole("navigation", { name: "Team" });

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

  it("opens on the lead, with the Ask the lead tab", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Kitchen Lead" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Ask the lead" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Run now")).toBeNull();
  });

  it("selecting a member shows it, with Conversation and Run now", () => {
    setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    expect(
      screen.getByRole("heading", { name: "Inbox Watch" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Conversation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Run now")).toBeInTheDocument();
  });
});

describe("BotsView — tabs and actions", () => {
  it("Activity shows the bot's run history", async () => {
    const { api } = setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledWith("b1", 50));
    expect(await screen.findByText(/hasn.t run yet/)).toBeInTheDocument();
  });

  it("Settings shows the bot's form inline", () => {
    setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByDisplayValue("Inbox Watch")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("+ Add bot opens a new bot's form on this team", () => {
    setup();
    fireEvent.click(screen.getByText("+ Add bot"));
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toHaveValue("7");
  });

  it("Run now starts the selected bot", () => {
    const { api } = setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByText("Run now"));
    expect(api.run).toHaveBeenCalledWith("b1", "", false);
  });

  it("Pause pauses the selected bot", async () => {
    const { api, team } = setup();
    fireEvent.click(within(teamList()).getByText("CRM Sync"));
    fireEvent.click(screen.getByText("Pause"));
    await waitFor(() => expect(api.pauseBot).toHaveBeenCalledWith("b2"));
    expect(team.refresh).toHaveBeenCalled();
  });
});

describe("BotsView — unsaved changes", () => {
  it("asks before leaving the Settings tab with unsaved changes", () => {
    setup();
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.change(screen.getByDisplayValue("Inbox Watch"), {
      target: { value: "Inbox Watch 2" },
    });
    fireEvent.click(within(teamList()).getByText("CRM Sync"));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep editing"));
    expect(
      screen.getByRole("heading", { name: "Inbox Watch" }),
    ).toBeInTheDocument();
    fireEvent.click(within(teamList()).getByText("CRM Sync"));
    fireEvent.click(screen.getByText("Discard"));
    expect(
      screen.getByRole("heading", { name: "CRM Sync" }),
    ).toBeInTheDocument();
  });
});

describe("BotsView — narrow windows", () => {
  it("collapses the team list into a bot picker", () => {
    setup({ narrow: true });
    expect(screen.queryByRole("navigation", { name: "Team" })).toBeNull();
    const picker = screen.getByLabelText("Bot");
    fireEvent.change(picker, { target: { value: "b2" } });
    expect(
      screen.getByRole("heading", { name: "CRM Sync" }),
    ).toBeInTheDocument();
  });
});

describe("BotsView — approvals", () => {
  it("shows the selected bot's pending approval inline", async () => {
    const approval = {
      id: "a1",
      request: { botId: "b1", serverName: "Slack", toolName: "send_message" },
    };
    setup({
      team: makeTeam({
        approvalsFor: (id) => (id === "b1" ? [approval] : []),
      }),
    });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    expect(await screen.findByText(/Needs your approval/)).toBeInTheDocument();
  });
});

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
    expect(
      screen.getByRole("heading", { name: "Inbox Watch" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("a later request re-selects", () => {
    const { rerender } = renderWithFocus({
      botId: "b1",
      tab: "conversation",
      seq: 1,
    });
    rerender({ botId: "b2", tab: "conversation", seq: 2 });
    expect(
      screen.getByRole("heading", { name: "CRM Sync" }),
    ).toBeInTheDocument();
  });

  it("asks first when Settings has unsaved changes", () => {
    const { rerender } = renderWithFocus({
      botId: "b1",
      tab: "settings",
      seq: 1,
    });
    fireEvent.change(screen.getByDisplayValue("Inbox Watch"), {
      target: { value: "Edited" },
    });
    rerender({ botId: "b2", tab: "conversation", seq: 2 });
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Discard"));
    expect(
      screen.getByRole("heading", { name: "CRM Sync" }),
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole("heading", { name: "CRM Sync" }),
    ).toBeInTheDocument();
  });

  it("an unknown bot is ignored", () => {
    renderWithFocus({ botId: "nope", tab: "activity", seq: 1 });
    expect(
      screen.getByRole("heading", { name: "Kitchen Lead" }),
    ).toBeInTheDocument();
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

  it("Discard changes resets the form and reports clean", () => {
    const onDirtyChange = jest.fn();
    renderView({ onDirtyChange });
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("Discard changes")).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("Inbox Watch"), {
      target: { value: "Edited" },
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Discard changes"));
    expect(screen.getByDisplayValue("Inbox Watch")).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("a provider error in the conversation opens Settings › Providers", async () => {
    const onOpenSettings = jest.fn();
    renderView({ onOpenSettings }, (id) =>
      id === "b1"
        ? [
            {
              trigger: "manual",
              status: "failed",
              error: "Token expired",
              prompt: "x",
            },
          ]
        : [],
    );
    fireEvent.click(within(teamList()).getByText("Inbox Watch"));
    fireEvent.click(await screen.findByText("Open Settings › Providers"));
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
