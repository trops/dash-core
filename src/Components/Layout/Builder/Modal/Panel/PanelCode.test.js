import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import PanelCode from "./PanelCode";

/**
 * A widget's raw settings ("Code"): an edit is written back into its
 * dashboard's layout, so committing the workspace keeps it (consolidation
 * Phase 3P — it used to hand back the workspace unchanged, and the edit was
 * lost on Save).
 */

jest.mock("@trops/dash-react", () => ({
  CodeEditorVS: ({ code, onChange }) => (
    <textarea
      data-testid="code"
      value={code}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const item = {
  id: 2,
  component: "ai-built.counter.Counter",
  type: "widget",
  userPrefs: { title: "My Counter" },
};
const other = { id: 1, component: "LayoutGridContainer", type: "grid" };
const workspace = { id: 7, name: "Counter Test", layout: [other, item] };

test("an edit goes into the layout it hands back", () => {
  const onUpdate = jest.fn();
  render(<PanelCode item={item} workspace={workspace} onUpdate={onUpdate} />);
  const edited = { ...item, userPrefs: { title: "Clicks" } };
  fireEvent.change(screen.getByTestId("code"), {
    target: { value: JSON.stringify(edited) },
  });
  expect(onUpdate).toHaveBeenCalledTimes(1);
  const [nextItem, nextWorkspace] = onUpdate.mock.calls[0];
  expect(nextItem.userPrefs).toEqual({ title: "Clicks" });
  const inLayout = nextWorkspace.layout.find((i) => i.id === 2);
  expect(inLayout.userPrefs).toEqual({ title: "Clicks" });
  // The rest of the layout is untouched, and the original isn't mutated.
  expect(nextWorkspace.layout.find((i) => i.id === 1)).toBe(other);
  expect(workspace.layout[1].userPrefs).toEqual({ title: "My Counter" });
});

test("malformed JSON changes nothing", () => {
  const onUpdate = jest.fn();
  render(<PanelCode item={item} workspace={workspace} onUpdate={onUpdate} />);
  fireEvent.change(screen.getByTestId("code"), {
    target: { value: "{ not json" },
  });
  expect(onUpdate).not.toHaveBeenCalled();
});
