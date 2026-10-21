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

  test("the package id is a 12px muted meta line", () => {
    renderHeader();
    const meta = screen.getByText("trops.composed.ComposedWidget3");
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
    expect(onConfigure).toHaveBeenCalledWith(item, "edit");
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
