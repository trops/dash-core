import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardIntentStep } from "./WizardIntentStep";

describe("WizardIntentStep", () => {
  const CATEGORIES = [
    "Reporting",
    "Monitoring",
    "Productivity",
    "Development",
    "Communication",
    "Custom",
  ];

  let dispatch;
  let state;

  beforeEach(() => {
    dispatch = jest.fn();
    state = { intent: [] };
  });

  test("renders all 6 category cards", () => {
    render(<WizardIntentStep state={state} dispatch={dispatch} />);
    for (const label of CATEGORIES) {
      expect(
        screen.getByTestId("selectable-card-" + label),
      ).toBeInTheDocument();
    }
  });

  test("renders the step header", () => {
    render(<WizardIntentStep state={state} dispatch={dispatch} />);
    expect(screen.getByText("What is this dashboard for?")).toBeInTheDocument();
  });

  test("clicking a card dispatches TOGGLE_INTENT", () => {
    render(<WizardIntentStep state={state} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("selectable-card-Reporting"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_INTENT",
      payload: "reporting",
    });
  });

  test("selected intents are reflected via aria-pressed", () => {
    state.intent = ["monitoring", "custom"];
    render(<WizardIntentStep state={state} dispatch={dispatch} />);

    expect(screen.getByTestId("selectable-card-Monitoring")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("selectable-card-Custom")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("selectable-card-Reporting")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("clicking multiple cards dispatches for each", () => {
    render(<WizardIntentStep state={state} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("selectable-card-Reporting"));
    fireEvent.click(screen.getByTestId("selectable-card-Development"));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_INTENT",
      payload: "reporting",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_INTENT",
      payload: "development",
    });
  });
});
