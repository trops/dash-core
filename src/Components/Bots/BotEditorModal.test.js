import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotEditorModal } from "./BotEditorModal";
import { AppContext } from "../../Context/App/AppContext";

// Avoid ComponentManager's transitive @headlessui/react import.
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

const workspaces = [
  { id: 7, name: "Kitchen Sink", layout: [] },
  { id: 9, name: "Sales", layout: [] },
];

function setup(props = {}) {
  const save = jest.fn().mockResolvedValue({ id: "bot_new", name: "X" });
  const list = jest
    .fn()
    .mockResolvedValue([{ id: "bot_other", name: "Other", ref: "local/o" }]);
  window.mainApi = {
    bots: {
      save,
      list,
      listToolSources: jest.fn().mockResolvedValue([]),
    },
  };
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(
    <AppContext.Provider value={{ providers: {} }}>
      <BotEditorModal
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        workspaces={workspaces}
        {...props}
      />
    </AppContext.Provider>,
  );
  return { save, list, onClose, onSaved };
}

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
    target: { value: "Inbox Watch" },
  });
  fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
    target: { value: "Watch my inbox" },
  });
};

afterEach(() => {
  delete window.mainApi;
});

describe("BotEditorModal", () => {
  it("renders nothing when closed", () => {
    render(
      <AppContext.Provider value={{ providers: {} }}>
        <BotEditorModal isOpen={false} onClose={jest.fn()} />
      </AppContext.Provider>,
    );
    expect(screen.queryByPlaceholderText("e.g. PR Digest")).toBeNull();
  });

  it("creates a bot on the given dashboard's team, then closes", async () => {
    const { save, onClose, onSaved } = setup({ workspaceId: 7 });
    expect(screen.getByLabelText("Team")).toHaveValue("7");
    fill();
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      name: "Inbox Watch",
      workspaceId: "7",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("edits an existing bot (keeps its id and team)", async () => {
    const { save } = setup({
      bot: {
        id: "bot_1",
        name: "Inbox Watch",
        instructions: "x",
        schedules: [],
        workspaceId: "9",
      },
    });
    expect(screen.getByLabelText("Team")).toHaveValue("9");
    // Save is disabled until something changes.
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "x " },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      id: "bot_1",
      workspaceId: "9",
    });
  });

  it("loads the other bots so their events can be picked", async () => {
    const { list } = setup();
    await waitFor(() => expect(list).toHaveBeenCalled());
  });

  it("Cancel closes without saving", () => {
    const { save, onClose } = setup();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
