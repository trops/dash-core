import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PanelEditItemHandlers } from "./PanelEditItemHandlers";

/**
 * A widget's Configure › Listeners lists this dashboard's bots as sources
 * next to its widgets (bot-teams TEAM-012 AC7), and shows bot listeners
 * already wired (e.g. from Dashboard Config).
 */

const receiver = {
  id: 2,
  component: "EventLog",
  eventHandlers: ["onMessage"],
  listeners: {},
};
const emitter = {
  id: 1,
  component: "Clock",
  events: ["tick"],
};
const workspaceWith = (item) => ({
  id: 7,
  name: "Algolia",
  layout: [emitter, item],
});

const bots = [
  {
    id: "b1",
    ref: "local/schema-planner",
    name: "Schema Planner",
    workspaceId: 7,
    mcpServers: [],
  },
  // Another dashboard's bot — not offered.
  {
    id: "b2",
    ref: "local/other",
    name: "Other Bot",
    workspaceId: 9,
    mcpServers: [],
  },
];

beforeEach(() => {
  window.mainApi = {
    bots: {
      list: jest.fn().mockResolvedValue(bots),
      listToolSources: jest.fn().mockResolvedValue([]),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

function renderPanel(item = receiver) {
  const onUpdate = jest.fn();
  render(
    <PanelEditItemHandlers
      workspace={workspaceWith(item)}
      item={item}
      onUpdate={onUpdate}
    />,
  );
  fireEvent.click(screen.getByText("onMessage"));
  return onUpdate;
}

describe("PanelEditItemHandlers — bots as listener sources", () => {
  it("lists this dashboard's bots next to its widgets", async () => {
    renderPanel();
    expect(await screen.findByText("Schema Planner")).toBeInTheDocument();
    expect(screen.getByText("Bots on this dashboard")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Other Bot")).not.toBeInTheDocument();
    // Widgets are still offered.
    expect(screen.getByText("tick")).toBeInTheDocument();
  });

  it("ticking a bot's Completed wires bot:<ref>[<id>].completed to the handler", async () => {
    const onUpdate = renderPanel();
    fireEvent.click(await screen.findByText("Completed"));
    expect(onUpdate).toHaveBeenCalled();
    const [nextItem] = onUpdate.mock.calls[0];
    expect(nextItem.listeners.onMessage).toEqual([
      "bot:local/schema-planner[b1].completed",
    ]);
  });

  it("shows a bot listener wired elsewhere, counted and ticked", async () => {
    const wired = {
      ...receiver,
      listeners: { onMessage: ["bot:local/schema-planner[b1].completed"] },
    };
    const onUpdate = renderPanel(wired);
    await screen.findByText("Schema Planner");
    expect(screen.getByText("1 event connected")).toBeInTheDocument();
    // Ticking it again removes it.
    fireEvent.click(screen.getByText("Completed"));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const [nextItem] = onUpdate.mock.calls[0];
    expect(nextItem.listeners.onMessage || []).toEqual([]);
  });

  it("no bots API (or none on this dashboard) → just the widgets", async () => {
    delete window.mainApi;
    renderPanel();
    expect(screen.getByText("tick")).toBeInTheDocument();
    expect(
      screen.queryByText("Bots on this dashboard"),
    ).not.toBeInTheDocument();
  });
});
