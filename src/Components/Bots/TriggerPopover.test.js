import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { TriggerPopover } from "./TriggerPopover";

const source = { id: "planner", name: "Schema Planner" };
const target = { id: "reader", name: "Record Reader" };
const choices = [
  { event: "completed", label: "Completed" },
  { event: "failed", label: "Failed" },
  { event: "tool.algolia.search_index", label: "Algolia HR › search_index" },
  { event: "tool.algolia.recommend", label: "Algolia HR › recommend" },
];

function setup(props = {}) {
  const onSave = jest.fn();
  const onRemove = jest.fn();
  const onCancel = jest.fn();
  render(
    <TriggerPopover
      source={source}
      target={target}
      choices={choices}
      onSave={onSave}
      onRemove={onRemove}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSave, onRemove, onCancel };
}

describe("TriggerPopover (TEAM-014 AC8/AC9)", () => {
  it("adding: names both bots; Completed, Failed, Uses a tool…; saves the choice and note", () => {
    const { onSave } = setup();
    expect(screen.getByText("Run Record Reader")).toBeInTheDocument();
    expect(screen.getByText("after Schema Planner")).toBeInTheDocument();
    expect(screen.getByLabelText("Completed")).toBeChecked();
    expect(screen.getByLabelText("Uses a tool…")).toBeInTheDocument();
    // Tools are in a dropdown, not one radio each.
    expect(screen.queryByRole("combobox", { name: "Tool" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Failed"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Re-plan without images." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add trigger" }));
    expect(onSave).toHaveBeenCalledWith({
      event: "failed",
      label: "Failed",
      note: "Re-plan without images.",
    });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("Uses a tool… shows the tool dropdown and saves the picked tool", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText("Uses a tool…"));
    const select = screen.getByRole("combobox", { name: "Tool" });
    expect(select).toHaveValue("tool.algolia.search_index");
    fireEvent.change(select, { target: { value: "tool.algolia.recommend" } });
    fireEvent.click(screen.getByRole("button", { name: "Add trigger" }));
    expect(onSave).toHaveBeenCalledWith({
      event: "tool.algolia.recommend",
      label: "Algolia HR › recommend",
      note: "",
    });
  });

  it("editing: starts on the current event and note, saves or removes", () => {
    const { onSave, onRemove } = setup({
      mode: "edit",
      initialEvent: "tool.algolia.recommend",
      initialNote: "old",
    });
    expect(screen.getByLabelText("Uses a tool…")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Tool" })).toHaveValue(
      "tool.algolia.recommend",
    );
    expect(screen.getByRole("textbox")).toHaveValue("old");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      event: "tool.algolia.recommend",
      label: "Algolia HR › recommend",
      note: "old",
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("a bot with no tools has no Uses a tool… option", () => {
    setup({ choices: choices.slice(0, 2) });
    expect(screen.queryByLabelText("Uses a tool…")).toBeNull();
  });

  it("shows a loop warning and a save error", () => {
    setup({ loop: true, error: "Couldn't save: nope" });
    expect(screen.getByText(/loops stop after 5 runs/)).toBeInTheDocument();
    expect(screen.getByText("Couldn't save: nope")).toBeInTheDocument();
  });

  it("Cancel closes", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
