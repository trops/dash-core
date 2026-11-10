/**
 * NewBotModal (making a bot in Create): the bot form for a bot on no
 * dashboard — blank, or a copy filled in.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewBotModal } from "./NewBotModal";
import { AppContext } from "../../Context/App/AppContext";

jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    Modal: ({ children }) => <div data-testid="modal">{children}</div>,
  };
});
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: jest.fn().mockReturnValue(null) },
}));

function setup(request, save = jest.fn().mockResolvedValue({ id: "b9" })) {
  window.mainApi = { bots: { save } };
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(
    <AppContext.Provider value={{ providers: {} }}>
      <NewBotModal request={request} onClose={onClose} onSaved={onSaved} />
    </AppContext.Provider>,
  );
  return { save, onClose, onSaved };
}

afterEach(() => {
  delete window.mainApi;
});

describe("NewBotModal", () => {
  test("a blank bot on no dashboard: saved Unassigned, then its page opens", async () => {
    const { save, onClose, onSaved } = setup({});
    expect(screen.getByText(/On no dashboard/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Digest" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Sum up the week." },
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "b9" }));
    expect(save.mock.calls[0][0]).toMatchObject({
      name: "Digest",
      workspaceId: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  test("a copy opens filled in, saying what came along", () => {
    setup({
      initial: { name: "Weekly Digest (copy)", instructions: "Sum up." },
      note: "Copied from Weekly Digest: instructions. Nothing is saved until you click Create.",
    });
    expect(screen.getByText("New bot — a copy")).toBeInTheDocument();
    expect(screen.getByTestId("bot-copy-note")).toHaveTextContent(
      "Copied from Weekly Digest",
    );
    expect(screen.getByPlaceholderText("e.g. PR Digest")).toHaveValue(
      "Weekly Digest (copy)",
    );
  });

  test("nothing to show without a request", () => {
    setup(null);
    expect(screen.queryByTestId("new-bot-modal")).toBeNull();
  });
});
