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

  test("one quiet kebab labelled Widget options opens the menu", () => {
    renderHeader();
    fireEvent.click(screen.getByLabelText("Widget options"));
    expect(screen.getByText("Listeners")).toBeInTheDocument();
    expect(screen.getByTestId("icon-tower-broadcast")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-phone")).toBeNull();
  });

  test("an unresolved required provider shows the warning dot", () => {
    renderHeader();
    expect(screen.getByTitle("Required provider not set")).toBeInTheDocument();
  });
});
