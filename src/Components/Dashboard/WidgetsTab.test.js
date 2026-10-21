import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetsTab } from "./WidgetsTab";

/**
 * Dashboard Config › Widgets (consolidation Phase 3P): in the editor, one
 * widget shows what's set on it and hands off to the edit panel; "All
 * widgets" still edits in bulk. Outside the editor it keeps its form.
 */

const config = {
  "trops.a.Hits": {
    displayName: "Algolia Hits",
    userConfig: { hitTemplate: { type: "text", displayName: "Hit template" } },
  },
};
const hits = {
  id: 5,
  uuid: "7-hits-5",
  component: "trops.a.Hits",
  type: "widget",
  dashboardId: 7,
  userPrefs: { hitTemplate: "<b>{name}</b>" },
  selectedProviders: { algolia: "Store index" },
  listeners: { onQueryChanged: ["trops.a.Box[4].queryChanged"] },
};
const workspace = { id: 7, layout: [hits] };

function renderTab(props = {}) {
  return render(
    <WidgetsTab
      workspace={workspace}
      getWidgetConfig={(c) => config[c] || null}
      stagedPrefs={{}}
      stagePrefField={() => {}}
      stagePrefFieldForAll={() => {}}
      {...props}
    />,
  );
}

test("in the editor: a summary of the widget and Edit in panel", () => {
  const onEditInPanel = jest.fn();
  renderTab({ onEditInPanel });
  const summary = screen.getByTestId("widget-summary");
  expect(summary).toHaveTextContent("Hit template: <b>{name}</b>");
  expect(summary).toHaveTextContent("algolia · Store index");
  expect(summary).toHaveTextContent("1 event");
  fireEvent.click(screen.getByRole("button", { name: "Edit in panel" }));
  expect(onEditInPanel).toHaveBeenCalledWith({
    uuid: "7-hits-5",
    component: "trops.a.Hits",
    itemId: 5,
  });
});

test("outside the editor it keeps its own settings form", () => {
  renderTab();
  expect(screen.queryByTestId("widget-summary")).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit in panel" })).toBeNull();
});
