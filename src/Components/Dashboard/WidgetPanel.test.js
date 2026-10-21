import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetPanel } from "./WidgetPanel";

/**
 * The edit panel's widget panel (consolidation Phase 3P): Settings,
 * Connections, Listens for and Advanced, read top to bottom, each saying so
 * when empty; raw settings fold away; a request opens and shows a section;
 * every change goes to onCommit for the dashboard's Save.
 */

let mockConfig = null;
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => mockConfig },
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelEditItem", () => ({
  __esModule: true,
  default: ({ item, workspace, onUpdate }) => (
    <button
      type="button"
      onClick={() =>
        onUpdate(
          { ...item, userPrefs: { title: "Edited" } },
          {
            ...workspace,
            layout: [{ ...item, userPrefs: { title: "Edited" } }],
          },
        )
      }
    >
      settings form
    </button>
  ),
}));
jest.mock("../Layout/Builder/Modal/Panel", () => ({
  PanelEditItemProviders: () => <div>connections form</div>,
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelCode", () => ({
  __esModule: true,
  default: () => <div>raw settings editor</div>,
}));
jest.mock("./ListensFor", () => ({
  ListensFor: ({ name }) => <div>listens for {name}</div>,
}));

const item = {
  id: 3,
  uuid: "7-c-3",
  component: "ai-built.counter.Counter",
  type: "widget",
  userPrefs: { title: "My Counter" },
};
const workspace = { id: 7, layout: [item] };

beforeEach(() => {
  mockConfig = null;
});

test("an empty widget says so in each section", () => {
  mockConfig = { userConfig: {} };
  render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
  expect(screen.getByText("Counter has no settings.")).toBeInTheDocument();
  expect(screen.getByText("Counter doesn't use any.")).toBeInTheDocument();
  expect(screen.getByText("listens for Counter")).toBeInTheDocument();
  expect(screen.queryByText("raw settings editor")).toBeNull();
});

test("a full widget shows its settings and connections", () => {
  mockConfig = {
    userConfig: { title: { type: "text" } },
    providers: [{ type: "algolia", providerClass: "credential" }],
  };
  render(<WidgetPanel item={item} workspace={workspace} name="Hits" />);
  expect(screen.getByText("settings form")).toBeInTheDocument();
  expect(screen.getByText("connections form")).toBeInTheDocument();
  for (const label of ["Settings", "Connections", "Listens for", "Advanced"]) {
    expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
  }
});

test("raw settings fold away under Advanced", () => {
  render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
  fireEvent.click(screen.getByRole("button", { name: "Show raw settings" }));
  expect(screen.getByText("raw settings editor")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide raw settings" }));
  expect(screen.queryByText("raw settings editor")).toBeNull();
});

test("a request for the raw settings opens them", () => {
  render(
    <WidgetPanel
      item={item}
      workspace={workspace}
      name="Counter"
      focus={{ section: "code", request: 1 }}
    />,
  );
  expect(screen.getByText("raw settings editor")).toBeInTheDocument();
});

test("a change goes to onCommit, for the dashboard's Save", () => {
  mockConfig = { userConfig: { title: { type: "text" } } };
  const onCommit = jest.fn();
  render(
    <WidgetPanel
      item={item}
      workspace={workspace}
      name="Counter"
      onCommit={onCommit}
    />,
  );
  fireEvent.click(screen.getByText("settings form"));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][0].layout[0].userPrefs).toEqual({
    title: "Edited",
  });
});
