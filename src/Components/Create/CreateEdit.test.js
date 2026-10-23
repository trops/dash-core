/**
 * Create › Change <widget> (consolidation Phase 3): every Change with AI
 * door opens here. The Scout says what it does now, the user picks where
 * the change goes — in place (theirs only) or a new widget — and the
 * Planner, Builder and Checker take it from there; when it's installed the
 * widget reloads, or the new one takes its place in the cell.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";

const mockConfigs = {
  "jg.inbox.Inbox": {
    name: "Inbox",
    userConfig: {
      maxMessages: { displayName: "Max messages", defaultValue: 20 },
    },
    providers: [{ type: "gmail", providerClass: "mcp" }],
    events: ["messageSelected"],
  },
  "trops.clock.Clock": { name: "Clock", userConfig: {} },
  "ai-built.notes.Notes": { name: "Notes", userConfig: {} },
  "ai-built.pipeline.Stages": { name: "Stages", userConfig: {} },
};
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: (c) => mockConfigs[c] || null },
}));
let mockPlanProps;
jest.mock("./CreatePlanStep", () => ({
  CreatePlanStep: (props) => {
    mockPlanProps = props;
    return <div data-testid="plan-step">{props.prompt}</div>;
  },
  withoutPlan: (t) => t,
}));
let mockRoleRequests;
jest.mock("../../utils/teamRoles", () => ({
  runTeamRole: (role, request) => {
    mockRoleRequests.push([role, request]);
    return Promise.resolve({
      status: "completed",
      output: "Lists your unread Gmail, newest first.",
    });
  },
  extractMatches: () => null,
  withoutMatches: (t) => t,
}));

const INSTALLED = [
  // As widgets.list() gives them: components by their bare names; a
  // registry package kept under its bare name.
  { name: "@jg/inbox", packageId: "@jg/inbox", componentNames: ["Inbox"] },
  {
    name: "clock",
    componentNames: ["Clock"],
    widgets: [{ name: "Clock", displayName: "World Clock" }],
  },
  {
    name: "@ai-built/notes",
    packageId: "@ai-built/notes",
    componentNames: ["Notes"],
  },
  {
    name: "@ai-built/pipeline",
    packageId: "@ai-built/pipeline",
    componentNames: ["Pipeline", "Stages"],
  },
  {
    name: "@local/tally",
    packageId: "@local/tally",
    componentNames: ["Tally"],
    widgets: [{ name: "Tally", displayName: "Tally" }],
  },
];
const WORKSPACES = [
  {
    id: 7,
    name: "Morning Brief",
    layout: [{ id: 3, component: "jg.inbox.Inbox" }],
  },
  { id: 8, name: "Sales", layout: [{ id: 1, component: "jg.inbox.Inbox" }] },
];

async function setup(edit, { username = "jg" } = {}) {
  mockPlanProps = null;
  mockRoleRequests = [];
  window.mainApi = {
    widgets: {
      list: jest.fn().mockResolvedValue(INSTALLED),
      readSources: jest.fn().mockResolvedValue({
        success: true,
        componentCode: "export default function Inbox() {}",
        configCode: "export default {}",
      }),
    },
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: !!username }),
      getProfile: jest.fn().mockResolvedValue(username ? { username } : null),
    },
    bots: {
      onPlanBuild: jest.fn(() => 5),
      removeListener: jest.fn(),
      stopPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
  const setIsOpen = jest.fn();
  let utils;
  await act(async () => {
    utils = render(
      <ThemeContext.Provider value={{ currentTheme: {} }}>
        <AppContext.Provider value={{ providers: {}, settings: {} }}>
          <CreateModal
            open
            setIsOpen={setIsOpen}
            workspaces={WORKSPACES}
            edit={edit}
          />
        </AppContext.Provider>
      </ThemeContext.Provider>,
    );
  });
  return { setIsOpen, ...utils };
}

const FROM_CELL = {
  component: "jg.inbox.Inbox",
  sourcePackage: null,
  itemId: 3,
  workspaceId: 7,
  scope: "main",
  pageId: "p1",
  settings: { maxMessages: 10 },
  providers: { gmail: "Work Gmail" },
  error: "",
};

afterEach(() => {
  delete window.mainApi;
});

test("yours: what it does now, where it's used, and Change it in place", async () => {
  await setup(FROM_CELL);
  expect(
    screen.getByText("Change Inbox", { selector: "nav span" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("edit-research-text")).toHaveTextContent(
    "Lists your unread Gmail, newest first.",
  );
  expect(mockRoleRequests[0][0]).toBe("scout");
  expect(mockRoleRequests[0][1]).toMatch(
    /read_widget \(name "@jg\/inbox", component "Inbox"\)/,
  );
  // What Dash knows — this cell's values.
  const facts = screen.getByTestId("edit-facts");
  expect(facts).toHaveTextContent("Max messages (10)");
  expect(facts).toHaveTextContent("gmail — here: Work Gmail");
  expect(facts).toHaveTextContent("messageSelected");
  expect(facts).toHaveTextContent("inbox · yours");
  expect(
    screen.getByText("Every place it's used changes: Morning Brief and Sales."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("radio", { name: /Update Inbox everywhere/ }),
  ).toBeChecked();
  expect(
    screen.getByText(
      "Inbox stays as it is; the new one replaces it in this cell only.",
    ),
  ).toBeInTheDocument();
});

test("Send hands the Planner the change, held to that widget", async () => {
  await setup(FROM_CELL);
  fireEvent.change(
    screen.getByRole("textbox", { name: "What should change?" }),
    {
      target: { value: "Add a date filter" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByTestId("plan-step")).toHaveTextContent(
    "Add a date filter",
  );
  expect(mockPlanProps.edit).toMatchObject({
    mode: "update",
    target: {
      package: "@jg/inbox",
      component: "jg.inbox.Inbox",
      displayName: "Inbox",
    },
    inputs: {
      settings: { maxMessages: 10 },
      providers: { gmail: "Work Gmail" },
    },
    original: { componentCode: "export default function Inbox() {}" },
    cellLabel: "this cell on Morning Brief",
  });
  expect(mockPlanProps.edit.request).toMatch(/^Add a date filter\n/);
  expect(mockPlanProps.edit.request).toMatch(
    /which is on Morning Brief and Sales/,
  );
});

test("Save as a new widget is a choice too", async () => {
  await setup(FROM_CELL);
  fireEvent.click(screen.getByRole("radio", { name: /Save as a new widget/ }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "What should change?" }),
    {
      target: { value: "Add a date filter" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(mockPlanProps.edit.mode).toBe("new");
  expect(mockPlanProps.edit.request).toMatch(/saved as a new widget/);
});

test("someone else's widget: only a new widget; signed out, a way to sign in", async () => {
  await setup(
    { ...FROM_CELL, component: "trops.clock.Clock" },
    { username: null },
  );
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByTestId("edit-mode")).toHaveTextContent(
    "Save as a new widget — World Clock isn't yours, so it stays as it is",
  );
  expect(
    screen.getByRole("button", { name: "Sign in to change World Clock" }),
  ).toBeInTheDocument();
});

test("loaded from your folder (@local): a new widget, your folder stays, no sign-in", async () => {
  await setup(
    { ...FROM_CELL, component: "local.tally.Tally" },
    { username: null },
  );
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByTestId("edit-mode")).toHaveTextContent(
    "Save as a new widget — Tally was loaded from your folder, so your folder stays as it is",
  );
  expect(
    screen.queryByRole("button", { name: /Sign in to change/ }),
  ).toBeNull();
});

test("AI-built is yours, signed in or not", async () => {
  await setup(
    { ...FROM_CELL, component: "ai-built.notes.Notes" },
    { username: null },
  );
  expect(
    screen.getByRole("radio", { name: /Update Notes everywhere/ }),
  ).toBeChecked();
  expect(screen.getByTestId("edit-facts")).toHaveTextContent(
    "@ai-built/notes · AI-built",
  );
});

test("an AI-built package with other widgets: only a new widget, and why", async () => {
  await setup({ ...FROM_CELL, component: "ai-built.pipeline.Stages" });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByTestId("edit-mode")).toHaveTextContent(
    "Save as a new widget — Stages shares its package with other widgets, so it stays as it is",
  );
  expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
});

test("a bare name from an older door is found", async () => {
  await setup({
    ...FROM_CELL,
    component: "Notes",
    sourcePackage: "@ai-built/notes",
  });
  expect(
    screen.getByText("Change Notes", { selector: "nav span" }),
  ).toBeInTheDocument();
});

test("a widget that isn't installed says so", async () => {
  await setup({ ...FROM_CELL, component: "jg.gone.Gone" });
  expect(screen.getByTestId("edit-missing")).toHaveTextContent(
    "That widget isn't installed here any more",
  );
});

test("Fix with AI: the error is shown, asked about, and passed on", async () => {
  await setup({
    component: "jg.inbox.Inbox",
    error: "TypeError: events.map is not a function",
  });
  expect(screen.getByTestId("edit-error")).toHaveTextContent(
    "TypeError: events.map is not a function",
  );
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("Fix the error so it works again.");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(mockPlanProps.edit.request).toMatch(
    /quoted from the app: "TypeError: events.map is not a function"/,
  );
  // Not from a cell: the new widget has no cell to go into.
  expect(mockPlanProps.edit.cellLabel).toBe("");
});

describe("when it's installed", () => {
  const sendAndFinish = async (edit, mode, made) => {
    await setup(edit);
    if (mode === "new") {
      fireEvent.click(
        screen.getByRole("radio", { name: /Save as a new widget/ }),
      );
    }
    fireEvent.change(
      screen.getByRole("textbox", { name: "What should change?" }),
      { target: { value: "Add a date filter" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const events = [];
    const listen = (e) => events.push([e.type, e.detail]);
    for (const t of ["dash:widget-changed", "dash:swap-widget-in-cell"]) {
      window.addEventListener(t, listen);
    }
    act(() => mockPlanProps.onCellDone(made));
    for (const t of ["dash:widget-changed", "dash:swap-widget-in-cell"]) {
      window.removeEventListener(t, listen);
    }
    return events;
  };

  test("in place: it reloads everywhere; the Done screen says so", async () => {
    const events = await sendAndFinish(FROM_CELL, "update", {
      component: "jg.inbox.Inbox",
    });
    expect(events).toEqual([
      [
        "dash:widget-changed",
        { package: "@jg/inbox", component: "jg.inbox.Inbox" },
      ],
    ]);
    expect(screen.getByTestId("edit-done")).toHaveTextContent(
      "Inbox has the change now on Morning Brief and Sales.",
    );
  });

  test("a new widget from a cell takes its place, unsaved", async () => {
    const events = await sendAndFinish(FROM_CELL, "new", {
      component: "ai-built.inboxdates.InboxDates",
    });
    expect(events).toEqual([
      [
        "dash:swap-widget-in-cell",
        {
          widgetComponentName: "ai-built.inboxdates.InboxDates",
          widgetId: 3,
          workspaceId: 7,
          pageId: "p1",
          scope: "main",
        },
      ],
    ]);
    expect(screen.getByTestId("edit-done-save")).toHaveTextContent(
      "Save the dashboard to keep it. Cancel puts Inbox back.",
    );
  });
});

test("closing before it's done stops the build", async () => {
  const { unmount } = await setup(FROM_CELL);
  fireEvent.change(
    screen.getByRole("textbox", { name: "What should change?" }),
    {
      target: { value: "Add a date filter" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockPlanProps.onState({ buildId: "build_1" }));
  unmount();
  expect(window.mainApi.bots.stopPlanBuild).toHaveBeenCalledWith("build_1");
});

test("its name is the one the Widgets page shows", async () => {
  await setup({ ...FROM_CELL, component: "trops.clock.Clock" });
  expect(
    screen.getByText("Change World Clock", { selector: "nav span" }),
  ).toBeInTheDocument();
});

test("Change something else starts again from the widget as it is now", async () => {
  await setup(FROM_CELL);
  fireEvent.change(
    screen.getByRole("textbox", { name: "What should change?" }),
    { target: { value: "Add a date filter" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockPlanProps.onCellDone({ component: "jg.inbox.Inbox" }));
  window.mainApi.widgets.readSources.mockClear();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Change something else" }),
    );
  });
  expect(window.mainApi.widgets.readSources).toHaveBeenCalledWith(
    "@jg/inbox",
    "Inbox",
  );
  expect(
    screen.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue("");
});

describe("Or change it without AI (consolidation Phase 3P)", () => {
  test("yours: Edit the code yourself opens the Widget Builder and closes Create", async () => {
    const { setIsOpen } = await setup(FROM_CELL);
    const events = [];
    const on = (e) => events.push(e.detail);
    window.addEventListener("dash:edit-widget-code", on);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit the code yourself" }),
    );
    window.removeEventListener("dash:edit-widget-code", on);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      widgetComponentName: "jg.inbox.Inbox",
      sourcePackage: "@jg/inbox",
    });
    expect(setIsOpen).toHaveBeenCalled();
  });

  test("someone else's widget: no by-hand row", async () => {
    await setup(
      { ...FROM_CELL, component: "trops.clock.Clock" },
      { username: null },
    );
    expect(screen.queryByTestId("edit-by-hand")).toBeNull();
  });
});
