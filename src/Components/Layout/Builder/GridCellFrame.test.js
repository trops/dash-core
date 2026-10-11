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
