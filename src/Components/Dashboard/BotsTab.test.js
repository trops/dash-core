import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotsTab } from "./BotsTab";
import { AppContext } from "../../Context/App/AppContext";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

const workspace = { id: 7, name: "Kitchen Sink", layout: [] };
const workspaces = [workspace, { id: 9, name: "Sales", layout: [] }];

const allBots = [
  {
    id: "b1",
    name: "Inbox Watch",
    instructions: "x",
    workspaceId: "7",
    schedules: [{ cron: "0 7 * * *" }],
    subscriptions: [{ eventType: "e" }],
  },
  { id: "b2", name: "Notifier", instructions: "x", workspaceId: 7 },
  { id: "b3", name: "Sales Bot", instructions: "x", workspaceId: "9" },
  { id: "b4", name: "Loose", instructions: "x", workspaceId: null },
];

function setup({ bots = allBots, running = [], paused = [] } = {}) {
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    listRunning: jest.fn().mockResolvedValue(running),
    getPauseState: jest.fn().mockResolvedValue({ global: false, bots: paused }),
    save: jest.fn().mockResolvedValue({}),
    listToolSources: jest.fn().mockResolvedValue([]),
    getTeamSettings: jest
      .fn()
      .mockResolvedValue({ leadEnabled: true, introDismissed: true }),
  };
  window.mainApi = { bots: api };
  render(
    <AppContext.Provider value={{ providers: {} }}>
      <BotsTab workspace={workspace} workspaces={workspaces} />
    </AppContext.Provider>,
  );
  return api;
}

afterEach(() => {
  delete window.mainApi;
});

describe("BotsTab — team lead (TEAM-002)", () => {
  const lead = {
    id: "lead_7",
    name: "Kitchen Sink Lead",
    role: "lead",
    workspaceId: "7",
  };

  it("pins the lead at the top, separate from the members list", async () => {
    setup({ bots: [...allBots, lead] });
    expect(await screen.findByText("Kitchen Sink Lead")).toBeInTheDocument();
    expect(screen.getByText("Ask the lead")).toBeInTheDocument();
    // The lead isn't a member row (no Edit / Remove from team for it).
    expect(screen.queryByLabelText("Edit Kitchen Sink Lead")).toBeNull();
    expect(
      screen.queryByLabelText("Remove Kitchen Sink Lead from team"),
    ).toBeNull();
  });

  it("an empty team still shows its lead", async () => {
    setup({ bots: [lead] });
    expect(await screen.findByText("Kitchen Sink Lead")).toBeInTheDocument();
    expect(
      screen.getByText(/No bots on this dashboard yet/),
    ).toBeInTheDocument();
  });
});

describe("BotsTab — this dashboard's team", () => {
  it("lists only this dashboard's bots (ids compared as strings)", async () => {
    setup();
    expect(await screen.findByText("Inbox Watch")).toBeInTheDocument();
    expect(screen.getByText("Notifier")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).toBeNull();
    expect(screen.queryByText("Loose")).toBeNull();
  });

  it("shows each bot's status and how it starts", async () => {
    setup({ running: [{ id: "b1", name: "Inbox Watch" }], paused: ["b2"] });
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("On a schedule · on 1 event")).toBeInTheDocument();
    expect(screen.getByText("Runs manually")).toBeInTheDocument();
  });

  it("says that changes here save immediately", async () => {
    setup();
    expect(await screen.findByText(/save immediately/i)).toBeInTheDocument();
  });

  it("+ Add bot opens the editor preset to this dashboard", async () => {
    setup();
    fireEvent.click(await screen.findByText("Add bot"));
    expect(screen.getByLabelText("Team")).toHaveValue("7");
  });

  it("Edit opens the editor for that bot", async () => {
    setup();
    fireEvent.click(await screen.findByLabelText("Edit Inbox Watch"));
    expect(screen.getByDisplayValue("Inbox Watch")).toBeInTheDocument();
  });

  it("Remove from team unassigns the bot (never deletes it)", async () => {
    const api = setup();
    fireEvent.click(await screen.findByLabelText("Remove Notifier from team"));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][0]).toMatchObject({
      id: "b2",
      workspaceId: null,
    });
    expect(api.delete).toBeUndefined();
  });

  it("empty team explains how to add or move bots here", async () => {
    setup({ bots: [] });
    expect(
      await screen.findByText(/No bots on this dashboard yet/),
    ).toBeInTheDocument();
  });
});
