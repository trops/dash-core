/**
 * @jest-environment jsdom
 *
 * AppUpdatesModal — pins the three render states (checking, up-to-date,
 * updates-available), the per-row data display, and the action wiring
 * (Remind me later, View dashboards, Update widgets).
 */

jest.mock(
  "@trops/dash-react",
  () => {
    const React = require("react");
    return {
      Modal: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null),
      Button: ({ title, onClick, disabled }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
          {title}
        </button>
      ),
      FontAwesomeIcon: ({ icon }) => <span data-icon={icon} />,
      // Stubs for RegistryAuthModal (mounted inside AppUpdatesModal
      // for the auth-failure flow). Real values aren't needed for
      // these unit tests since we never trigger the auth path here.
      ThemeContext: React.createContext({ currentTheme: {} }),
      getStylesForItem: () => ({}),
      themeObjects: { PANEL: "PANEL", BUTTON: "BUTTON" },
    };
  },
  { virtual: false },
);
// AppUpdatesModal now uses useRegistryAuth (no RegistryAuthPrompt
// import any more). Stub window.mainApi just enough for the hook to
// mount without throwing — these unit tests don't trigger the auth
// path so the stubs never get called.
beforeEach(() => {
  window.mainApi = {
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: true }),
      initiateLogin: jest.fn(),
      pollToken: jest.fn(),
    },
    shell: { openExternal: jest.fn() },
  };
});
afterEach(() => {
  delete window.mainApi;
});

import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AppUpdatesModal } from "./AppUpdatesModal";

const widgetUpdates = [
  {
    name: "@trops/slack",
    currentVersion: "0.0.700",
    latestVersion: "0.0.735",
  },
  {
    name: "@trops/gmail",
    currentVersion: "0.0.710",
    latestVersion: "0.0.735",
  },
];

const dashboardUpdates = [
  {
    name: "Kitchen Sink",
    packageName: "kitchen-sink",
    installedVersion: "1.0.5",
    latestVersion: "1.0.6",
  },
];

function renderModal(overrides = {}) {
  const props = {
    isOpen: true,
    setIsOpen: jest.fn(),
    widgetUpdates: [],
    dashboardUpdates: [],
    isChecking: false,
    hasChecked: false,
    onUpdateWidgets: jest.fn().mockResolvedValue(undefined),
    onOpenDashboardSettings: jest.fn(),
    onRemindLater: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<AppUpdatesModal {...props} />) };
}

