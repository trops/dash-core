import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditPanel } from "./EditPanel";
import { ThemeContext } from "../../Context";

// The Context barrel pulls in the layout builder; the panel only needs
// ThemeContext. The Add tab's library has its own tests.
jest.mock("../../Context", () => ({
  ThemeContext: require("react").createContext({ currentTheme: {} }),
}));
jest.mock("../Theme/ThemeColorDots", () => ({ ThemeColorDots: () => null }));
jest.mock("../Navigation/WidgetSidebar", () => ({
  WidgetSidebar: (props) => (
    <div data-testid="widget-library">
      {props.embedded ? "embedded" : "standalone"} · {props.username || ""}
      {props.onPick && (
        <button type="button" onClick={() => props.onPick("dash.clock.Clock")}>
          pick clock
        </button>
      )}
    </div>
  ),
}));

const workspace = {
  id: 7,
  name: "Inbox triage",
  menuId: 2,
  themeKey: "t1",
};
const themes = {
  t1: { name: "Bluish Hue" },
  t2: { name: "Crimson Glow" },
};

function renderPanel(props = {}) {
  const handlers = {
    onNameChange: jest.fn(),
    onFolderChange: jest.fn(),
    onThemeChange: jest.fn(),
    onScrollableChange: jest.fn(),
    onSidebarChange: jest.fn(),
    onOpenConfig: jest.fn(),
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
      <EditPanel
        workspace={workspace}
        menuItems={[
          { id: 1, name: "Work" },
          { id: 2, name: "Home" },
        ]}
        themes={themes}
        scrollableEnabled={false}
        sidebarEnabled={true}
        username="trops"
        {...handlers}
        {...props}
      />
    </ThemeContext.Provider>,
  );
  return handlers;
}

describe("EditPanel (phase 1b)", () => {
  test("opens on Add, showing the widget library embedded", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("widget-library")).toHaveTextContent(
      "embedded · trops",
    );
  });

  test("Dashboard tab edits the name and toggles", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    fireEvent.change(screen.getByDisplayValue("Inbox triage"), {
      target: { value: "Inbox" },
    });
    expect(h.onNameChange).toHaveBeenCalledWith("Inbox");
    fireEvent.click(screen.getByText("Scrollable"));
    expect(h.onScrollableChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Pinned sidebar"));
    expect(h.onSidebarChange).toHaveBeenCalledWith(false);
  });

  test("Dashboard tab opens Dashboard Config, with the unresolved count", () => {
    const h = renderPanel({ configUnresolvedCount: 2 });
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    expect(screen.getByText(/2 widgets need a provider/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Dashboard Config"));
    expect(h.onOpenConfig).toHaveBeenCalled();
  });

  test("Scrollable is hidden when the dashboard has several pages", () => {
    renderPanel({ onScrollableChange: null });
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    expect(screen.queryByText("Scrollable")).toBeNull();
  });

  test("Theme tab lists themes, marks the current one and picks another", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Theme" }));
    expect(screen.getByRole("radio", { name: /Bluish Hue/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Crimson Glow/ }));
    expect(h.onThemeChange).toHaveBeenCalledWith("t2");
  });
});

