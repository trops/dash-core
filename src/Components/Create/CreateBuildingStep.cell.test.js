/**
 * A cell build on the build screen (consolidation Phase 2b): it waits on the
 * Preview step with CellPreview; Looks good / Change something go to the
 * main process; when it's done the widget is handed to the editor, once.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CreateBuildingStep } from "./CreateBuildingStep";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));
const mockEnsureAuthed = jest.fn().mockResolvedValue(true);
jest.mock("../../hooks/useRegistryAuthGate", () => ({
  ...jest.requireActual("../../hooks/useRegistryAuthGate"),
  useRegistryAuthGate: () => ({
    ensureAuthed: mockEnsureAuthed,
    authGate: null,
  }),
}));
let mockPreviewProps;
jest.mock("./CellPreview", () => ({
  CellPreview: (props) => {
    mockPreviewProps = props;
    return <div data-testid="cell-preview-stub">{props.cellLabel}</div>;
  },
}));

const steps = (preview) => [
  {
    id: "build:0",
    kind: "build",
    piece: 0,
    role: "builder",
    label: "Build Slack Threads",
    status: "done",
  },
  {
    id: "check:0",
    kind: "check",
    piece: 0,
    role: "checker",
    label: "Check Slack Threads",
    status: "done",
  },
  {
    id: "preview:0",
    kind: "preview",
    piece: 0,
    role: "you",
    label: "Preview Slack Threads",
    status: preview,
  },
  {
    id: "save:0",
    kind: "save",
    piece: 0,
    role: "dash",
    label: "Install Slack Threads",
    status: preview === "done" ? "done" : "waiting",
  },
];
const waiting = {
  status: "waiting-for-you",
  steps: steps("needs-you"),
  made: { 0: { draft: "draft:SlackThreads" } },
  totals: { tokens: 0, includedInPlan: true },
};

let listener;
function setup(props = {}) {
  window.mainApi = {
    bots: {
      onPlanBuild: jest.fn((cb) => {
        listener = cb;
        return 3;
      }),
      removeListener: jest.fn(),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      approvePlanStep: jest.fn().mockResolvedValue({ ok: true }),
      revisePlanStep: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
  const onCellDone = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={waiting}
      cell={{ label: "cell 2.2 on Slack Pack" }}
      onCellDone={onCellDone}
      {...props}
    />,
  );
  return { onCellDone };
}

afterEach(() => {
  delete window.mainApi;
});

test("waiting for you: the preview shows on its step", () => {
  setup();
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "Ready for you to look at",
  );
  expect(screen.getByTestId("cell-preview-stub")).toHaveTextContent(
    "cell 2.2 on Slack Pack",
  );
  expect(mockPreviewProps.made).toEqual({ draft: "draft:SlackThreads" });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("Looks good and Change something go to the main process", async () => {
  setup();
  await act(async () => {
    await mockPreviewProps.onApprove({ settings: { rows: 5 } });
  });
  expect(window.mainApi.bots.approvePlanStep).toHaveBeenCalledWith(
    "b1",
    "preview:0",
    { settings: { rows: 5 } },
  );
  await act(async () => {
    await mockPreviewProps.onRevise("Smaller rows");
  });
  expect(window.mainApi.bots.revisePlanStep).toHaveBeenCalledWith(
    "b1",
    "preview:0",
    "Smaller rows",
  );
});

test("done: the widget is handed to the editor once", async () => {
  const { onCellDone } = setup();
  const made = {
    0: {
      component: "ai-built.slackthreads.SlackThreads",
      inputs: { settings: { rows: 5 } },
    },
  };
  act(() =>
    listener({
      buildId: "b1",
      state: { ...waiting, status: "done", steps: steps("done"), made },
    }),
  );
  await waitFor(() => expect(onCellDone).toHaveBeenCalledTimes(1));
  expect(onCellDone).toHaveBeenCalledWith(made[0]);
  act(() =>
    listener({
      buildId: "b1",
      state: { ...waiting, status: "done", steps: steps("done"), made },
    }),
  );
  expect(onCellDone).toHaveBeenCalledTimes(1);
});

test("no preview without a cell (other builds don't wait for one)", () => {
  setup({ cell: null });
  expect(screen.queryByTestId("cell-preview-stub")).toBeNull();
});

test("a registry install that needs sign-in offers it, then tries again", async () => {
  const failed = {
    status: "finished-with-problems",
    steps: [
      {
        id: "install:0",
        kind: "install",
        piece: 0,
        role: "dash",
        label: "Install Digital Clock",
        status: "failed",
        error: "Authentication required to download this widget",
        canRetry: true,
      },
    ],
    made: {},
    totals: { tokens: 0, includedInPlan: true },
  };
  setup({ initialState: failed });
  window.mainApi.bots.retryPlanBuild = jest
    .fn()
    .mockResolvedValue({ ok: true });
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "It isn't ready yet",
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in to the registry" }),
  );
  await waitFor(() =>
    expect(window.mainApi.bots.retryPlanBuild).toHaveBeenCalledWith(
      "b1",
      "install:0",
    ),
  );
  expect(mockEnsureAuthed).toHaveBeenCalled();
});

// Review (mockup Build frame): while it builds, the cell build says what
// happens if the Checker finds problems.
test("building for a cell says nothing is installed until it passes", () => {
  setup({
    initialState: {
      status: "running",
      steps: steps("waiting"),
      made: {},
      totals: { tokens: 0, includedInPlan: true },
    },
  });
  expect(screen.getByTestId("building-cell-note")).toHaveTextContent(
    "If the Checker finds problems, nothing is installed: the Builder gets up to 2 tries to fix them.",
  );
});

// Consolidation Phase 3: a change to a widget waits on the same preview, in
// its own words with the widget as it was, and hands back what it made.
describe("a change to a widget", () => {
  const EDIT = {
    mode: "update",
    original: { componentCode: "a", configCode: "b" },
    approveLabel: "Looks good — update Inbox",
    discardLabel: "Discard — keep Inbox as it is",
    inputsNote: "Only for trying it here.",
  };
  test("its preview, with its words and the original code", () => {
    setup({ cell: null, edit: EDIT });
    expect(screen.getByTestId("cell-preview-stub")).toBeInTheDocument();
    expect(mockPreviewProps).toMatchObject({
      cellLabel: "",
      approveLabel: "Looks good — update Inbox",
      discardLabel: "Discard — keep Inbox as it is",
      inputsNote: "Only for trying it here.",
      original: { componentCode: "a", configCode: "b" },
    });
  });
  test("done: what it made is handed back once", async () => {
    const { onCellDone } = setup({ cell: null, edit: EDIT });
    const made = { 0: { component: "jg.inbox.Inbox" } };
    act(() =>
      listener({
        buildId: "b1",
        state: { ...waiting, status: "done", steps: steps("done"), made },
      }),
    );
    await waitFor(() => expect(onCellDone).toHaveBeenCalledWith(made[0]));
  });
});
