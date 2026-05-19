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

// RegistryAuthPrompt under RegistryAuthModal pulls in a lot of
// runtime — mock just enough to verify the modal opens.
jest.mock(
  "./Registry/RegistryAuthPrompt",
  () => ({
    RegistryAuthPrompt: ({ onAuthenticated, onCancel }) => (
      <div data-testid="mock-registry-auth-prompt">
        <button type="button" onClick={onAuthenticated}>
          Pretend sign-in succeeded
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ),
  }),
  { virtual: true },
);

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
  profile = { id: "user-1" },
  installResult = { ok: true },
  installThrows = false,
} = {}) {
  window.mainApi = {
    registry: {
      checkUpdates: jest.fn().mockResolvedValue(sampleWidgetUpdates),
    },
    registryAuth: {
      getProfile: jest.fn().mockResolvedValue(profile),
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

describe("AppUpdatesModal — end-to-end stale-auth path", () => {
  test("getProfile returns null → all installs fail → red banner with Sign in to Registry button", async () => {
    setupMainApi({ profile: null });
    render(<Harness installedWidgets={installed} />);
    await waitFor(() => {
      expect(screen.getByText(/2 updates available/)).toBeInTheDocument();
    });

    const updateBtn = screen.getByRole("button", {
      name: /Update 2 widgets/,
    });
    await act(async () => {
      fireEvent.click(updateBtn);
    });

    // No install IPCs fired — getProfile gated them.
    expect(window.mainApi.widgets.install).not.toHaveBeenCalled();

    // Red banner appeared with the auth CTA.
    await waitFor(() => {
      const banner = screen.getByTestId("app-updates-modal-run-result");
      expect(banner).toHaveTextContent(/Updated 0 of 2; 2 failed/);
    });
    expect(
      screen.getByTestId("app-updates-modal-sign-in-registry"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your registry session expired/),
    ).toBeInTheDocument();

    // Clicking the auth CTA opens the registry auth prompt.
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-updates-modal-sign-in-registry"));
    });
    expect(screen.getByTestId("mock-registry-auth-prompt")).toBeInTheDocument();
  });

  test("after successful auth, banner clears and onAuthenticated fires (so caller can clear needsAuth)", async () => {
    setupMainApi({ profile: null });
    const onAuthClearedSpy = jest.fn();
    render(
      <Harness
        installedWidgets={installed}
        onAuthClearedSpy={onAuthClearedSpy}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 updates available/)).toBeInTheDocument();
    });

    // Force the failed-batch state.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update 2 widgets/ }));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("app-updates-modal-sign-in-registry"),
      ).toBeInTheDocument();
    });

    // Open auth prompt + pretend sign-in succeeded.
    await act(async () => {
      fireEvent.click(screen.getByTestId("app-updates-modal-sign-in-registry"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Pretend sign-in succeeded"));
    });

    // Caller's hook is told to clear needsAuth.
    expect(onAuthClearedSpy).toHaveBeenCalled();
    // The result banner is gone.
    expect(
      screen.queryByTestId("app-updates-modal-run-result"),
    ).not.toBeInTheDocument();
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
    expect(
      screen.getByText(/Some installs failed.*Settings.*Widgets/),
    ).toBeInTheDocument();
  });
});
