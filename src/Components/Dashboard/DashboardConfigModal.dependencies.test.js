/**
 * Dashboard Config › Dependencies counts each widget once (QA 2026-10-24):
 * on a paged dashboard the top-level layout mirrors a page — a copy after a
 * load — so walking both listed "Notepad ×2" for one Notepad.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { DashboardConfigModal } from "./DashboardConfigModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: {
    config: jest.fn().mockReturnValue(null),
    resolve: jest.fn().mockReturnValue({ name: "Notepad" }),
  },
}));

const notepad = () => ({
  id: 2,
  component: "trops.dash-samples.NotepadWidget",
  dashboardId: 7,
});

function renderDeps(workspace) {
  window.mainApi = {
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listToolSources: jest.fn().mockResolvedValue([]),
    },
  };
  render(
    <DashboardConfigModal
      isOpen
      setIsOpen={() => {}}
      workspace={workspace}
      appProviders={{}}
      getWidgetRequirements={() => []}
      getWidgetConfig={() => ({ name: "Notepad" })}
      onSaveBindings={() => {}}
      onSaveListeners={() => {}}
      initialTab="dependencies"
    />,
  );
}

afterEach(() => {
  delete window.mainApi;
});

describe("Dependencies — each widget once", () => {
  it("a paged dashboard whose top-level layout is a copy of its page", () => {
    renderDeps({
      id: 7,
      name: "Notes",
      layout: [notepad()],
      pages: [{ id: "p1", name: "Main", layout: [notepad()] }],
    });
    expect(screen.getByText(/Notepad/)).toBeInTheDocument();
    expect(screen.queryByText(/×2/)).toBeNull();
  });

  it("two Notepads on two pages are both counted", () => {
    renderDeps({
      id: 7,
      name: "Notes",
      layout: [notepad()],
      pages: [
        { id: "p1", name: "Main", layout: [notepad()] },
        { id: "p2", name: "More", layout: [{ ...notepad(), id: 5 }] },
      ],
    });
    expect(screen.getByText(/Notepad ×2/)).toBeInTheDocument();
  });

  it("a dashboard without pages still lists its widgets", () => {
    renderDeps({ id: 7, name: "Notes", layout: [notepad()] });
    expect(screen.getByText(/Notepad/)).toBeInTheDocument();
    expect(screen.queryByText(/×2/)).toBeNull();
  });
});
