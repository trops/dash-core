import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { WidgetWirePopover, lastAnswerOf } from "./WidgetWirePopover";

const source = { id: "bot_shop", name: "Shopping Helper" };
const choices = [
  { event: "completed", label: "Completed" },
  { event: "failed", label: "Failed" },
];
const plain = {
  key: "me.notes.ShoppingList|11",
  itemId: "11",
  component: "me.notes.ShoppingList",
  sourcePackage: "@ai-built/shoppinglist",
  label: "Shopping List",
  handlers: [],
  listenerNames: ["showShoppingHelperAnswer"],
  listens: [],
  resultsBotId: null,
};
const board = {
  ...plain,
  key: "me.board.NoticeBoard|12",
  itemId: "12",
  label: "Notice Board",
  handlers: ["showMessage", "showAlert"],
  listenerNames: [],
};
const answered = [
  { status: "completed", output: "- Milk", endedAt: "2026-11-10T08:02:00Z" },
];

function setup(props = {}, runs = answered) {
  window.mainApi = {
    bots: {
      getRuns: jest.fn().mockResolvedValue(runs),
      run: jest.fn().mockResolvedValue({}),
    },
  };
  const calls = {
    onConnect: jest.fn(),
    onShowHere: jest.fn(),
    onAsk: jest.fn(),
    onRemove: jest.fn(),
    onCancel: jest.fn(),
  };
  render(
    <WidgetWirePopover
      source={source}
      widget={plain}
      choices={choices}
      findTarget={() => Promise.resolve({ status: "ready", mode: "update" })}
      {...calls}
      {...props}
    />,
  );
  return calls;
}

describe("lastAnswerOf", () => {
  it("is the latest finished answer", () => {
    expect(
      lastAnswerOf([
        { status: "completed", output: "old", endedAt: "a" },
        { status: "completed", output: "new", endedAt: "b" },
        { status: "failed", output: "", error: "x" },
        { skipped: true, output: "skip" },
      ]),
    ).toEqual({ at: "b", output: "new" });
    expect(lastAnswerOf([])).toBeNull();
  });
});

describe("WidgetWirePopover (TD-009)", () => {
  it("a widget that already listens: pick its listener and Connect, no AI", () => {
    const { onConnect } = setup({ widget: board });
    expect(screen.getByText("Show in Notice Board")).toBeInTheDocument();
    expect(screen.getByLabelText("Completed")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith({
      event: "completed",
      label: "Completed",
      handlerName: "showMessage",
    });
  });

  it("a widget with no listener: say what to show, then Ask the Dash team", async () => {
    const { onAsk } = setup();
    expect(
      await screen.findByText(/reads Shopping Helper's last answers/),
    ).toBeInTheDocument();
    expect(window.mainApi.bots.getRuns).toHaveBeenCalledWith("bot_shop", 20);
    const ask = screen.getByRole("button", { name: "Ask the Dash team" });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Show each item with its picture." },
    });
    await waitFor(() => expect(ask).not.toBeDisabled());
    fireEvent.click(ask);
    // Never a name the widget is already wired with.
    expect(onAsk).toHaveBeenCalledWith({
      event: "completed",
      label: "Completed",
      ask: "Show each item with its picture.",
      handlerName: "showShoppingHelperAnswer2",
    });
  });

  it("from a widget that listens, Describe something else instead", async () => {
    setup({ widget: board });
    fireEvent.click(
      screen.getByRole("button", { name: "Describe something else instead" }),
    );
    expect(
      await screen.findByRole("button", { name: "Ask the Dash team" }),
    ).toBeInTheDocument();
  });

  it("a bot that hasn't answered: Run it now, and Ask waits for an answer", async () => {
    jest.useFakeTimers();
    try {
      setup({}, []);
      await act(async () => {});
      expect(
        screen.getByText(/hasn't answered yet, so there's nothing to read/),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Show it." },
      });
      expect(
        screen.getByRole("button", { name: "Ask the Dash team" }),
      ).toBeDisabled();
      window.mainApi.bots.getRuns.mockResolvedValue(answered);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Run it now" }));
      });
      expect(window.mainApi.bots.run).toHaveBeenCalledWith(
        "bot_shop",
        "",
        false,
      );
      await act(async () => {
        jest.advanceTimersByTime(3100);
      });
      await act(async () => {});
      expect(
        screen.getByRole("button", { name: "Ask the Dash team" }),
      ).not.toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("a widget that isn't yours: Make my own copy", async () => {
    setup({
      findTarget: () =>
        Promise.resolve({
          status: "ready",
          mode: "new",
          target: { package: "@sam/weather" },
        }),
    });
    expect(
      await screen.findByRole("button", { name: "Make my own copy" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/isn't yours to change/)).toBeInTheDocument();
    expect(screen.getByText(/@sam\/weather/)).toBeInTheDocument();
  });

  it("one of Dash's own widgets: says it can't be changed", async () => {
    setup({
      widget: { ...plain, component: "dash.bots.BotActivity" },
      findTarget: () => Promise.resolve({ status: "missing", mode: null }),
    });
    expect(
      await screen.findByText(/one of Dash's own widgets/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ask the Dash team" }),
    ).toBeDisabled();
  });

  it("a Bot results widget: Show here", () => {
    const { onShowHere } = setup({
      widget: {
        ...plain,
        component: "dash.bots.BotResults",
        label: "Bot results",
        resultsBotId: "bot_other",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show here" }));
    expect(onShowHere).toHaveBeenCalledWith("bot_shop");
  });

  it("changing a line: its listener is kept even if the widget no longer lists it; Remove", () => {
    const { onRemove } = setup({
      widget: board,
      mode: "edit",
      edge: { event: "failed", handlerName: "oldHandler", raw: "x" },
    });
    expect(screen.getByLabelText("Failed")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("while saving, Remove waits", () => {
    setup({
      widget: board,
      mode: "edit",
      edge: { event: "completed", handlerName: "showMessage" },
      saving: true,
    });
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});
