/**
 * @jest-environment jsdom
 *
 * UpdateAllWidgetsModal — pins the modal's data display, checkbox
 * selection, select-all/deselect-all controls, and the Confirm path
 * that hands the chosen package names to onConfirm.
 */

jest.mock(
  "@trops/dash-react",
  () => ({
    // Minimal stand-ins so jsdom can render without the real ESM
    // Modal/Button (which pulls fortawesome / context machinery).
    Modal: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null),
    Button: ({ title, onClick, disabled }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {title}
      </button>
    ),
  }),
  { virtual: false },
);

import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { UpdateAllWidgetsModal } from "./UpdateAllWidgetsModal";

const samplePackages = [
  {
    name: "@trops/slack",
    currentVersion: "0.0.700",
    latestVersion: "0.0.735",
    widgetNames: ["SlackListChannels", "SlackChannelMessages"],
  },
  {
    name: "@trops/gmail",
    currentVersion: "0.0.710",
    latestVersion: "0.0.735",
    widgetNames: ["GmailUnreadCount"],
  },
  {
    name: "@trops/notion",
    currentVersion: "0.0.720",
    latestVersion: "0.0.735",
    widgetNames: ["NotionPageSearch", "NotionWidget"],
  },
];

function renderModal(overrides = {}) {
  const props = {
    isOpen: true,
    setIsOpen: jest.fn(),
    packages: samplePackages,
    batchStatus: new Map(),
    isBatchUpdating: false,
    onConfirm: jest.fn().mockResolvedValue({ succeeded: [], failed: [] }),
    ...overrides,
  };
  return { props, ...render(<UpdateAllWidgetsModal {...props} />) };
}

describe("UpdateAllWidgetsModal — display + selection", () => {
  test("renders one row per package with version transition + included widgets", () => {
    renderModal();
    for (const pkg of samplePackages) {
      expect(
        screen.getByTestId(`update-all-package-row-${pkg.name}`),
      ).toBeInTheDocument();
    }
    // Version transition rendered as "current → latest".
    expect(screen.getByText("0.0.700 → 0.0.735")).toBeInTheDocument();
    // Included-widgets line for the multi-widget Slack package.
    expect(
      screen.getByText(/Includes:\s*SlackListChannels,\s*SlackChannelMessages/),
    ).toBeInTheDocument();
  });

  test("every package starts selected (default = select all)", () => {
    renderModal();
    for (const pkg of samplePackages) {
      const cb = screen.getByTestId(`update-all-checkbox-${pkg.name}`);
      expect(cb.checked).toBe(true);
    }
    expect(
      screen.getByTestId("update-all-selected-count").textContent,
    ).toContain(`${samplePackages.length} of ${samplePackages.length}`);
  });

  test("deselecting one package drops it from the selected count and uncheck", () => {
    renderModal();
    const cb = screen.getByTestId("update-all-checkbox-@trops/slack");
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
    expect(
      screen.getByTestId("update-all-selected-count").textContent,
    ).toContain(`${samplePackages.length - 1} of ${samplePackages.length}`);
  });

  test("Deselect all clears every checkbox and disables Confirm", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("update-all-deselect-all"));
    for (const pkg of samplePackages) {
      const cb = screen.getByTestId(`update-all-checkbox-${pkg.name}`);
      expect(cb.checked).toBe(false);
    }
    // Confirm button is rendered with title "Update 0 packages" but
    // disabled — react-testing-library's getByRole catches the
    // disabled attribute.
    const confirmBtn = screen.getByRole("button", { name: /Update 0/ });
    expect(confirmBtn).toBeDisabled();
  });

  test("Select all re-checks everything after a deselect", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("update-all-deselect-all"));
    fireEvent.click(screen.getByTestId("update-all-select-all"));
    for (const pkg of samplePackages) {
      const cb = screen.getByTestId(`update-all-checkbox-${pkg.name}`);
      expect(cb.checked).toBe(true);
    }
  });
});

describe("UpdateAllWidgetsModal — Confirm + onConfirm wiring", () => {
  test("Confirm hands the currently-selected package names to onConfirm", () => {
    const onConfirm = jest
      .fn()
      .mockResolvedValue({ succeeded: [], failed: [] });
    renderModal({ onConfirm });
    // Deselect one to verify selection state is what's forwarded.
    fireEvent.click(screen.getByTestId("update-all-checkbox-@trops/gmail"));
    fireEvent.click(screen.getByRole("button", { name: /Update 2/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const passed = onConfirm.mock.calls[0][0];
    expect(passed.sort()).toEqual(["@trops/notion", "@trops/slack"].sort());
  });

  test("Confirm is a no-op when nothing is selected", () => {
    const onConfirm = jest.fn();
    renderModal({ onConfirm });
    fireEvent.click(screen.getByTestId("update-all-deselect-all"));
    // The button text changes to "Update 0 packages" and is disabled —
    // a click should not fire onConfirm.
    fireEvent.click(screen.getByRole("button", { name: /Update 0/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("during a batch run, checkboxes + controls are disabled", () => {
    renderModal({ isBatchUpdating: true });
    for (const pkg of samplePackages) {
      const cb = screen.getByTestId(`update-all-checkbox-${pkg.name}`);
      expect(cb).toBeDisabled();
    }
    expect(screen.getByTestId("update-all-select-all")).toBeDisabled();
    expect(screen.getByTestId("update-all-deselect-all")).toBeDisabled();
  });
});

describe("UpdateAllWidgetsModal — per-row status pips", () => {
  function statusMap(entries) {
    const m = new Map();
    for (const [name, status, error] of entries) {
      m.set(name, error ? { status, error } : { status });
    }
    return m;
  }

  test("pending → in-progress → done → failed each render with a recognisable label", () => {
    renderModal({
      batchStatus: statusMap([
        ["@trops/slack", "pending"],
        ["@trops/gmail", "in-progress"],
        ["@trops/notion", "done"],
      ]),
    });
    expect(
      screen.getByTestId("update-all-status-@trops/slack-pending"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("update-all-status-@trops/gmail-in-progress"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("update-all-status-@trops/notion-done"),
    ).toBeInTheDocument();
  });

  test("failed status exposes the error string in the title attr (tooltip)", () => {
    renderModal({
      batchStatus: statusMap([["@trops/slack", "failed", "network blip"]]),
    });
    const pip = screen.getByTestId("update-all-status-@trops/slack-failed");
    expect(pip).toBeInTheDocument();
    expect(pip.getAttribute("title")).toBe("network blip");
  });
});

describe("UpdateAllWidgetsModal — empty + close", () => {
  test("renders a graceful empty state when there are no package updates", () => {
    renderModal({ packages: [] });
    expect(
      screen.getByText(/No package updates available/),
    ).toBeInTheDocument();
  });

  test("Cancel button calls setIsOpen(false)", () => {
    const setIsOpen = jest.fn();
    renderModal({ setIsOpen });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});
