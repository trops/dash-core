import React, { useState, useRef, useCallback, useEffect } from "react";
import { RegistryAuthModal } from "../Components/Registry/RegistryAuthModal";

/**
 * useRegistryAuthGate — one reusable place to gate any registry action on
 * authentication and surface a "Sign in" CTA when the session is missing or
 * expired.
 *
 * The problem it solves: across publish/update/install flows we kept
 * re-implementing "check auth → if not signed in, show a prompt → retry the
 * action." Each copy detected auth failure differently (thrown "unauthorized",
 * `{ authRequired }`, a null profile, an HTTP 401) and some forgot to prompt at
 * all — so an expired token silently failed the action with a generic error.
 * This hook centralizes detection, the CTA, and the retry.
 *
 * Two entry points:
 *   - ensureAuthed()  — PRE-CHECK. Validates the token against the registry
 *     (getProfile, which refreshes transparently) BEFORE doing expensive work.
 *     If invalid, pops the sign-in modal and resolves true/false once the user
 *     signs in or cancels. Use this before publish/update — it avoids doing
 *     work that would 401, and avoids retry-after-partial-work hazards.
 *   - runWithAuth(action) — REACTIVE. Runs the action; if it fails on auth,
 *     pops the modal and re-runs the SAME action once after sign-in. Use this
 *     where a pre-check isn't practical and the action is safe to retry.
 *
 * The modal is owned by the hook and returned as `authGate` (a ready element)
 * — render it LAST in your component so it always stacks ABOVE other modals
 * (the old bug: the sign-in modal rendered behind the "update failed" modal
 * and the user never saw it).
 *
 * @returns {{
 *   ensureAuthed: (opts?: {message?: string}) => Promise<boolean>,
 *   runWithAuth: (action: Function, opts?: {message?: string}) => Promise<any>,
 *   authGate: React.ReactElement,
 *   authGateProps: object,
 *   isAuthGateOpen: boolean,
 * }}
 */

const DEFAULT_MESSAGE =
  "Your registry session has expired or you're not signed in. Sign in to continue.";

/**
 * Classify whether an error or result value represents an auth failure. Kept
 * deliberately broad because the registry surface is heterogeneous: some calls
 * throw, some return `{ authRequired }` / `{ needsAuth }` / a 401 status, and
 * some return null. Exported for direct use + unit testing.
 */
export function isRegistryAuthError(x) {
  if (!x) return false;
  if (typeof x === "object") {
    // An explicit user-cancel from a gate is NOT an auth error.
    if (x.authCancelled === true) return false;
    if (x.authRequired === true || x.needsAuth === true) return true;
    if (x.status === 401 || x.statusCode === 401) return true;
  }
  const msg = (
    typeof x === "string" ? x : x.message || x.error || ""
  ).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("unauthorized") ||
    msg.includes("authentication required") ||
    msg.includes("authentication is required") ||
    msg.includes("sign in to the registry") ||
    msg.includes("not signed in") ||
    msg.includes("session expired") ||
    msg.includes("401")
  );
}

export function useRegistryAuthGate() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  // The in-flight gate request: { kind: "run"|"ensure", action?, resolve, reject }.
  const pendingRef = useRef(null);
  // Guards against double-settling (auth success vs. backdrop dismiss racing).
  const settledRef = useRef(true);

  const openGate = useCallback((pending, msg) => {
    pendingRef.current = pending;
    settledRef.current = false;
    setMessage(msg || DEFAULT_MESSAGE);
    setOpen(true);
  }, []);

  const settle = useCallback(async (viaAuth) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    if (!pending) return;
    if (pending.kind === "ensure") {
      pending.resolve(!!viaAuth);
      return;
    }
    // kind === "run"
    if (!viaAuth) {
      pending.resolve({ authCancelled: true });
      return;
    }
    try {
      pending.resolve(await pending.action());
    } catch (err) {
      pending.reject(err);
    }
  }, []);

  const handleAuthenticated = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    settle(true);
  }, [settle]);

  const handleCancel = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    settle(false);
  }, [settle]);

  // Backdrop / Escape dismiss closes the modal via setIsOpen(false) without
  // firing onCancel. Catch that here so the pending promise still settles (as
  // a cancel). Runs AFTER handleAuthenticated (which sets settledRef
  // synchronously), so a successful sign-in is never mis-read as a cancel.
  useEffect(() => {
    if (!open && pendingRef.current && !settledRef.current) {
      settledRef.current = true;
      settle(false);
    }
  }, [open, settle]);

  const ensureAuthed = useCallback(
    async (opts = {}) => {
      let profile = null;
      try {
        profile = await window.mainApi?.registryAuth?.getProfile?.();
      } catch {
        profile = null;
      }
      if (profile) return true;
      return new Promise((resolve) => {
        openGate({ kind: "ensure", resolve }, opts.message);
      });
    },
    [openGate],
  );

  const runWithAuth = useCallback(
    async (action, opts = {}) => {
      let result;
      try {
        result = await action();
      } catch (err) {
        if (!isRegistryAuthError(err)) throw err;
        return new Promise((resolve, reject) => {
          openGate({ kind: "run", action, resolve, reject }, opts.message);
        });
      }
      if (isRegistryAuthError(result)) {
        return new Promise((resolve, reject) => {
          openGate({ kind: "run", action, resolve, reject }, opts.message);
        });
      }
      return result;
    },
    [openGate],
  );

  const authGateProps = {
    isOpen: open,
    setIsOpen: setOpen,
    onAuthenticated: handleAuthenticated,
    onCancel: handleCancel,
    message,
  };

  const authGate = <RegistryAuthModal {...authGateProps} />;

  return {
    ensureAuthed,
    runWithAuth,
    authGate,
    authGateProps,
    isAuthGateOpen: open,
  };
}
