import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PublishDashboardModal } from "./PublishDashboardModal";

// Mock IconPicker
jest.mock("./IconPicker", () => ({
  IconPicker: ({ selectedIcon }) => (
    <div data-testid="icon-picker">Icon: {selectedIcon}</div>
  ),
}));

// --- Helpers ---

function mockMainApi() {
  window.mainApi = {
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: false }),
      getProfile: jest.fn().mockResolvedValue(null),
      initiateLogin: jest.fn().mockResolvedValue({
        deviceCode: "DEVICE-123",
        userCode: "ABCD-1234",
        verificationUrl: "https://example.com/device",
        verificationUrlComplete: "https://example.com/device?code=ABCD-1234",
        expiresIn: 600,
        interval: 5,
      }),
      pollToken: jest.fn().mockResolvedValue({ status: "pending" }),
      logout: jest.fn().mockResolvedValue(undefined),
    },
    shell: { openExternal: jest.fn() },
    dashboardConfig: {
      prepareDashboardForPublish: jest.fn().mockResolvedValue({
        success: true,
        filePath: "/tmp/dashboard.json",
      }),
    },
  };
}

const defaultProps = {
  isOpen: true,
  setIsOpen: jest.fn(),
  appId: "app-1",
  workspaceId: "ws-1",
  workspaceName: "My Dashboard",
};

function renderModal(props = {}) {
  return render(<PublishDashboardModal {...defaultProps} {...props} />);
}

// --- Tests ---

beforeEach(() => {
  jest.useFakeTimers();
  mockMainApi();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete window.mainApi;
});

describe("PublishDashboardModal", () => {
  describe("Step 0: Account", () => {
    test("shows loading state on mount", () => {
      window.mainApi.registryAuth.getStatus.mockReturnValue(
        new Promise(() => {}),
      );
      renderModal();

      expect(
        screen.getByText("Checking account status..."),
      ).toBeInTheDocument();
    });

    test("shows authenticated user with profile card", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
        userId: "u-1",
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
        email: "john@test.com",
      });

      await act(async () => {
        renderModal();
      });

      expect(
        screen.getByText("You're signed in and ready to publish."),
      ).toBeInTheDocument();
      expect(screen.getByText("John")).toBeInTheDocument();
      expect(screen.getByText("@john")).toBeInTheDocument();
    });

    test("pre-fills author name from profile displayName", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John Doe",
        username: "johndoe",
      });

      await act(async () => {
        renderModal();
      });

      // Click Next to go to Details step
      const nextBtn = screen.getByText("Next");
      await act(async () => {
        nextBtn.click();
      });

      // Author name input should be pre-filled
      const input = screen.getByPlaceholderText("Your name");
      expect(input.value).toBe("John Doe");
    });

    test("shows unauthenticated state with sign-in button", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: false,
      });

      await act(async () => {
        renderModal();
      });

      expect(
        screen.getByText(
          "Sign in to the Dash Registry to publish your dashboard.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Sign in to Registry")).toBeInTheDocument();
    });

    test("Next button is disabled when unauthenticated", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: false,
      });

      await act(async () => {
        renderModal();
      });

      const nextBtn = screen.getByText("Next");
      expect(nextBtn).toBeDisabled();
    });

    test("Next button is enabled when authenticated", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      const nextBtn = screen.getByText("Next");
      expect(nextBtn).not.toBeDisabled();
    });
  });

  describe("Sign-in flow", () => {
    test("shows device code and opens verification URL", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: false,
      });

      await act(async () => {
        renderModal();
      });

      const signInBtn = screen.getByText("Sign in to Registry");
      await act(async () => {
        signInBtn.click();
      });

      expect(window.mainApi.registryAuth.initiateLogin).toHaveBeenCalled();
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
      expect(
        screen.getByText("Waiting for authorization..."),
      ).toBeInTheDocument();
      expect(window.mainApi.shell.openExternal).toHaveBeenCalledWith(
        "https://example.com/device?code=ABCD-1234",
      );
    });

    test("polling updates to authenticated on success", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: false,
      });
      window.mainApi.registryAuth.pollToken.mockResolvedValue({
        status: "authorized",
        token: "tok-123",
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      const signInBtn = screen.getByText("Sign in to Registry");
      await act(async () => {
        signInBtn.click();
      });

      // Advance past the poll interval (5 seconds)
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      // Should now show authenticated state
      await waitFor(() => {
        expect(screen.getByText("John")).toBeInTheDocument();
        expect(screen.getByText("@john")).toBeInTheDocument();
      });
    });
  });

  describe("Sign-out", () => {
    test("clicking sign out reverts to unauthenticated state", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      expect(screen.getByText("John")).toBeInTheDocument();

      const signOutBtn = screen.getByText("Sign out");
      await act(async () => {
        signOutBtn.click();
      });

      expect(window.mainApi.registryAuth.logout).toHaveBeenCalled();
      expect(screen.getByText("Sign in to Registry")).toBeInTheDocument();
    });
  });

  describe("Step count", () => {
    test("footer shows Step X of 5", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();

      // Advance to step 2
      const nextBtn = screen.getByText("Next");
      await act(async () => {
        nextBtn.click();
      });

      expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    });
  });

  describe("Step navigation validation", () => {
    test("cannot advance past Account without auth", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: false,
      });

      await act(async () => {
        renderModal();
      });

      const nextBtn = screen.getByText("Next");
      await act(async () => {
        nextBtn.click();
      });

      // Should still be on step 1 (Account)
      expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    });

    test("cannot advance past Details without author name", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      // Go to Details step
      const nextBtn = screen.getByText("Next");
      await act(async () => {
        nextBtn.click();
      });

      expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();

      // Try to advance without author name — should be disabled
      const nextBtn2 = screen.getByText("Next");
      expect(nextBtn2).toBeDisabled();
    });
  });

  describe("Publish step", () => {
    test("publish step has no auth prompt (authRequired removed)", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });
      window.mainApi.registryAuth.getProfile.mockResolvedValue({
        displayName: "John",
        username: "john",
      });

      await act(async () => {
        renderModal();
      });

      // Step 0 -> 1 (Account -> Details)
      await act(async () => {
        screen.getByText("Next").click();
      });

      // Step 1 -> 2 (Details -> Tags) - author name pre-filled with "John"
      await act(async () => {
        screen.getByText("Next").click();
      });

      // Step 2 -> 3 (Tags -> Icon) - need to select a tag first
      const tagBtn = screen.getByText("productivity");
      await act(async () => {
        tagBtn.click();
      });
      await act(async () => {
        screen.getByText("Next").click();
      });

      // Step 3 -> 4 (Icon -> Publish)
      await act(async () => {
        screen.getByText("Next").click();
      });

      expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
      expect(
        screen.getByText("Review your dashboard details before publishing."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Publish" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Sign in to Registry")).not.toBeInTheDocument();
    });
  });
});
