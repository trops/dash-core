/**
 * BotPageModal — the bot page in a large modal, from the Bots panel or a
 * notification (app-navigation NAV-016 AC5).
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent, within } from "@testing-library/react";

let mockPageProps;
jest.mock("./BotPage", () => ({
  BotPage: (props) => {
    mockPageProps = props;
    return (
      <div>
        page for {props.botId} on {props.initialTab}
        <button onClick={() => props.onDirtyChange(true)}>make-dirty</button>
        <button onClick={props.onClose}>page-close</button>
        <button onClick={() => props.onDeleted(props.botId)}>
          page-deleted
        </button>
        {props.onOpenInBotsView ? (
          <button onClick={() => props.onOpenInBotsView({ id: 7 }, "b1")}>
            page-bots-view
          </button>
        ) : null}
      </div>
    );
  },
}));

let mockModalProps;
jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    Modal: (props) => {
      mockModalProps = props;
      return props.isOpen ? (
        <div data-testid="modal">{props.children}</div>
      ) : null;
    },
  };
});

import { BotPageModal } from "./BotPageModal";

// Like DashboardStage: holds the request, clears it on close.
let ask;
function Host({ initial, onClose, ...extra }) {
  const [request, setRequest] = React.useState(initial);
  ask = (r) => act(() => setRequest(r));
  return (
    <BotPageModal
      request={request}
      onClose={() => {
        onClose();
        setRequest(null);
      }}
      {...extra}
    />
  );
}

function setup(request = { botId: "b1", tab: "settings" }, extra = {}) {
  const onClose = jest.fn();
  render(<Host initial={request} onClose={onClose} {...extra} />);
  return { onClose };
}

test("nothing to show without a request", () => {
  setup(null);
  expect(screen.queryByTestId("modal")).toBeNull();
});

test("shows the asked-for bot on the asked-for tab", () => {
  setup();
  expect(screen.getByText("page for b1 on settings")).toBeInTheDocument();
});

test("opens on the conversation by default", () => {
  setup({ botId: "b1" });
  expect(screen.getByText("page for b1 on conversation")).toBeInTheDocument();
});

test("the page's close closes the modal", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByText("page-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("bot-page-modal")).toBeNull();
});

test("deleting the bot closes the modal", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByText("page-deleted"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking outside closes it, unless Settings has unsaved edits", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByText("make-dirty"));
  act(() => mockModalProps.setIsOpen(false));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("bot-page-modal")).toBeInTheDocument();
});

test("clicking outside with nothing unsaved closes it", () => {
  const { onClose } = setup();
  act(() => mockModalProps.setIsOpen(false));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("another bot while there are unsaved edits asks first; Cancel keeps them", () => {
  setup();
  fireEvent.click(screen.getByText("make-dirty"));
  ask({ botId: "b2", tab: "conversation" });
  const confirm = screen.getByTestId("confirmation-modal");
  expect(
    within(confirm).getByText("Discard unsaved changes?"),
  ).toBeInTheDocument();
  expect(screen.getByText("page for b1 on settings")).toBeInTheDocument();
  fireEvent.click(within(confirm).getByText("Cancel"));
  expect(screen.getByText("page for b1 on settings")).toBeInTheDocument();
});

test("Discard shows the new bot, and clicking outside works again", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByText("make-dirty"));
  ask({ botId: "b2", tab: "conversation" });
  fireEvent.click(
    within(screen.getByTestId("confirmation-modal")).getByText("Discard"),
  );
  expect(screen.getByText("page for b2 on conversation")).toBeInTheDocument();
  act(() => mockModalProps.setIsOpen(false));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("another bot with nothing unsaved just swaps", () => {
  setup();
  ask({ botId: "b2", tab: "activity" });
  expect(screen.getByText("page for b2 on activity")).toBeInTheDocument();
  expect(screen.queryByTestId("confirmation-modal")).toBeNull();
});

test("Open in Bots view closes the modal first", () => {
  const onOpenInBotsView = jest.fn();
  const { onClose } = setup(undefined, { onOpenInBotsView });
  fireEvent.click(screen.getByText("page-bots-view"));
  expect(onClose).toHaveBeenCalled();
  expect(onOpenInBotsView).toHaveBeenCalledWith({ id: 7 }, "b1");
});

test("no Bots view button when the host can't open one", () => {
  setup();
  expect(mockPageProps.onOpenInBotsView).toBeNull();
});
