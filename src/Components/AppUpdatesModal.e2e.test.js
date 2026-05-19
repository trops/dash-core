/**
 * @jest-environment jsdom
 *
 * AppUpdatesModal — UI integration test that wires the real
 * AppUpdatesModal to the real useAppUpdates / useWidgetUpdates hooks
 * and exercises the full flow (open → click Update → see result
 * banner → click "Sign in to Registry" → auth modal opens). Mocks
 * window.mainApi at the IPC boundary so we can test renderer logic
 * end-to-end without an Electron process.
 *
 * The unit-level tests (AppUpdatesModal.test.js, useAppUpdates.test.js,
 * useWidgetUpdates.test.js) cover individual pieces; this file
 * verifies they compose correctly — which is where the
 * silent-bounce + missing-banner bugs hid.
 */

jest.mock(
  "@trops/dash-react",
  () => {
    const React = require("react");
    const Modal = ({ isOpen, children }) =>
      isOpen ? <div data-testid="mock-modal">{children}</div> : null;
    const Button = ({ title, onClick, disabled }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {title}
      </button>
    );
    const FontAwesomeIcon = ({ icon }) => <span data-icon={icon} />;
    // RegistryAuthModal (used by AppUpdatesModal's auth flow) pulls
    // ThemeContext + getStylesForItem + themeObjects from dash-react.
    // Stub them so the modal can mount without the real theme tree.
    const ThemeContext = React.createContext({ currentTheme: {} });
    const getStylesForItem = () => ({});
    const themeObjects = { PANEL: "PANEL", BUTTON: "BUTTON" };
    return {
      Modal,
      Button,
      FontAwesomeIcon,
      ThemeContext,
      getStylesForItem,
      themeObjects,
    };
  },
  { virtual: false },
);

// The modal now calls useRegistryAuth().initiateAuth() directly,
// which hits window.mainApi.registryAuth.initiateLogin + opens the
// system browser via window.mainApi.shell.openExternal — no
// intermediate RegistryAuthPrompt mount any more. The IPC mock
// below covers both.

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { AppUpdatesModal } from "./AppUpdatesModal";
import { useAppUpdates } from "../hooks/useAppUpdates";

// Test harness: wires AppUpdatesModal to real useAppUpdates so the
// composition is exercised end-to-end. The component-under-test is
// just AppUpdatesModal — useAppUpdates lives in its own test file
// for unit coverage; here we verify they cooperate.
function Harness({ installedWidgets = [], onAuthClearedSpy }) {
  const appUpdates = useAppUpdates({
    appId: "test-app",
    installedWidgets,
  });
  const [open, setOpen] = React.useState(true);
  return (
    <AppUpdatesModal
      isOpen={open}
      setIsOpen={setOpen}
      widgetUpdates={appUpdates.widgetUpdates}
      dashboardUpdates={appUpdates.dashboardUpdates}
      isChecking={appUpdates.isChecking}
      hasChecked={appUpdates.hasChecked}
      needsAuth={appUpdates.needsAuth}
      onUpdateWidgets={async () => {
        return appUpdates.updateWidgetPackages(
          appUpdates.widgetUpdates.map((p) => p.name),
        );
      }}
      onAuthenticated={() => {
        appUpdates.clearNeedsAuth();
        if (onAuthClearedSpy) onAuthClearedSpy();
      }}
    />
  );
}

const installed = [
  {
    name: "SlackListChannels",
    packageId: "@trops/slack",
    source: "installed",
    version: "0.0.700",
  },
  {
    name: "GmailUnreadCount",
    packageId: "@trops/gmail",
    source: "installed",
    version: "0.0.710",
  },
];

const sampleWidgetUpdates = [
  {
    name: "@trops/slack",
    currentVersion: "0.0.700",
    latestVersion: "0.0.735",
    downloadUrl: "https://reg.example/{name}-{version}.zip",
  },
  {
    name: "@trops/gmail",
    currentVersion: "0.0.710",
    latestVersion: "0.0.735",
    downloadUrl: "https://reg.example/{name}-{version}.zip",
  },
];

function setupMainApi({
  authenticated = true,
  profile = { id: "user-1" },
  installResult = { ok: true },
  installThrows = false,
} = {}) {
  // useRegistryAuth.initiateAuth fires initiateLogin + opens the
  // verification URL via shell.openExternal, then polls pollToken on
  // an interval. The poll mock below resolves to "authorized" on the
  // first call so the post-auth test can drive the success path by
  // advancing the timer.
  //
  // The modal now proactively calls registryAuth.getStatus on open;
  // tests pass `authenticated: false` to land on the "Sign in to
  // Registry" footer without needing to click Update first.
  window.mainApi = {
    registry: {
      checkUpdates: jest.fn().mockResolvedValue(sampleWidgetUpdates),
    },
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated }),
      getProfile: jest.fn().mockResolvedValue(profile),
      initiateLogin: jest.fn().mockResolvedValue({
        deviceCode: "DEVICE-CODE",
        userCode: "ABCD-1234",
        verificationUrl: "https://reg.example/device",
        verificationUrlComplete:
          "https://reg.example/device?user_code=ABCD-1234",
        interval: 5,
      }),
      pollToken: jest.fn().mockResolvedValue({ status: "authorized" }),
    },
    shell: {
      openExternal: jest.fn(),
    },
    widgets: {
      install: installThrows
        ? jest.fn().mockRejectedValue(new Error("network down"))
        : jest.fn().mockResolvedValue(installResult),
    },
    dashboardConfig: {
      checkDashboardUpdates: jest
        .fn()
        .mockResolvedValue({ success: true, updates: [] }),
    },
  };
}

