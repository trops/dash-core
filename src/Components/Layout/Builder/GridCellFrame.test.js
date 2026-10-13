import React, { useEffect } from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridCellFrame } from "./GridCellFrame";

/**
 * A grid cell's widget must stay mounted when the dashboard switches
 * between view and edit mode (create-entry phase 1c). Before, view mode
 * drew the widget bare (or in a popout wrapper declared inside the grid's
 * render — a new component type every render) and edit mode drew it in a
 * card, so React rebuilt every widget, reconnecting its providers.
 */

let mounts = 0;
function Widget() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div>widget body</div>;
}

// Stands in for the drag/drop cell body: one component type in both modes.
const Body = ({ children }) => <div>{children}</div>;

function frame(editing, extra = {}) {
  return (
    <GridCellFrame
      editing={editing}
      header={<div>edit header</div>}
      footer={<div>edit footer</div>}
      {...extra}
    >
      <Body>
        <Widget />
      </Body>
    </GridCellFrame>
  );
}

beforeEach(() => {
  mounts = 0;
});

describe("GridCellFrame", () => {
  test("the widget mounts once across view → edit → view", () => {
    const { rerender } = render(frame(false));
    rerender(frame(true));
    rerender(frame(false));
    expect(mounts).toBe(1);
    expect(screen.getByText("widget body")).toBeInTheDocument();
  });

  test("header and footer show only while editing", () => {
    const { rerender } = render(frame(false));
    expect(screen.queryByText("edit header")).toBeNull();
    expect(screen.queryByText("edit footer")).toBeNull();
    rerender(frame(true));
    expect(screen.getByText("edit header")).toBeInTheDocument();
    expect(screen.getByText("edit footer")).toBeInTheDocument();
  });

  test("the popout button shows only in view mode, and pops out", () => {
    const onPopout = jest.fn();
    const { rerender } = render(frame(false, { onPopout }));
    fireEvent.click(screen.getByLabelText("Pop out widget"));
    expect(onPopout).toHaveBeenCalled();
    rerender(frame(true, { onPopout }));
    expect(screen.queryByLabelText("Pop out widget")).toBeNull();
  });

  test("no popout button without a popout handler", () => {
    render(frame(false));
    expect(screen.queryByLabelText("Pop out widget")).toBeNull();
  });
});

describe("GridCellFrame — select to edit (phase 1c)", () => {
  test("clicking the frame while editing selects the widget", () => {
    const onSelect = jest.fn();
    render(frame(true, { onSelect, label: "Important Emails" }));
    fireEvent.click(screen.getByText("widget body"));
    expect(onSelect).toHaveBeenCalled();
  });

  test("keyboard: Enter on the focused frame selects it", () => {
    const onSelect = jest.fn();
    render(frame(true, { onSelect, label: "Important Emails" }));
    const cell = screen.getByRole("group", { name: "Important Emails" });
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();
  });

  test("view mode never selects", () => {
    const onSelect = jest.fn();
    render(frame(false, { onSelect }));
    fireEvent.click(screen.getByText("widget body"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("marks selected, related and dimmed states", () => {
    const { rerender, container } = render(frame(true, { selected: true }));
    expect(container.firstChild).toHaveAttribute("data-state", "selected");
    rerender(frame(true, { related: true }));
    expect(container.firstChild).toHaveAttribute("data-state", "related");
    rerender(frame(true, { dimmed: true }));
    expect(container.firstChild).toHaveAttribute("data-state", "dimmed");
    rerender(frame(false, { selected: true }));
    expect(container.firstChild).not.toHaveAttribute("data-state");
  });
});

describe("GridCellFrame — one themed card while editing (design audit)", () => {
  const { ThemeContext } = require("@trops/dash-react");
  const theme = {
    "border-neutral-dark": "border-neutral-700",
    "border-primary-medium": "border-primary-500",
  };
  const themed = (editing, extra) => (
    <ThemeContext.Provider value={{ currentTheme: theme }}>
      {frame(editing, extra)}
    </ThemeContext.Provider>
  );

  test("the edit frame is a rounded hairline card in the theme's neutral border", () => {
    const { container } = render(themed(true));
    const cls = container.firstChild.className;
    expect(cls).toMatch(/rounded-lg/);
    expect(cls).toMatch(/border-neutral-700/);
    expect(cls).not.toMatch(/border-dashed|border-gray-|border-blue-/);
  });

  test("selected uses the theme's primary border", () => {
    const { container } = render(themed(true, { selected: true }));
    expect(container.firstChild.className).toMatch(
      /border-2 border-primary-500/,
    );
  });

  test("view mode is untouched", () => {
    const { container } = render(themed(false));
    expect(container.firstChild.className).toBe("relative w-full h-full");
  });
});
