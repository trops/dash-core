/**
 * PanelEditForm — the settings form in the Create / cell preview and the
 * dashboard's Widgets tab. QA 2026-10-22: number settings had a label and
 * no input, fields written with `label` had no label, select options
 * written as strings had no text, and a select stored the change event.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { PanelEditForm } from "./PanelEditForm";

function setup(userConfig, userPrefs = {}) {
  const onFieldChange = jest.fn();
  const utils = render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <PanelEditForm
        userConfig={userConfig}
        userPrefs={userPrefs}
        onFieldChange={onFieldChange}
      />
    </ThemeContext.Provider>,
  );
  return { ...utils, onFieldChange };
}

test("a number setting has a number input; a change sends a number", () => {
  const { container, onFieldChange } = setup(
    { step: { type: "number", displayName: "Step", min: 1 } },
    { step: 2 },
  );
  expect(screen.getByText("Step")).toBeInTheDocument();
  const input = container.querySelector('input[type="number"]');
  expect(input).not.toBeNull();
  fireEvent.change(input, { target: { value: "5" } });
  expect(onFieldChange).toHaveBeenCalledWith("step", 5);
});

test("a boolean setting is a switch; a click sends true/false", () => {
  const { onFieldChange } = setup(
    { showSeconds: { type: "boolean", displayName: "Show seconds" } },
    { showSeconds: false },
  );
  fireEvent.click(screen.getByRole("switch", { name: "Show seconds" }));
  expect(onFieldChange).toHaveBeenCalledWith("showSeconds", true);
});

test("a field written with label, or with neither, still has a label", () => {
  setup({
    city: { type: "text", label: "City" },
    zone: { type: "text" },
  });
  expect(screen.getByText("City")).toBeInTheDocument();
  expect(screen.getByText("zone")).toBeInTheDocument();
});

test("string and { value, label } options show their text; a change sends the value", () => {
  const { container, onFieldChange } = setup(
    {
      style: {
        type: "select",
        displayName: "Style",
        options: ["big", "small"],
      },
      unit: {
        type: "select",
        displayName: "Unit",
        options: [{ value: "c", label: "Celsius" }],
      },
    },
    { style: "big", unit: "c" },
  );
  const [style, unit] = container.querySelectorAll("select");
  expect(
    Array.from(style.querySelectorAll("option")).map((o) => o.textContent),
  ).toEqual(["big", "small"]);
  expect(unit.querySelector("option").textContent).toBe("Celsius");
  fireEvent.change(style, { target: { value: "small" } });
  expect(onFieldChange).toHaveBeenCalledWith("style", "small");
});
