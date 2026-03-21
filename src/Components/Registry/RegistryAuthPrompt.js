import React, { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { useRegistryAuth } from "../../hooks/useRegistryAuth";

/**
 * RegistryAuthPrompt — reusable device-code auth prompt for the Dash Registry.
 *
 * Checks auth on mount; if already authenticated calls onAuthenticated immediately.
 * Otherwise renders a sign-in button, polling state, or error with retry.
 *
 * @param {Object} props
 * @param {Function} props.onAuthenticated - Called when auth succeeds
 * @param {Function} [props.onCancel] - If provided, shows a cancel button
 * @param {string} [props.message] - Message shown above the sign-in button
 */
export const RegistryAuthPrompt = ({
  onAuthenticated,
  onCancel = null,
  message = "Sign in to install from the Dash Registry.",
}) => {
  const {
    isAuthenticating,
    authFlow,
    authError,
    checkAuth,
    initiateAuth,
    cancelAuth,
  } = useRegistryAuth();
  const checkedRef = useRef(false);

  // Check auth on mount — if already authenticated, short-circuit
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    checkAuth().then((authed) => {
      if (authed && onAuthenticated) onAuthenticated();
    });
  }, [checkAuth, onAuthenticated]);

  function handleSignIn() {
    initiateAuth(() => {
      if (onAuthenticated) onAuthenticated();
    });
  }

  function handleCancel() {
    cancelAuth();
    if (onCancel) onCancel();
  }

  // Polling state: show user code
  if (authFlow && isAuthenticating) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
          <p className="text-xs text-blue-300/90">
            Enter this code in your browser:
          </p>
          <div className="text-center">
            <span className="text-2xl font-mono font-bold tracking-widest text-white">
              {authFlow.userCode}
            </span>
          </div>
          <p className="text-xs text-blue-300/70 text-center">
            Waiting for authorization — install will resume automatically...
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={handleCancel}
            className="self-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  // Default: not-started / error state
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <FontAwesomeIcon
            icon="lock"
            className="h-3.5 w-3.5 text-yellow-400 mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-yellow-300/90">{message}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        className="px-4 py-2 rounded-lg text-sm bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
      >
        Sign in to Registry
      </button>
      {authError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <FontAwesomeIcon
              icon="circle-xmark"
              className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0"
            />
            <span className="text-xs text-red-300/90">{authError}</span>
          </div>
        </div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={handleCancel}
          className="self-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
};
