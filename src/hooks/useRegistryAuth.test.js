import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useRegistryAuth } from "./useRegistryAuth";

// --- Helpers ---

function mockMainApi() {
  window.mainApi = {
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: false }),
      initiateLogin: jest.fn().mockResolvedValue({
        deviceCode: "DEVICE-123",
        userCode: "ABCD-1234",
        verificationUrlComplete: "https://example.com/device?code=ABCD-1234",
        interval: 5,
      }),
      pollToken: jest.fn().mockResolvedValue({ status: "pending" }),
    },
    shell: { openExternal: jest.fn() },
  };
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

describe("useRegistryAuth", () => {
  test("returns correct initial state", () => {
    const { result } = renderHook(() => useRegistryAuth());

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isAuthenticating).toBe(false);
    expect(result.current.authFlow).toBeNull();
    expect(result.current.authError).toBeNull();
    expect(typeof result.current.checkAuth).toBe("function");
    expect(typeof result.current.initiateAuth).toBe("function");
    expect(typeof result.current.cancelAuth).toBe("function");
  });

  describe("checkAuth", () => {
    test("returns true and sets isAuthenticated when authenticated", async () => {
      window.mainApi.registryAuth.getStatus.mockResolvedValue({
        authenticated: true,
      });

      const { result } = renderHook(() => useRegistryAuth());

      let authed;
      await act(async () => {
        authed = await result.current.checkAuth();
      });

      expect(authed).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
    });

    test("returns false when not authenticated", async () => {
      const { result } = renderHook(() => useRegistryAuth());

      let authed;
      await act(async () => {
        authed = await result.current.checkAuth();
      });

      expect(authed).toBe(false);
      expect(result.current.isAuthenticated).toBe(false);
    });

    test("returns false on error", async () => {
      window.mainApi.registryAuth.getStatus.mockRejectedValue(
        new Error("network error"),
      );

      const { result } = renderHook(() => useRegistryAuth());

      let authed;
      await act(async () => {
        authed = await result.current.checkAuth();
      });

      expect(authed).toBe(false);
    });
  });

  describe("initiateAuth", () => {
    test("calls initiateLogin, opens browser URL, and starts polling", async () => {
      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      expect(window.mainApi.registryAuth.initiateLogin).toHaveBeenCalled();
      expect(window.mainApi.shell.openExternal).toHaveBeenCalledWith(
        "https://example.com/device?code=ABCD-1234",
      );
      expect(result.current.isAuthenticating).toBe(true);
      expect(result.current.authFlow).toEqual({
        deviceCode: "DEVICE-123",
        userCode: "ABCD-1234",
        verificationUrlComplete: "https://example.com/device?code=ABCD-1234",
        interval: 5,
      });
    });

    test("sets authError when initiateLogin fails", async () => {
      window.mainApi.registryAuth.initiateLogin.mockRejectedValue(
        new Error("network"),
      );

      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      expect(result.current.authError).toBe(
        "Could not reach the registry. Check your connection and try again.",
      );
      expect(result.current.isAuthenticating).toBe(false);
    });
  });

  describe("polling", () => {
    test("authorized result clears interval and sets isAuthenticated", async () => {
      window.mainApi.registryAuth.pollToken.mockResolvedValue({
        status: "authorized",
        token: "tok-123",
      });

      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      expect(result.current.isAuthenticating).toBe(true);

      // Advance past the poll interval (5 seconds)
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isAuthenticating).toBe(false);
      expect(result.current.authFlow).toBeNull();
    });

    test("authorized result calls onAuthorized callback", async () => {
      window.mainApi.registryAuth.pollToken.mockResolvedValue({
        status: "authorized",
      });

      const onAuthorized = jest.fn();
      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth(onAuthorized);
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(onAuthorized).toHaveBeenCalled();
    });

    test("expired result clears interval and sets authError", async () => {
      window.mainApi.registryAuth.pollToken.mockResolvedValue({
        status: "expired",
      });

      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isAuthenticating).toBe(false);
      expect(result.current.authError).toBe(
        "Authorization expired. Please try again.",
      );
      expect(result.current.authFlow).toBeNull();
    });

    test("poll error clears interval and stops authenticating", async () => {
      window.mainApi.registryAuth.pollToken.mockRejectedValue(
        new Error("poll failed"),
      );

      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isAuthenticating).toBe(false);
    });

    test("pending result keeps polling", async () => {
      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      // First poll — still pending
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isAuthenticating).toBe(true);
      expect(window.mainApi.registryAuth.pollToken).toHaveBeenCalledTimes(1);

      // Second poll — still pending
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isAuthenticating).toBe(true);
      expect(window.mainApi.registryAuth.pollToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancelAuth", () => {
    test("clears interval and resets state", async () => {
      const { result } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      expect(result.current.isAuthenticating).toBe(true);

      act(() => {
        result.current.cancelAuth();
      });

      expect(result.current.isAuthenticating).toBe(false);
      expect(result.current.authFlow).toBeNull();

      // Advancing timers should not cause another poll
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(window.mainApi.registryAuth.pollToken).not.toHaveBeenCalled();
    });
  });

  describe("unmount cleanup", () => {
    test("clears interval on unmount", async () => {
      const { result, unmount } = renderHook(() => useRegistryAuth());

      await act(async () => {
        await result.current.initiateAuth();
      });

      expect(result.current.isAuthenticating).toBe(true);

      unmount();

      // Advancing timers after unmount should not cause errors
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(window.mainApi.registryAuth.pollToken).not.toHaveBeenCalled();
    });
  });
});
