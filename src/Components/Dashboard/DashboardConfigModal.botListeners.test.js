/**
 * Dashboard Config › Listeners — bots as sources (bot-teams TEAM-012): a
 * widget handler can be wired to one of this dashboard's bots, saved as the
 * bot's bus event (`bot:<ref>[<botId>].<event>`).
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
import { DashboardConfigModal } from "./DashboardConfigModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

const workspace = {
  id: 7,
  name: "Daily Brief",
  layout: [
    {
      id: 2,
      component: "trops.gmail.GmailInbox",
      dashboardId: 7,
      title: "Gmail Inbox",
    },
  ],
};
const configs = {
  "trops.gmail.GmailInbox": {
    name: "Gmail Inbox",
    events: [],
    eventHandlers: ["refresh"],
  },
};

function setup() {
  window.mainApi = {
    bots: {
      list: jest.fn().mockResolvedValue([
        {
          id: "bot_i",
          name: "Inbox",
          ref: "local/inbox",
          workspaceId: "7",
          mcpServers: [],
        },
        {
          id: "bot_x",
          name: "Elsewhere",
          ref: "local/elsewhere",
          workspaceId: "9",
          mcpServers: [],
        },
      ]),
      listToolSources: jest.fn().mockResolvedValue([]),
    },
  };
  const onSaveListeners = jest.fn();
  render(
    <DashboardConfigModal
      isOpen
      setIsOpen={() => {}}
      workspace={workspace}
      appProviders={{}}
      getWidgetRequirements={() => []}
      getWidgetConfig={(c) => configs[c] || null}
      onSaveBindings={() => {}}
      onSaveListeners={onSaveListeners}
      initialTab="listeners"
    />,
  );
  return { onSaveListeners };
}

afterEach(() => {
  delete window.mainApi;
});

describe("Listeners — bots as sources (TEAM-012)", () => {
  it("offers this dashboard's bots as sources and saves the bot's bus event", async () => {
    const { onSaveListeners } = setup();
    fireEvent.click(await screen.findByText("Gmail Inbox"));
    fireEvent.click(screen.getByText("refresh"));
    const card = (await screen.findByText("Inbox (bot)")).closest(
      "div.rounded-lg",
    );
    expect(screen.queryByText("Elsewhere (bot)")).toBeNull();
    const completed = within(card).getByText("completed").closest("label");
    fireEvent.click(within(completed).getByTestId("icon-square"));
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(onSaveListeners).toHaveBeenCalled());
    expect(onSaveListeners.mock.calls[0][0].adds).toEqual([
      expect.objectContaining({
        receiverItemId: "2",
        handlerName: "refresh",
        sourceComponent: "bot:local/inbox",
        sourceItemId: "bot_i",
        eventName: "completed",
      }),
    ]);
  });
});
