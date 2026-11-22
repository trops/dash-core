/**
 * A plan that came through incomplete (DASH-36): the card says so plainly,
 * with Ask again and — in a dashboard lead's chat — Open in Create; never a
 * plan or a build that isn't there.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanNext } from "./PlanViews";

// The connect dialog opens the providers screen: not what's tested here.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

describe("the card for a plan that came through incomplete", () => {
  test("says so, and asks again or opens Create", () => {
    const again = jest.fn();
    const create = jest.fn();
    render(<PlanNext next="lost" onStartOver={again} onOpenCreate={create} />);
    expect(screen.getByTestId("plan-lost")).toBeInTheDocument();
    expect(
      screen.getByText("The Planner's plan couldn't be shown"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing was built\./)).toBeInTheDocument();
    expect(screen.queryByText(/Yes, build it/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(again).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open in Create" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("Ask again repeats the app's own hand-off when there is one", () => {
    const askAgain = jest.fn();
    const startOver = jest.fn();
    render(
      <PlanNext next="lost" onAskAgain={askAgain} onStartOver={startOver} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(startOver).not.toHaveBeenCalled();
    // In Create itself there's no Open in Create.
    expect(screen.queryByRole("button", { name: "Open in Create" })).toBeNull();
  });
});