afterEach(() => {
  delete window.mainApi;
});

describe("AppUpdatesModal — end-to-end happy path", () => {
  test("user sees 2 updates → clicks Update → install fires per package → green banner appears → list clears", async () => {
    setupMainApi();
    render(<Harness installedWidgets={installed} />);

    // Wait for the initial check to populate the list.
    await waitFor(() => {
      expect(screen.getByText(/2 updates available/)).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("app-updates-modal-widget-row-@trops/slack"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-updates-modal-widget-row-@trops/gmail"),
    ).toBeInTheDocument();

    // Click Update.
    const updateBtn = screen.getByRole("button", {
      name: /Update 2 widgets/,
    });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    // Both install IPC calls fired.
    expect(window.mainApi.widgets.install).toHaveBeenCalledTimes(2);
    expect(window.mainApi.widgets.install).toHaveBeenCalledWith(
      "@trops/slack",
      "https://reg.example/@trops/slack-0.0.735.zip",
    );
    expect(window.mainApi.widgets.install).toHaveBeenCalledWith(
      "@trops/gmail",
      "https://reg.example/@trops/gmail-0.0.735.zip",
    );

    // Green banner appeared with the correct count.
    await waitFor(() => {
      const banner = screen.getByTestId("app-updates-modal-run-result");
      expect(banner).toHaveTextContent("Updated 2 packages.");
    });

    // List cleared — the modal still renders (we don't auto-close
    // it; user reads the banner then clicks Close/Remind).
    expect(screen.queryByText(/2 updates available/)).not.toBeInTheDocument();
  });
});

describe("AppUpdatesModal — proactive sign-in gate", () => {
  test("unauthenticated → footer shows 'Sign in to Registry' from the start, no Update button", async () => {
    setupMainApi({ authenticated: false });
    render(<Harness installedWidgets={installed} />);

    await waitFor(() => {
      expect(screen.getByText(/2 updates available/)).toBeInTheDocument();
    });
    // Subtitle copy explains why we're asking to sign in.
    await waitFor(() => {
      expect(
        screen.getByText(/Sign in to the registry to install 2 widget/),
      ).toBeInTheDocument();
    });
    // Sign-in button is in the footer instead of "Update N widgets".
    await waitFor(() => {
      expect(
        screen.getByTestId("app-updates-modal-sign-in-registry"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Update 2 widgets/ }),
    ).not.toBeInTheDocument();
    // Install was never called — proactive gate, no wasted click.
    expect(window.mainApi.widgets.install).not.toHaveBeenCalled();

    // ONE click fires the device-code flow directly — no intermediate
    // modal. initiateLogin runs, browser opens via shell.openExternal,
    // and the button flips to a "Cancel sign-in" affordance.
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-updates-modal-sign-in-registry"));
    });
    expect(window.mainApi.registryAuth.initiateLogin).toHaveBeenCalledTimes(1);
    expect(window.mainApi.shell.openExternal).toHaveBeenCalledWith(
      "https://reg.example/device?user_code=ABCD-1234",
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("app-updates-modal-cancel-sign-in"),
      ).toBeInTheDocument();
    });
    // User code is surfaced in case the browser didn't auto-open.
    expect(screen.getByText(/ABCD-1234/)).toBeInTheDocument();
  });

  test("after successful poll, footer flips to 'Update N widgets' and onAuthenticated fires", async () => {
    jest.useFakeTimers();
    setupMainApi({ authenticated: false });
    const onAuthClearedSpy = jest.fn();
    render(
      <Harness
        installedWidgets={installed}
        onAuthClearedSpy={onAuthClearedSpy}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("app-updates-modal-sign-in-registry"),
      ).toBeInTheDocument();
    });

    // Kick off the device-code flow.
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-updates-modal-sign-in-registry"));
    });

    // Advance the poll interval so the mock pollToken (which resolves
    // to "authorized") fires. useRegistryAuth uses
    // (flow.interval || 5) * 1000 — our mock returns interval=5.
    await act(async () => {
      jest.advanceTimersByTime(5000);
      // Let the pending promise from pollToken resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Caller's hook is told to clear needsAuth.
    expect(onAuthClearedSpy).toHaveBeenCalled();
    // Footer flipped to the install button.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Update 2 widgets/ }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("app-updates-modal-sign-in-registry"),
    ).not.toBeInTheDocument();
    jest.useRealTimers();
  });
});

describe("AppUpdatesModal — end-to-end install-failure path", () => {
  test("install throws (network down) → red banner without auth CTA, generic 'retry from Widgets' hint", async () => {
    setupMainApi({ installThrows: true });
    render(<Harness installedWidgets={installed} />);
    await waitFor(() => {
      expect(screen.getByText(/2 updates available/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update 2 widgets/ }));
    });

    // Install was called twice but both rejected.
    expect(window.mainApi.widgets.install).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const banner = screen.getByTestId("app-updates-modal-run-result");
      expect(banner).toHaveTextContent(/2 failed/);
    });

    // No auth CTA because needsAuth is false (auth went fine; install
    // failed for a different reason).
    expect(
      screen.queryByTestId("app-updates-modal-sign-in-registry"),
    ).not.toBeInTheDocument();
    // Per-row failure detail now renders the actual error message
    // inline (was previously a generic "Some installs failed; check
    // Settings → Widgets" line that didn't help the user).
    expect(
      screen.getByTestId("app-updates-modal-run-result-details"),
    ).toHaveTextContent(/network down/);
    expect(
      screen.getByTestId("app-updates-modal-run-result-failed-@trops/slack"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-updates-modal-run-result-failed-@trops/gmail"),
    ).toBeInTheDocument();
  });
});
