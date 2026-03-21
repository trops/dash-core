import { useState, useRef, useEffect, useCallback } from "react";

/**
 * useRegistryAuth — reusable hook for device-code OAuth against the Dash Registry.
 *
 * Encapsulates the full auth state machine: check status, initiate login,
 * poll for token, and cancel.  Cleans up the poll interval on unmount.
 *
 * @returns {{
 *   isAuthenticated: boolean,
 *   isAuthenticating: boolean,
 *   authFlow: { userCode: string, verificationUrlComplete: string } | null,
 *   authError: string | null,
 *   checkAuth: () => Promise<boolean>,
 *   initiateAuth: () => Promise<void>,
 *   cancelAuth: () => void,
 * }}
 */
export function useRegistryAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authFlow, setAuthFlow] = useState(null);
  const [authError, setAuthError] = useState(null);
  const pollIntervalRef = useRef(null);
  const onAuthorizedRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const status = await window.mainApi.registryAuth.getStatus();
      const authed = !!status?.authenticated;
      setIsAuthenticated(authed);
      return authed;
    } catch {
      return false;
    }
  }, []);

  const cancelAuth = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsAuthenticating(false);
    setAuthFlow(null);
  }, []);

  const initiateAuth = useCallback(
    async (onAuthorized) => {
      setAuthError(null);
      onAuthorizedRef.current = onAuthorized || null;

      try {
        const flow = await window.mainApi.registryAuth.initiateLogin();
        setAuthFlow(flow);

        if (flow.verificationUrlComplete) {
          window.mainApi.shell.openExternal(flow.verificationUrlComplete);
        }

        setIsAuthenticating(true);
        const interval = (flow.interval || 5) * 1000;
        pollIntervalRef.current = setInterval(async () => {
          try {
            const pollResult = await window.mainApi.registryAuth.pollToken(
              flow.deviceCode,
            );
            if (pollResult.status === "authorized") {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setIsAuthenticating(false);
              setAuthFlow(null);
              setIsAuthenticated(true);
              if (onAuthorizedRef.current) {
                onAuthorizedRef.current();
              }
            } else if (pollResult.status === "expired") {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setIsAuthenticating(false);
              setAuthFlow(null);
              setAuthError("Authorization expired. Please try again.");
            }
          } catch {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setIsAuthenticating(false);
          }
        }, interval);
      } catch (err) {
        console.error("[useRegistryAuth] Sign-in error:", err);
        setAuthError(
          "Could not reach the registry. Check your connection and try again.",
        );
      }
    },
    [cancelAuth],
  );

  return {
    isAuthenticated,
    isAuthenticating,
    authFlow,
    authError,
    checkAuth,
    initiateAuth,
    cancelAuth,
  };
}
