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
import { CellPreview, plannedProviders } from "./CellPreview";

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

function setup(props = {}) {
  window.mainApi = {
    widgetBuilder: {
      previewDraft: jest.fn().mockResolvedValue({
        success: true,
        bundleSource: "module.exports = {}",
        componentName: "SlackThreads",
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
