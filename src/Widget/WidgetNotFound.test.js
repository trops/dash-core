import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WidgetNotFound } from "./WidgetNotFound";

// Mock sub-components to isolate WidgetNotFound tests
jest.mock("../Components/Settings/details/RegistryPackageDetail", () => ({
  RegistryPackageDetail: ({
    widget,
    onInstall,
    isInstalling,
    installError,
  }) => (
    <div data-testid="registry-detail">
      <span>{widget.name}</span>
      <button onClick={onInstall} disabled={isInstalling}>
        Install Package
      </button>
      {installError && <span data-testid="install-error">{installError}</span>}
    </div>
  ),
}));

jest.mock("../Components/Registry/RegistryAuthPrompt", () => ({
  RegistryAuthPrompt: ({ onAuthenticated, onCancel, message }) => (
    <div data-testid="registry-auth-prompt">
      <span>{message}</span>
      <button onClick={onAuthenticated}>Complete Auth</button>
      <button onClick={onCancel}>Cancel Auth</button>
    </div>
  ),
}));

// --- Helpers ---

function mockMainApi() {
  window.mainApi = {
    registry: {
      getPackage: jest.fn().mockResolvedValue(null),
      search: jest.fn().mockResolvedValue({ packages: [] }),
    },
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: false }),
    },
    widgets: {
      install: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const samplePackage = {
  name: "my-widget-pkg",
  displayName: "My Widget Package",
  version: "1.0.0",
  scope: "trops",
  description: "A test widget package",
  downloadUrl: "https://registry.example.com/{name}/{version}",
  widgets: [{ name: "MyWidget" }],
};

// --- Tests ---

beforeEach(() => {
  mockMainApi();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete window.mainApi;
});

describe("WidgetNotFound", () => {
  test("renders Widget Not Found text and component key", () => {
    render(<WidgetNotFound component="MyWidget" />);

    expect(screen.getByText("Widget Not Found")).toBeInTheDocument();
    expect(screen.getByText("MyWidget")).toBeInTheDocument();
    expect(
      screen.getByText("This widget may have been uninstalled or renamed."),
    ).toBeInTheDocument();
  });

  test("renders Find in Registry button", () => {
    render(<WidgetNotFound component="MyWidget" />);

    expect(screen.getByText("Find in Registry")).toBeInTheDocument();
  });

  describe("registry lookup", () => {
    test("clicking Find in Registry shows loading then registry detail on success", async () => {
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      // After async lookup resolves, should show registry detail
      await waitFor(() => {
        expect(screen.getByTestId("registry-detail")).toBeInTheDocument();
        expect(screen.getByText("My Widget Package")).toBeInTheDocument();
      });
    });

    test("scoped component key does exact package lookup", async () => {
      window.mainApi.registry.getPackage.mockResolvedValue(samplePackage);

      render(<WidgetNotFound component="trops.my-widget-pkg.MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      expect(window.mainApi.registry.getPackage).toHaveBeenCalledWith(
        "my-widget-pkg",
      );

      await waitFor(() => {
        expect(screen.getByTestId("registry-detail")).toBeInTheDocument();
      });
    });

    test("shows not available message when package not found", async () => {
      render(<WidgetNotFound component="UnknownWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(
          screen.getByText("This widget is not available in the registry."),
        ).toBeInTheDocument();
      });
    });

    test("shows not available message when lookup throws", async () => {
      window.mainApi.registry.search.mockRejectedValue(
        new Error("network error"),
      );

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(
          screen.getByText("This widget is not available in the registry."),
        ).toBeInTheDocument();
      });
    });
  });

  describe("close button", () => {
    test("X button closes modal", async () => {
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      // Open modal
      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("registry-detail")).toBeInTheDocument();
      });

      // Click X button (icon-xmark from the mock)
      const closeBtn = screen.getByTestId("icon-xmark").closest("button");
      await act(async () => {
        closeBtn.click();
      });

      // Modal should be closed — registry detail no longer visible
      expect(screen.queryByTestId("registry-detail")).not.toBeInTheDocument();
    });

    test("Close button in not-found state closes modal", async () => {
      render(<WidgetNotFound component="UnknownWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(
          screen.getByText("This widget is not available in the registry."),
        ).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByText("Close").click();
      });

      expect(
        screen.queryByText("This widget is not available in the registry."),
      ).not.toBeInTheDocument();
    });
  });

  describe("install auth flow", () => {
    test("handleInstall shows auth prompt when unauthenticated", async () => {
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      // Open modal
      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      // Click Install — should check auth and show auth prompt
      await act(async () => {
        screen.getByText("Install Package").click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("registry-auth-prompt")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Sign in to install this widget from the Dash Registry.",
          ),
        ).toBeInTheDocument();
      });
    });

    test("handleInstall proceeds when authenticated", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByText("Install Package").click();
      });

      // Should call install, not show auth prompt
      await waitFor(() => {
        expect(window.mainApi.widgets.install).toHaveBeenCalledWith(
          "@trops/my-widget-pkg",
          "https://registry.example.com/my-widget-pkg/1.0.0",
        );
      });

      // Modal should close on success
      expect(screen.queryByTestId("registry-detail")).not.toBeInTheDocument();
    });

    test("Unauthorized install error shows auth prompt", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });
      window.mainApi.widgets.install.mockRejectedValue(
        new Error("Unauthorized: token expired"),
      );

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByText("Install Package").click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("registry-auth-prompt")).toBeInTheDocument();
      });
    });

    test("non-auth install error shows error message", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });
      window.mainApi.widgets.install.mockRejectedValue(new Error("Disk full"));

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByText("Install Package").click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("install-error")).toBeInTheDocument();
        expect(screen.getByText("Disk full")).toBeInTheDocument();
      });
    });

    test("handleAuthSuccess clears needsAuth and retries install", async () => {
      // First call: unauthenticated, second call: authenticated
      window.mainApi.registryAuth.getStatus
        .mockResolvedValueOnce({ authenticated: false })
        .mockResolvedValue({ authenticated: true });
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      // Open modal
      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      // Click Install — triggers auth prompt
      await act(async () => {
        screen.getByText("Install Package").click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("registry-auth-prompt")).toBeInTheDocument();
      });

      // Complete auth — should retry install
      await act(async () => {
        screen.getByText("Complete Auth").click();
      });

      await waitFor(() => {
        expect(window.mainApi.widgets.install).toHaveBeenCalled();
      });
    });

    test("auth check failure proceeds to install attempt", async () => {
      window.mainApi.registryAuth.getStatus.mockRejectedValue(
        new Error("API unavailable"),
      );
      window.mainApi.registry.search.mockResolvedValue({
        packages: [samplePackage],
      });

      render(<WidgetNotFound component="MyWidget" />);

      await act(async () => {
        screen.getByText("Find in Registry").click();
      });

      await waitFor(() => {
        expect(screen.getByText("Install Package")).toBeInTheDocument();
      });

      await act(async () => {
        screen.getByText("Install Package").click();
      });

      // Auth check failed, but install should still be attempted
      await waitFor(() => {
        expect(window.mainApi.widgets.install).toHaveBeenCalled();
      });
    });
  });
});
