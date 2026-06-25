/**
 * useRegistryAuthGate — pins the shared auth-gate hook used to put a
 * consistent "Sign in" CTA in front of every registry action.
 *
 * Covers the detection helper plus both entry points (ensureAuthed pre-check,
 * runWithAuth reactive retry) and the cancel path. The owned modal element is
 * not mounted here — we drive the gate by calling the exposed handlers
 * (authGateProps.onAuthenticated / onCancel), which is exactly what the modal
 * does on sign-in / dismiss.
 */
import { renderHook, act } from "@testing-library/react";
import {
  useRegistryAuthGate,
  isRegistryAuthError,
} from "./useRegistryAuthGate";

describe("isRegistryAuthError", () => {
  test("detects object signals", () => {
    expect(isRegistryAuthError({ authRequired: true })).toBe(true);
    expect(isRegistryAuthError({ needsAuth: true })).toBe(true);
    expect(isRegistryAuthError({ status: 401 })).toBe(true);
    expect(isRegistryAuthError({ statusCode: 401 })).toBe(true);
  });
  test("detects message signals (thrown errors / error strings)", () => {
    expect(isRegistryAuthError(new Error("Unauthorized"))).toBe(true);
    expect(
      isRegistryAuthError(new Error("Authentication required — sign in")),
    ).toBe(true);
    expect(isRegistryAuthError("Session expired. Sign in again.")).toBe(true);
    expect(isRegistryAuthError({ error: "Request failed with 401" })).toBe(
      true,
    );
  });
  test("returns false for non-auth and cancel signals", () => {
    expect(isRegistryAuthError(null)).toBe(false);
    expect(isRegistryAuthError({ succeeded: ["a"], failed: [] })).toBe(false);
    expect(isRegistryAuthError(new Error("Network timeout"))).toBe(false);
    expect(isRegistryAuthError({ authCancelled: true })).toBe(false);
  });
});

function mockMainApi(getProfileImpl) {
  global.window = global.window || {};
  window.mainApi = {
    registryAuth: { getProfile: getProfileImpl },
  };
}

describe("useRegistryAuthGate — ensureAuthed", () => {
  test("returns true without opening the gate when the token is valid", async () => {
    mockMainApi(async () => ({ id: "user-1" }));
    const { result } = renderHook(() => useRegistryAuthGate());

    let authed;
    await act(async () => {
      authed = await result.current.ensureAuthed();
    });
    expect(authed).toBe(true);
    expect(result.current.isAuthGateOpen).toBe(false);
  });

  test("opens the gate when invalid, resolves true after sign-in", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    // First act: kick off ensureAuthed and flush getProfile + the gate open.
    let p;
    await act(async () => {
      p = result.current.ensureAuthed({ message: "Sign in to publish." });
    });
    expect(result.current.isAuthGateOpen).toBe(true);

    // Second act: simulate a successful browser sign-in.
    let authed;
    await act(async () => {
      result.current.authGateProps.onAuthenticated();
      authed = await p;
    });
    expect(authed).toBe(true);
    expect(result.current.isAuthGateOpen).toBe(false);
  });

  test("opens the gate when invalid, resolves false on cancel", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    let p;
    await act(async () => {
      p = result.current.ensureAuthed();
    });
    expect(result.current.isAuthGateOpen).toBe(true);

    let authed;
    await act(async () => {
      result.current.authGateProps.onCancel();
      authed = await p;
    });
    expect(authed).toBe(false);
  });
});

describe("useRegistryAuthGate — runWithAuth", () => {
  test("passes a successful action result straight through", async () => {
    mockMainApi(async () => ({ id: "user-1" }));
    const { result } = renderHook(() => useRegistryAuthGate());

    let out;
    await act(async () => {
      out = await result.current.runWithAuth(async () => ({ ok: true }));
    });
    expect(out).toEqual({ ok: true });
    expect(result.current.isAuthGateOpen).toBe(false);
  });

  test("on auth-failure result, prompts then re-runs the action after sign-in", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    let calls = 0;
    const action = async () => {
      calls += 1;
      return calls === 1 ? { needsAuth: true } : { ok: true, attempt: calls };
    };

    let p;
    await act(async () => {
      p = result.current.runWithAuth(action);
    });
    expect(result.current.isAuthGateOpen).toBe(true);

    let out;
    await act(async () => {
      result.current.authGateProps.onAuthenticated();
      out = await p;
    });
    expect(calls).toBe(2);
    expect(out).toEqual({ ok: true, attempt: 2 });
  });

  test("on a thrown auth error, prompts then retries", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    let calls = 0;
    const action = async () => {
      calls += 1;
      if (calls === 1) throw new Error("Unauthorized");
      return { ok: true };
    };

    let p;
    await act(async () => {
      p = result.current.runWithAuth(action);
    });
    expect(result.current.isAuthGateOpen).toBe(true);

    let out;
    await act(async () => {
      result.current.authGateProps.onAuthenticated();
      out = await p;
    });
    expect(calls).toBe(2);
    expect(out).toEqual({ ok: true });
  });

  test("rethrows non-auth errors without opening the gate", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    let threw = null;
    await act(async () => {
      try {
        await result.current.runWithAuth(async () => {
          throw new Error("Disk full");
        });
      } catch (e) {
        threw = e;
      }
    });
    expect(threw).toBeInstanceOf(Error);
    expect(threw.message).toBe("Disk full");
    expect(result.current.isAuthGateOpen).toBe(false);
  });

  test("cancel resolves the action as { authCancelled: true } (no retry)", async () => {
    mockMainApi(async () => null);
    const { result } = renderHook(() => useRegistryAuthGate());

    let calls = 0;
    const action = async () => {
      calls += 1;
      return { needsAuth: true };
    };

    let p;
    await act(async () => {
      p = result.current.runWithAuth(action);
    });
    expect(result.current.isAuthGateOpen).toBe(true);

    let out;
    await act(async () => {
      result.current.authGateProps.onCancel();
      out = await p;
    });
    expect(out).toEqual({ authCancelled: true });
    expect(calls).toBe(1); // initial attempt only; no retry after cancel
  });
});