describe("EditPanel — selection tabs (phase 1c)", () => {
  const widgetSel = {
    kind: "widget",
    uuid: "d-Emails-2",
    label: "Important Emails",
    component: "ai-built.emails.Emails",
  };

  test("selecting a widget opens its Widget tab", () => {
    const { rerender } = render(
      <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
        <EditPanel workspace={workspace} selection={null} />
      </ThemeContext.Provider>,
    );
    expect(screen.queryByRole("tab", { name: "Widget" })).toBeNull();
    rerender(
      <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
        <EditPanel workspace={workspace} selection={widgetSel} />
      </ThemeContext.Provider>,
    );
    expect(screen.getByRole("tab", { name: "Widget" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Important Emails")).toBeInTheDocument();
  });

  test("the Widget tab: name and whose, one Change, the panel, no dialogs (Phase 3P)", () => {
    const onWidgetAction = jest.fn();
    renderPanel({
      selection: widgetSel,
      onWidgetAction,
      widgetOwner: "Built by AI · yours",
      widgetConfig: <div data-testid="widget-config">settings here</div>,
    });
    expect(screen.getByText("Important Emails")).toBeInTheDocument();
    expect(screen.getByText("Built by AI · yours")).toBeInTheDocument();
    // Not the internal id.
    expect(screen.queryByText("ai-built.emails.Emails")).toBeNull();
    expect(screen.getByTestId("widget-config")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Listeners" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Change Important Emails" }),
    );
    expect(onWidgetAction.mock.calls).toEqual([["edit-with-ai"]]);
    expect(
      screen.getByText(
        "Settings wait for Save. To change what it does, use Change on it.",
      ),
    ).toBeInTheDocument();
  });

  test("the ⋯ menu moves, splits and removes", () => {
    const onWidgetAction = jest.fn();
    const onMoveWidget = jest.fn();
    renderPanel({ selection: widgetSel, onWidgetAction, onMoveWidget });
    const pick = (name) => {
      fireEvent.click(
        screen.getByRole("button", { name: "Important Emails options" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    pick("Move to another cell");
    expect(onMoveWidget).toHaveBeenCalledWith(true);
    pick("Split side by side");
    pick("Split top and bottom");
    pick("Remove");
    expect(onWidgetAction.mock.calls).toEqual([
      ["split", null, { direction: "horizontal" }],
      ["split", null, { direction: "vertical" }],
      ["remove"],
    ]);
  });

  test("Change waits while edits wait for Save, and says why", () => {
    const onWidgetAction = jest.fn();
    renderPanel({
      selection: widgetSel,
      onWidgetAction,
      changeBlocked: "Save or cancel your 1 change first.",
    });
    const change = screen.getByRole("button", {
      name: "Change Important Emails",
    });
    expect(change).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Save or cancel your 1 change first.",
    );
  });

  test("someone else's widget: a change is saved as a new widget", () => {
    renderPanel({ selection: widgetSel, widgetNotYours: true });
    expect(
      screen.getByText(
        "It isn't yours, so a change is saved as a new widget in this cell.",
      ),
    ).toBeInTheDocument();
  });

  test("a built-in widget has no Change", () => {
    renderPanel({ selection: widgetSel, canChange: false });
    expect(
      screen.queryByRole("button", { name: "Change Important Emails" }),
    ).toBeNull();
  });

  test("a new selection opens its own panel, from any tab; there's no Ask AI", () => {
    const panel = (selection) => (
      <ThemeContext.Provider value={{ currentTheme: {}, themes: {} }}>
        <EditPanel workspace={workspace} selection={selection} />
      </ThemeContext.Provider>
    );
    const other = { ...widgetSel, uuid: "w-2", label: "Calendar" };
    const { rerender } = render(panel(null));
    rerender(panel(widgetSel));
    expect(screen.getByRole("tab", { name: "Widget" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Dashboard" }));
    rerender(panel(other));
    expect(screen.getByRole("tab", { name: "Widget" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: "Ask AI" })).toBeNull();
    // An old request for Ask AI opens the widget's panel instead.
    rerender(panel({ ...widgetSel, uuid: "w-3", openTab: "ask" }));
    expect(screen.getByRole("tab", { name: "Widget" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("selecting a bot opens its Bot tab with the bot editor", () => {
    renderPanel({
      selection: { kind: "bot", botId: "bot_t", label: "Triage" },
      botEditor: <div>bot form here</div>,
    });
    expect(screen.getByRole("tab", { name: "Bot" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("bot form here")).toBeInTheDocument();
  });
});

describe("EditPanel — an empty cell (phase 1d, Phase 3P)", () => {
  const cellSel = {
    kind: "cell",
    gridItemId: 1,
    cellNumber: "2.1",
    label: "Empty cell 2.1",
  };

  test("a selected empty cell opens Add, and clicking a widget places it there", () => {
    const onPlaceWidget = jest.fn();
    renderPanel({ selection: cellSel, onPlaceWidget });
    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("empty-cell")).toHaveTextContent("Empty cell");
    expect(screen.getByTestId("empty-cell")).toHaveTextContent("Cell 2.1");
    fireEvent.click(screen.getByText("pick clock"));
    expect(onPlaceWidget).toHaveBeenCalledWith("dash.clock.Clock");
  });

  test("without a cell selected, the library is drag-only", () => {
    renderPanel();
    expect(screen.queryByText("pick clock")).toBeNull();
  });

  test("Build with AI builds a widget for the selected cell", () => {
    const onBuildWithAi = jest.fn();
    renderPanel({ selection: cellSel, onBuildWithAi });
    fireEvent.click(screen.getByRole("button", { name: "Build with AI" }));
    expect(onBuildWithAi).toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: "Ask AI" })).toBeNull();
  });
});

describe("EditPanel — moving a widget without dragging (phase 1e)", () => {
  const sel = { kind: "widget", uuid: "w1", label: "Emails", component: "x" };

  test("while moving, the panel says how to finish and can stop", () => {
    const onMoveWidget = jest.fn();
    renderPanel({ selection: { ...sel, moving: true }, onMoveWidget });
    expect(
      screen.getByText(/Choose a cell in the same grid/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stop moving"));
    expect(onMoveWidget).toHaveBeenCalledWith(false);
  });
});
