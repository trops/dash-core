import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { BotsSection } from "./BotsSection";
import { AppContext } from "../../../Context/App/AppContext";

// Mock ComponentManager to avoid transitive @headlessui/react import
jest.mock("../../../ComponentManager", () => ({
  ComponentManager: {
    config: jest.fn().mockReturnValue(null),
  },
}));

function makeBotsApi(overrides = {}) {
  return {
    list: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({ id: "bot_new", name: "New" }),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderSection({
  botsApi,
  createRequested = false,
  onCreateAcknowledged = () => {},
  providers = {},
} = {}) {
  const bots = botsApi || makeBotsApi();
  render(
    <AppContext.Provider value={{ providers }}>
      <BotsSection
        dashApi={{ bots }}
        createRequested={createRequested}
        onCreateAcknowledged={onCreateAcknowledged}
      />
    </AppContext.Provider>,
  );
  return bots;
}

describe("BotsSection", () => {
  it("shows an empty state when there are no bots", async () => {
    renderSection();
    expect(await screen.findByText("No bots yet")).toBeInTheDocument();
  });

  it("lists bots returned by bots.list()", async () => {
    const bots = makeBotsApi({
      list: jest
        .fn()
        .mockResolvedValue([
          { id: "b1", name: "PR Digest", provider: "anthropic", schedules: [] },
        ]),
    });
    renderSection({ botsApi: bots });
    expect(await screen.findByText("PR Digest")).toBeInTheDocument();
    expect(bots.list).toHaveBeenCalled();
  });

  it("createRequested opens a blank form; saving calls bots.save with the definition", async () => {
    const onAck = jest.fn();
    const bots = makeBotsApi();
    renderSection({
      botsApi: bots,
      createRequested: true,
      onCreateAcknowledged: onAck,
    });

    const nameInput = await screen.findByPlaceholderText("e.g. PR Digest");
    fireEvent.change(nameInput, { target: { value: "New Bot" } });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "do stuff" },
    });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(bots.save).toHaveBeenCalledTimes(1));
    expect(bots.save.mock.calls[0][0]).toMatchObject({
      name: "New Bot",
      instructions: "do stuff",
    });
    expect(onAck).toHaveBeenCalled();
  });

  it("selecting a bot then Delete confirms and calls bots.delete", async () => {
    const bots = makeBotsApi({
      list: jest
        .fn()
        .mockResolvedValue([
          { id: "b1", name: "PR Digest", provider: "anthropic", schedules: [] },
        ]),
    });
    renderSection({ botsApi: bots });
    fireEvent.click(await screen.findByText("PR Digest"));
    fireEvent.click(await screen.findByText("Delete")); // BotDetail delete button
    // Confirm inside the modal (scoped so it doesn't collide with the button).
    const modal = await screen.findByTestId("confirmation-modal");
    fireEvent.click(within(modal).getByText("Delete"));
    await waitFor(() => expect(bots.delete).toHaveBeenCalledWith("b1"));
  });
});
