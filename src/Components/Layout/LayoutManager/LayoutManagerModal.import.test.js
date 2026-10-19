/**
 * @jest-environment jsdom
 *
 * Dashboard import never fails silently (consolidation Phase 1e): a file
 * that can't be read, or an import the main process refuses, shows its
 * reason in the modal and keeps it open.
 */

jest.mock("@trops/dash-react", () => {
  const React = require("react");
  const Modal = ({ isOpen, children }) =>
    isOpen ? <div>{children}</div> : null;
  Modal.Footer = ({ children }) => <div>{children}</div>;
  const Panel = ({ children }) => <div>{children}</div>;
  Panel.Body = ({ children }) => <div>{children}</div>;
  const Stepper = ({ children }) => <div>{children}</div>;
  Stepper.Step = ({ children }) => <div>{children}</div>;
  return {
    Modal,
    Panel,
    Stepper,
    Button: ({ title, onClick, disabled }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {title}
      </button>
    ),
    FontAwesomeIcon: () => null,
    Heading: ({ title }) => <h2>{title}</h2>,
    InputText: ({ value }) => <input readOnly value={value} />,
    AlertBanner: ({ message }) => <div role="alert">{message}</div>,
    ThemeContext: React.createContext({
      themes: {},
      themeKey: null,
      loadThemes: () => {},
    }),
  };
});
jest.mock("./Panel/LayoutManagerPicker", () => ({
  LayoutManagerPicker: () => null,
}));
jest.mock("./Panel/CreationMethodPicker", () => ({
  CreationMethodPicker: () => null,
}));
jest.mock("../../Settings/details/DiscoverDashboardsDetail", () => ({
  DiscoverDashboardsDetail: () => null,
}));
jest.mock("../../Settings/details/FolderDetail", () => ({
  FOLDER_ICONS: [],
}));

import React from "react";
import { render, fireEvent, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LayoutManagerModal } from "./LayoutManagerModal";

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

function renderImport(dashboardConfig) {
  window.mainApi = { dashboardConfig };
  const setIsOpen = jest.fn();
  render(
    <LayoutManagerModal
      open
      setIsOpen={setIsOpen}
      initialMethod="import"
      appId="app"
      menuItems={[{ id: 1, name: "General" }]}
    />,
  );
  return setIsOpen;
}

afterEach(() => {
  delete window.mainApi;
});

describe("LayoutManagerModal — import errors are shown", () => {
  it("shows why a chosen file can't be read", async () => {
    renderImport({
      selectDashboardFile: jest.fn().mockResolvedValue({
        success: false,
        error: "No .dashboard.json file found in ZIP archive",
      }),
    });
    fireEvent.click(screen.getByText("Choose File"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No .dashboard.json file found in ZIP archive",
    );
  });

  it("shows why an import was refused and keeps the modal open", async () => {
    const setIsOpen = renderImport({
      selectDashboardFile: jest.fn().mockResolvedValue({
        success: true,
        filePath: "/tmp/dashboard-x.zip",
        dashboardConfig: { name: "Sales" },
      }),
      importDashboardConfig: jest.fn().mockResolvedValue({
        success: false,
        error: "The dashboard's layout is missing",
      }),
    });
    fireEvent.click(screen.getByText("Choose File"));
    await flush();
    fireEvent.click(screen.getByText("Next")); // → Name
    fireEvent.click(screen.getByText("Next")); // → Organize
    fireEvent.click(screen.getByText("Next")); // → Theme
    fireEvent.click(screen.getByText("Save"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The dashboard's layout is missing",
    );
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
  });

  it("shows an unexpected error too", async () => {
    renderImport({
      selectDashboardFile: jest.fn().mockRejectedValue(new Error("IPC down")),
    });
    fireEvent.click(screen.getByText("Choose File"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("IPC down");
  });
});
