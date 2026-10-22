/**
 * CellPreview — a cell build's widget, running, before it's installed
 * (consolidation Phase 2b): inputs from the plan, Run preview, and Looks
 * good / Change something / Discard.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import {
  CellPreview,
  plannedProviders,
  PREVIEW_START_TIMEOUT_MS,
} from "./CellPreview";
import { act } from "@testing-library/react";

let mockRendered;
jest.mock("../../utils/widgetPreviewRenderer", () => ({
  getWidgetPreviewRenderer: () => (props) => {
    mockRendered = props;
    return <div data-testid="sandbox">{props.componentName}</div>;
  },
}));
jest.mock("../../Context/Modal/Panel/PanelEditForm", () => ({
  PanelEditForm: ({ userConfig, userPrefs, onFieldChange }) => (
    <div data-testid="settings-form">
      {Object.keys(userConfig).map((k) => (
        <label key={k}>
          {k}
          <input
            aria-label={k}
            value={userPrefs[k] ?? ""}
            onChange={(e) => onFieldChange(k, e.target.value)}
          />
        </label>
      ))}
    </div>
  ),
}));

const APP_PROVIDERS = {
  "Work Slack": { type: "slack", providerClass: "mcp" },
  "Personal Slack": { type: "slack", providerClass: "mcp" },
};
const made = {
  draft: "draft:SlackThreads",
  package: "@ai-built/slackthreads",
  preview: {
    componentName: "SlackThreads",
    userConfig: {
      rows: { type: "text", displayName: "Rows", defaultValue: "10" },
    },
    providers: [{ type: "slack", providerClass: "mcp", required: true }],
    provider: { slack: "Work Slack" },
    settings: { rows: "5" },
  },
};

function setup(props = {}, draft = {}) {
  window.mainApi = {
    widgetBuilder: {
      previewDraft: jest.fn().mockResolvedValue({
        success: true,
        bundleSource: "module.exports = {}",
        componentName: "SlackThreads",
        ...draft,
      }),
    },
    widgets: {
      readBundle: jest.fn().mockResolvedValue({ success: true, source: "x" }),
    },
  };
  const handlers = {
    onApprove: jest.fn(),
    onRevise: jest.fn(),
    onDiscard: jest.fn(),
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: APP_PROVIDERS }}>
        <CellPreview
          made={made}
          name="Slack Threads"
          cellLabel="cell 2.2 on Slack Pack"
          {...handlers}
          {...props}
        />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return handlers;
}

afterEach(() => {
  delete window.mainApi;
  mockRendered = null;
});

test("plannedProviders keeps the plan's pick only when the user has it", () => {
  const needs = [{ type: "slack" }];
  expect(
    plannedProviders({ slack: "Work Slack" }, needs, APP_PROVIDERS),
  ).toEqual({ slack: "Work Slack" });
  expect(plannedProviders({ slack: "Gone" }, needs, APP_PROVIDERS)).toEqual({});
  expect(plannedProviders("Work Slack", needs, APP_PROVIDERS)).toEqual({
    slack: "Work Slack",
  });
});

test("inputs start from the plan: its connection and settings", () => {
  setup();
  expect(screen.getByTestId("cell-preview")).toHaveTextContent(
    "Not installed yet",
  );
  expect(screen.getByRole("combobox")).toHaveValue("Work Slack");
  expect(screen.getByLabelText("rows")).toHaveValue("5");
});

test("Run preview runs the checked draft in the sandbox, with the inputs", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
  expect(await screen.findByTestId("sandbox")).toHaveTextContent(
    "SlackThreads",
  );
  expect(window.mainApi.widgetBuilder.previewDraft).toHaveBeenCalledWith(
    "draft:SlackThreads",
  );
  expect(mockRendered.bundleSource).toBe("module.exports = {}");
  expect(mockRendered.props).toEqual({ rows: "5" });
  expect(mockRendered.widgetData.selectedProviders).toEqual({
    slack: "Work Slack",
  });
  expect(mockRendered.declaredProviders).toEqual(["slack", "mcp"]);
});

test("an installed widget (registry or yours) runs from its bundle", async () => {
  setup({ made: { ...made, draft: null, package: "@trops/threads" } });
  expect(screen.getByTestId("cell-preview-status")).toHaveTextContent(
    "Not on your dashboard yet",
  );
  fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
  await screen.findByTestId("sandbox");
  expect(window.mainApi.widgets.readBundle).toHaveBeenCalledWith(
    "@trops/threads",
  );
  expect(screen.getByTestId("cell-preview-status")).toHaveTextContent(
    "Running",
  );
});

test("Looks good sends the picked connection and settings", () => {
  const h = setup();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Personal Slack" },
  });
  fireEvent.change(screen.getByLabelText("rows"), { target: { value: "8" } });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Looks good — put it in the cell",
    }),
  );
  expect(h.onApprove).toHaveBeenCalledWith({
    providers: { slack: "Personal Slack" },
    settings: { rows: "8" },
  });
});

test("Change something sends the note to the Builder; Discard discards", async () => {
  const h = setup();
  const send = screen.getByRole("button", { name: "Send to the Builder" });
  expect(send).toBeDisabled();
  fireEvent.change(
    screen.getByPlaceholderText("e.g. smaller rows, show who replied last"),
    { target: { value: "Smaller rows" } },
  );
  fireEvent.click(send);
  await waitFor(() => expect(h.onRevise).toHaveBeenCalledWith("Smaller rows"));
  fireEvent.click(
    screen.getByRole("button", { name: "Discard — leave the cell empty" }),
  );
  expect(h.onDiscard).toHaveBeenCalled();
});

test("no Change something for a widget that wasn't built here", () => {
  setup({ onRevise: null });
  expect(screen.queryByText("Change something")).toBeNull();
});

test("an installed widget loads by the name it's kept under (registry: bare name)", async () => {
  setup({
    made: {
      ...made,
      draft: null,
      package: "@trops/clock",
      preview: { ...made.preview, widgetName: "clock" },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
  await screen.findByTestId("sandbox");
  expect(window.mainApi.widgets.readBundle).toHaveBeenCalledWith("clock");
});

// Review (mockup frame 6): a widget with nothing to connect runs right away,
// and doesn't claim settings or connections it hasn't got.
test("nothing to connect: it runs straight away, without a settings note", async () => {
  setup({
    made: {
      draft: "draft:Countdown",
      preview: { componentName: "Countdown", userConfig: {}, providers: [] },
    },
    name: "Countdown",
  });
  await waitFor(() =>
    expect(screen.getByTestId("cell-preview-status")).toHaveTextContent(
      /^Running$/,
    ),
  );
  expect(window.mainApi.widgetBuilder.previewDraft).toHaveBeenCalledWith(
    "draft:Countdown",
  );
  expect(
    screen.getByText("Nothing to set — it has no settings or connections."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Filled in from the plan/)).toBeNull();
});

test("with a connection it waits for Run preview", () => {
  setup();
  expect(window.mainApi.widgetBuilder.previewDraft).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Run preview" }),
  ).toBeInTheDocument();
});

// Consolidation Phase 3: a change to a widget previews its draft with its
// code, what changed from the widget as it was, and its own words.
describe("a change's preview", () => {
  const original = {
    componentCode: "line one\nline two\nline three",
    configCode: "export default {}",
  };
  const code = {
    componentCode: "line one\nline 2\nline three",
    configCode: "export default {}",
  };

  test("no original: no tabs (a cell build)", () => {
    setup();
    expect(screen.queryByRole("radio", { name: "Code" })).toBeNull();
  });

  test("Code shows the draft's files, read-only", async () => {
    setup({ original }, code);
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() =>
      expect(screen.getByTestId("code-editor")).toHaveTextContent("line 2"),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "SlackThreads.dash.js" }),
    );
    expect(screen.getByTestId("code-editor")).toHaveTextContent(
      "export default {}",
    );
  });

  test("What changed lists the changed lines per file", async () => {
    setup({ original }, code);
    fireEvent.click(screen.getByRole("radio", { name: "What changed" }));
    const pane = await screen.findByTestId("cell-preview-changes");
    await waitFor(() => expect(pane).toHaveTextContent("− line two"));
    expect(pane).toHaveTextContent("+ line 2");
    expect(pane).toHaveTextContent("SlackThreads.dash.js");
    expect(pane).toHaveTextContent("No changes.");
  });

  test("its own words on the buttons and under the inputs", () => {
    setup({
      original,
      approveLabel: "Looks good — update Inbox",
      discardLabel: "Discard — keep Inbox as it is",
      inputsNote: "Only for trying it here.",
    });
    expect(
      screen.getByRole("button", { name: "Looks good — update Inbox" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discard — keep Inbox as it is" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Only for trying it here.")).toBeInTheDocument();
  });
});

describe("a preview that never shows (QA 2026-10-22)", () => {
  const STUCK = "The preview didn't start. Use Run preview again.";

  test("says so after a while, instead of a blank frame", async () => {
    jest.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
      await screen.findByTestId("sandbox");
      act(() => {
        jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS + 10);
      });
      expect(screen.getByText(STUCK)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a widget that shows never gets the message", async () => {
    jest.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
      await screen.findByTestId("sandbox");
      act(() => {
        mockRendered.onMounted();
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS + 10);
      });
      expect(screen.queryByText(STUCK)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
