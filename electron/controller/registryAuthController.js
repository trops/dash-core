/**
 * registryAuthController.js
 *
 * Manages authentication with the Dash registry service.
 * Uses OAuth device code flow for desktop app authentication.
 *
 * Flow:
 * 1. App calls initiateDeviceFlow() — gets device code + verification URL
 * 2. User opens verification URL in browser, signs in, enters code
 * 3. App polls pollForToken() until authorized
 * 4. Token stored securely via electron-store (encrypted)
 */
const { app } = require("electron");
const path = require("path");

const REGISTRY_BASE_URL =
  process.env.DASH_REGISTRY_API_URL || "https://registry.trops.dev";

// Lazy-load electron-store to avoid issues when not installed
let store = null;
function getStore() {
  if (!store) {
    const Store = require("electron-store");
    store = new Store({
      name: "dash-registry-auth",
      encryptionKey: "dash-registry-v1",
    });
  }
  return store;
}

/**
 * Initiate the OAuth device code flow.
 * Returns the device code, user code, and verification URL.
 *
 * @returns {Promise<Object>} { deviceCode, userCode, verificationUrl, verificationUrlComplete, expiresIn, interval }
 */
async function initiateDeviceFlow() {
  const response = await fetch(`${REGISTRY_BASE_URL}/api/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Device flow initiation failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_uri,
    verificationUrlComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Poll the registry for token after user completes browser auth.
 *
 * @param {string} deviceCode - The device code from initiateDeviceFlow()
 * @returns {Promise<Object>} { status: 'pending' | 'authorized' | 'expired', token?, userId? }
 */
async function pollForToken(deviceCode) {
  const response = await fetch(
    `${REGISTRY_BASE_URL}/api/auth/device?device_code=${encodeURIComponent(deviceCode)}`,
  );

  if (response.status === 428) {
    return { status: "pending" };
  }

  if (response.status === 400) {
    const data = await response.json();
    if (data.error === "expired_token") {
      return { status: "expired" };
    }
    return { status: "pending" };
  }

  if (response.ok) {
    const data = await response.json();

    // Store the token securely
    const s = getStore();
    s.set("accessToken", data.access_token);
    s.set("userId", data.user_id);
    s.set("tokenType", data.token_type);
    s.set("authenticatedAt", new Date().toISOString());

    return {
      status: "authorized",
      token: data.access_token,
      userId: data.user_id,
    };
  }

  throw new Error(`Unexpected response: ${response.status}`);
}

/**
 * Get the stored auth token.
 *
 * @returns {Object|null} { token, userId, authenticatedAt } or null if not authenticated
 */
function getStoredToken() {
  try {
    const s = getStore();
    const token = s.get("accessToken");
    if (!token) return null;

    return {
      token,
      userId: s.get("userId"),
      authenticatedAt: s.get("authenticatedAt"),
    };
  } catch {
    return null;
  }
}

/**
 * Check if the user is authenticated with the registry.
 *
 * @returns {Object} { authenticated: boolean, userId?: string }
 */
function getAuthStatus() {
  const stored = getStoredToken();
  if (!stored) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    userId: stored.userId,
    authenticatedAt: stored.authenticatedAt,
  };
}

/**
 * Get the user's registry profile.
 *
 * @returns {Promise<Object|null>} User profile or null
 */
async function getRegistryProfile() {
  const stored = getStoredToken();
  if (!stored) return null;

  try {
    const response = await fetch(`${REGISTRY_BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${stored.token}`,
      },
    });

    if (response.status === 401) {
      // Token expired or invalid — clear stored credentials
      clearToken();
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    return data.user || null;
  } catch {
    return null;
  }
}

/**
 * Clear stored auth token (logout).
 */
function clearToken() {
  try {
    const s = getStore();
    s.clear();
    console.log("[RegistryAuthController] Token cleared");
  } catch (err) {
    console.error("[RegistryAuthController] Error clearing token:", err);
  }
}

module.exports = {
  initiateDeviceFlow,
  pollForToken,
  getStoredToken,
  getAuthStatus,
  getRegistryProfile,
  clearToken,
};
