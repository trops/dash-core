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

  test("the Widget tab opens Configure at a section, edits with AI and removes", () => {
    const onWidgetAction = jest.fn();
    renderPanel({
      selection: widgetSel,
      onWidgetAction,
      widgetHasProviders: true,
    });
    fireEvent.click(screen.getByText("Settings"));
    fireEvent.click(screen.getByText("Listeners"));
    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByText("Code"));
    fireEvent.click(screen.getByText("Edit with AI"));
    fireEvent.click(screen.getByText("Remove from dashboard"));
    expect(onWidgetAction.mock.calls).toEqual([
      ["configure", "edit"],
      ["configure", "handlers"],
      ["configure", "providers"],
      ["configure", "code"],
      ["edit-with-ai"],
      ["remove"],
    ]);
  });

  test("Providers is offered only when the widget declares providers", () => {
    renderPanel({ selection: widgetSel, onWidgetAction: jest.fn() });
    expect(screen.queryByText("Providers")).toBeNull();
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

describe("EditPanel — placing in a cell and Ask AI (phase 1d)", () => {
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
    expect(screen.getByText(/Placing in cell 2\.1/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("pick clock"));
    expect(onPlaceWidget).toHaveBeenCalledWith("dash.clock.Clock");
  });

  test("without a cell selected, the library is drag-only", () => {
    renderPanel();
    expect(screen.queryByText("pick clock")).toBeNull();
  });

  test("Ask AI builds a widget for the selected cell", () => {
    const onAskAi = jest.fn();
    renderPanel({ selection: cellSel, onAskAi });
    fireEvent.click(screen.getByRole("tab", { name: "Ask AI" }));
    fireEvent.click(screen.getByText("Build a widget for this cell"));
    expect(onAskAi).toHaveBeenCalled();
    expect(screen.getByText(/Opens the Widget Builder/)).toBeInTheDocument();
  });

  test("Ask AI edits the selected widget", () => {
    const onAskAi = jest.fn();
    renderPanel({
      selection: {
        kind: "widget",
        uuid: "w1",
        label: "Emails",
        component: "x",
      },
      onAskAi,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Ask AI" }));
    fireEvent.click(screen.getByText("Edit this widget with AI"));
    expect(onAskAi).toHaveBeenCalled();
  });

  test("a selection can ask to open on Ask AI", () => {
    renderPanel({
      selection: {
        kind: "widget",
        uuid: "w1",
        label: "Emails",
        component: "x",
        openTab: "ask",
      },
    });
    expect(screen.getByRole("tab", { name: "Ask AI" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
