import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { WidgetCardHeader } from "./WidgetCardHeader";

jest.mock("../../../../ComponentManager", () => ({
  ComponentManager: {
    config: (component) =>
      component === "trops.composed.ComposedWidget3"
        ? {
            name: "My Workspace",
            icon: "cube",
            providers: [{ type: "slack", required: true }],
          }
        : component === "trops.feed.Feed"
          ? { name: "Feed", eventHandlers: ["onPick", "onClear"] }
          : null,
  },
}));
jest.mock("../../../../Context", () => ({
  AppContext: require("react").createContext({ providers: {} }),
}));
jest.mock("./WidgetIcon", () => ({ WidgetIcon: () => null }));

const theme = {
  "text-neutral-light": "text-neutral-100",
  "text-neutral-medium": "text-neutral-400",
};

function renderHeader(props = {}) {
  return render(
    <ThemeContext.Provider value={{ currentTheme: theme }}>
      <WidgetCardHeader
        item={{ component: "trops.composed.ComposedWidget3" }}
        onConfigure={jest.fn()}
        {...props}
      />
    </ThemeContext.Provider>,
  );
}

describe("WidgetCardHeader — design audit", () => {
  test("the title is the widget's name in the theme's strong text, not the default", () => {
    renderHeader();
    const title = screen.getByText("Composed Widget 3");
    expect(title.className).toMatch(/text-neutral-100/);
    expect(title.className).not.toMatch(/text-gray-/);
    expect(screen.queryByText("My Workspace")).toBeNull();
  });

  test("the package is a 12px muted meta line, never the internal id", () => {
    renderHeader();
    expect(screen.queryByText("trops.composed.ComposedWidget3")).toBeNull();
    const meta = screen.getByText("@trops/composed");
    expect(meta.className).toMatch(/text-xs/);
    expect(meta.className).toMatch(/text-neutral-400/);
  });

  test("an unresolved required provider marks the menu and Edit in panel", () => {
    renderHeader();
    const kebab = screen.getByRole("button", {
      name: "Composed Widget 3 options",
    });
    expect(kebab).toHaveAttribute("data-dot", "true");
    fireEvent.click(kebab);
    expect(
      screen.getByRole("menuitem", { name: /Edit in panel/ }),
    ).toHaveTextContent("!");
  });
});

/**
 * The ⋮ menu (consolidation Phase 3P): Edit in panel, one Change, then Move,
 * Split and Remove — no Configure / Providers / Listeners dialogs.
 */
describe("WidgetCardHeader — the ⋮ menu", () => {
  function open(props) {
    renderHeader(props);
    fireEvent.click(
      screen.getByRole("button", { name: "Composed Widget 3 options" }),
    );
  }

  test("its items, in order", () => {
    open({
      onEditWithAI: jest.fn(),
      onMove: jest.fn(),
      onSplitHorizontal: jest.fn(),
      onSplitVertical: jest.fn(),
      onDelete: jest.fn(),
    });
    expect(
      screen.getAllByRole("menuitem").map((b) => b.textContent.trim()),
    ).toEqual([
      "Edit in panel !",
      "Change Composed Widget 3",
      "Move to another cell",
      "Split side by side",
      "Split top and bottom",
      "Remove",
    ]);
    for (const old of ["Configure", "Providers", "Listeners"]) {
      expect(screen.queryByRole("menuitem", { name: old })).toBeNull();
    }
  });

  test("each item calls its handler", () => {
    const onConfigure = jest.fn();
    const onEditWithAI = jest.fn();
    const onMove = jest.fn();
    const onSplitHorizontal = jest.fn();
    const onDelete = jest.fn();
    const item = { component: "trops.composed.ComposedWidget3" };
    const pick = (name) => {
      fireEvent.click(
        screen.getByRole("button", { name: "Composed Widget 3 options" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    renderHeader({
      item,
      onConfigure,
      onEditWithAI,
      onMove,
      onSplitHorizontal,
      onDelete,
    });
    pick(/Edit in panel/);
    // Its Slack connection isn't set: the panel opens at Connections (4c).
    expect(onConfigure).toHaveBeenCalledWith(item, "providers");
    pick("Change Composed Widget 3");
    expect(onEditWithAI).toHaveBeenCalledWith(item);
    pick("Move to another cell");
    expect(onMove).toHaveBeenCalledWith(item);
    pick("Split side by side");
    expect(onSplitHorizontal).toHaveBeenCalled();
    pick("Remove");
    expect(onDelete).toHaveBeenCalledWith(item);
  });
});

describe("WidgetCardHeader — what's missing (consolidation Phase 4c)", () => {
  const { AppContext } = require("../../../../Context");

  test("a missing connection: a pill that names it and opens Connections", () => {
    const onConfigure = jest.fn();
    const item = { component: "trops.composed.ComposedWidget3" };
    renderHeader({ item, onConfigure });
    const pill = screen.getByTestId("widget-fix-pill");
    expect(pill).toHaveTextContent("Needs a Slack connection");
    fireEvent.click(pill);
    expect(onConfigure).toHaveBeenCalledWith(item, "providers");
  });

  test("a default connection of that type counts: no pill, Edit in panel opens at the top", () => {
    const onConfigure = jest.fn();
    const item = { component: "trops.composed.ComposedWidget3" };
    render(
      <ThemeContext.Provider value={{ currentTheme: theme }}>
        <AppContext.Provider
          value={{
            providers: {
              "Work Slack": { type: "slack", isDefaultForType: true },
            },
          }}
        >
          <WidgetCardHeader item={item} onConfigure={onConfigure} />
        </AppContext.Provider>
      </ThemeContext.Provider>,
    );
    expect(screen.queryByTestId("widget-fix-pill")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Composed Widget 3 options" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit in panel/ }));
    expect(onConfigure).toHaveBeenCalledWith(item, "edit");
  });

  test("listeners not connected: the pill (moved up from the footer) opens Listens for", () => {
    const onConfigure = jest.fn();
    const item = { component: "trops.feed.Feed", listeners: { onPick: ["x"] } };
    renderHeader({ item, onConfigure });
    const pill = screen.getByTestId("widget-fix-pill");
    expect(pill).toHaveTextContent("1 listener not connected");
    fireEvent.click(pill);
    expect(onConfigure).toHaveBeenCalledWith(item, "handlers");
  });

  test("no way to fix it (no panel): no pill", () => {
    render(
      <ThemeContext.Provider value={{ currentTheme: theme }}>
        <WidgetCardHeader
          item={{ component: "trops.composed.ComposedWidget3" }}
        />
      </ThemeContext.Provider>,
    );
    expect(screen.queryByTestId("widget-fix-pill")).toBeNull();
  });
});

test("a connection picked for it on the dashboard counts: no pill (4c)", () => {
  // LayoutGridContainer passes the dashboard's picks merged with its own.
  render(
    <ThemeContext.Provider value={{ currentTheme: theme }}>
      <WidgetCardHeader
        item={{ component: "trops.composed.ComposedWidget3" }}
        selectedProviders={{ slack: "Work Slack" }}
        onConfigure={jest.fn()}
      />
    </ThemeContext.Provider>,
  );
  expect(screen.queryByTestId("widget-fix-pill")).toBeNull();
});