describe("AppUpdatesModal — render states", () => {
  test("checking state: spinner copy, no rows, Cancel-only footer", () => {
    renderModal({ isChecking: true });
    expect(
      screen.getByTestId("app-updates-modal-checking"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("app-updates-modal-uptodate"),
    ).not.toBeInTheDocument();
    // "Checking for updates" appears in BOTH the header title and
    // the body copy — getAllByText handles the multiple-match case.
    expect(screen.getAllByText(/Checking for updates/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
  });

  test("up-to-date state: emerald checkmark, 'all up to date' copy, Close button", () => {
    renderModal({ hasChecked: true });
    expect(
      screen.getByTestId("app-updates-modal-uptodate"),
    ).toBeInTheDocument();
    expect(screen.getByText(/You're all up to date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close/ })).toBeInTheDocument();
  });

  test("updates-available state: lists widgets + dashboards with version transitions", () => {
    renderModal({
      hasChecked: true,
      widgetUpdates,
      dashboardUpdates,
    });
    // Header summarises both categories.
    expect(screen.getByText(/3 updates available/)).toBeInTheDocument();
    expect(
      screen.getByText(/2 widget packages and 1 dashboard have newer versions/),
    ).toBeInTheDocument();
    // Per-row widget rendering.
    expect(
      screen.getByTestId("app-updates-modal-widget-row-@trops/slack"),
    ).toHaveTextContent("0.0.700 → 0.0.735");
    expect(
      screen.getByTestId("app-updates-modal-widget-row-@trops/gmail"),
    ).toHaveTextContent("0.0.710 → 0.0.735");
    // Per-row dashboard rendering.
    expect(
      screen.getByTestId("app-updates-modal-dashboard-row-Kitchen Sink"),
    ).toHaveTextContent("1.0.5 → 1.0.6");
  });

  test("singular vs plural copy is correct for one widget update", () => {
    renderModal({
      hasChecked: true,
      widgetUpdates: [widgetUpdates[0]],
    });
    expect(screen.getByText(/1 update available/)).toBeInTheDocument();
    expect(
      screen.getByText(/1 widget package have newer versions/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Update 1 widget/ }),
    ).toBeInTheDocument();
  });

  test("only-widgets vs only-dashboards copy is shown when one category is empty", () => {
    const { rerender, props } = renderModal({
      hasChecked: true,
      widgetUpdates,
    });
    expect(
      screen.getByText(/2 widget packages have newer versions/),
    ).toBeInTheDocument();
    // Now render with only-dashboards updates.
    rerender(
      <AppUpdatesModal
        {...props}
        widgetUpdates={[]}
        dashboardUpdates={dashboardUpdates}
      />,
    );
    expect(
      screen.getByText(/1 dashboard have newer versions/),
    ).toBeInTheDocument();
  });
});

describe("AppUpdatesModal — action wiring", () => {
  test("'Remind me later' calls onRemindLater AND closes the modal", () => {
    const onRemindLater = jest.fn();
    const setIsOpen = jest.fn();
    renderModal({
      hasChecked: true,
      widgetUpdates,
      onRemindLater,
      setIsOpen,
    });
    fireEvent.click(screen.getByRole("button", { name: /Remind me later/ }));
    expect(onRemindLater).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  test("'View dashboards' closes the modal AND calls onOpenDashboardSettings", () => {
    const onOpenDashboardSettings = jest.fn();
    const setIsOpen = jest.fn();
    renderModal({
      hasChecked: true,
      dashboardUpdates,
      onOpenDashboardSettings,
      setIsOpen,
    });
    fireEvent.click(screen.getByRole("button", { name: /View dashboards/ }));
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(onOpenDashboardSettings).toHaveBeenCalledTimes(1);
  });

  test("'Update N widgets' fires onUpdateWidgets and disables itself while in flight", async () => {
    let resolveUpdate;
    const onUpdateWidgets = jest.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolveUpdate = r;
        }),
    );
    renderModal({
      hasChecked: true,
      widgetUpdates,
      onUpdateWidgets,
    });
    const btn = screen.getByRole("button", { name: /Update 2 widgets/ });
    fireEvent.click(btn);
    expect(onUpdateWidgets).toHaveBeenCalledTimes(1);
    // Button flips to "Updating…" + disabled while in flight.
    expect(screen.getByRole("button", { name: /Updating…/ })).toBeDisabled();
    // Let it finish.
    await resolveUpdate();
  });

  test("does NOT render 'View dashboards' button when no dashboard updates", () => {
    renderModal({
      hasChecked: true,
      widgetUpdates,
      // dashboardUpdates defaults to []
    });
    expect(
      screen.queryByRole("button", { name: /View dashboards/ }),
    ).not.toBeInTheDocument();
  });

  test("does NOT render 'Update widgets' button when no widget updates", () => {
    renderModal({
      hasChecked: true,
      dashboardUpdates,
    });
    expect(
      screen.queryByRole("button", { name: /Update \d+ widget/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AppUpdatesModal — checking vs hasChecked transitions", () => {
  test("checking state takes precedence over a stale 'no updates' view", () => {
    // Even with hasChecked=true (from a previous check), an
    // in-flight new check shows the spinner — prevents a flash of
    // wrong content during a manual recheck.
    renderModal({ isChecking: true, hasChecked: true });
    expect(
      screen.getByTestId("app-updates-modal-checking"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("app-updates-modal-uptodate"),
    ).not.toBeInTheDocument();
  });
});

describe("AppUpdatesModal — close clears transient run-result state", () => {
  test("previous run's 'Updated N packages' banner does NOT survive close→reopen", async () => {
    const onUpdateWidgets = jest
      .fn()
      .mockResolvedValue({ succeeded: ["@trops/slack"], failed: [] });
    // Mount in updates-available state and run the batch.
    const { rerender, props } = renderModal({
      hasChecked: true,
      widgetUpdates,
      onUpdateWidgets,
    });
    fireEvent.click(screen.getByRole("button", { name: /Update 2 widgets/ }));
    await screen.findByTestId("app-updates-modal-run-result");
    expect(
      screen.getByTestId("app-updates-modal-run-result"),
    ).toHaveTextContent("Updated 1 package");

    // Close the modal — banner must be cleared.
    rerender(<AppUpdatesModal {...props} isOpen={false} />);
    // Re-open (manual "Check for updates" path) — modal returns to
    // a fresh state, not the stale "Updated 1 package" view from
    // the previous session.
    rerender(
      <AppUpdatesModal
        {...props}
        isOpen={true}
        hasChecked={true}
        widgetUpdates={[]}
      />,
    );
    expect(
      screen.queryByTestId("app-updates-modal-run-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("app-updates-modal-uptodate"),
    ).toBeInTheDocument();
  });
});
