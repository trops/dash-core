import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverflowMenu } from "./ManageLayout";

const rect = (left, top) => ({
  left,
  right: left + 32,
  top,
  bottom: top + 32,
  width: 32,
  height: 32,
  x: left,
  y: top,
});

function openAt(left, top = 100) {
  render(
    <OverflowMenu
      ariaLabel="More team actions"
      items={[
        { label: "Export team", onClick: () => {} },
        { label: "Publish team…", onClick: () => {} },
      ]}
    />,
  );
  const root = screen.getByTestId("overflow-menu");
  root.getBoundingClientRect = () => rect(left, top);
  fireEvent.click(screen.getByRole("button", { name: "More team actions" }));
  return screen.getByRole("menu").getAttribute("data-position");
}

describe("OverflowMenu placement (DASH-118)", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
  });

  test("near the right: lines up with the button's right edge, below", () => {
    const pos = openAt(800);
    expect(pos).toContain("right-0");
    expect(pos).toContain("top-full");
  });

  test("near the left of a narrow window: grows right instead", () => {
    const pos = openAt(120);
    expect(pos).toContain("left-0");
    expect(pos).not.toContain("right-0");
  });

  test("near the bottom: opens upward", () => {
    expect(openAt(800, 760)).toContain("bottom-full");
  });
});
