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
  process.env.DASH_REGISTRY_API_URL ||
  "https://main.d919rwhuzp7rj.amplifyapp.com";

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

    // Persist the Cognito refresh token (+ the client id / region needed to
    // use it) when the registry forwarded it. This is what lets the app mint
    // fresh access tokens directly against Cognito on expiry instead of
    // silently 401-ing every registry call after ~1h. Older registries (or a
    // browser whose Amplify storage didn't surface the refresh token) omit
    // these — the app then falls back to re-authenticating on expiry.
    if (data.refresh_token) s.set("refreshToken", data.refresh_token);
    if (data.cognito_client_id)
      s.set("cognitoClientId", data.cognito_client_id);
    if (data.cognito_region) s.set("cognitoRegion", data.cognito_region);

    return {
      status: "authorized",
      token: data.access_token,
      userId: data.user_id,
    };
  }

  throw new Error(`Unexpected response: ${response.status}`);
}

/**
 * Decode a JWT's `exp` claim (no signature verification — we only use it to
 * decide whether to pre-emptively refresh) and report whether it's expired,
 * with a 30s skew so we refresh slightly early rather than racing expiry.
 * Returns false on any parse failure so a malformed token falls through to
 * the normal request (and the reactive 401 path) rather than forcing churn.
 */
function isAccessTokenExpired(token) {
  try {
    const seg = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(seg, "base64").toString("utf8"));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000 - 30000;
  } catch {
    return false;
  }
}

/**
 * Mint a fresh access token from the stored Cognito refresh token via
 * Cognito's `InitiateAuth` (REFRESH_TOKEN_AUTH). The user-pool client is
 * public (no secret), so no SECRET_HASH is required. Returns true and updates
 * the stored access token on success; false if there's no refresh token or
 * Cognito rejects it (expired/revoked — caller decides whether to sign out).
 */
async function refreshAccessToken() {
  const s = getStore();
  const refreshToken = s.get("refreshToken");
  const clientId = s.get("cognitoClientId");
  const region = s.get("cognitoRegion") || "us-east-1";
  if (!refreshToken || !clientId) return false;

  try {
    const response = await fetch(
      `https://cognito-idp.${region}.amazonaws.com/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
        body: JSON.stringify({
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      },
    );
    if (!response.ok) return false;

    const data = await response.json();
    const result = data.AuthenticationResult;
    if (!result || !result.AccessToken) return false;

    s.set("accessToken", result.AccessToken);
    s.set("authenticatedAt", new Date().toISOString());
    // REFRESH_TOKEN_AUTH normally does NOT return a new refresh token, but
    // honor one if rotation is ever enabled.
    if (result.RefreshToken) s.set("refreshToken", result.RefreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticated fetch with transparent token refresh.
 *
 * - Injects the stored access token as a Bearer header (when present).
 * - Pre-emptively refreshes when the access token is already expired.
 * - On a 401, attempts one refresh + retry before giving up.
 *
 * Returns a real `Response`. Callers that need to react to a still-401
 * (refresh failed → truly signed out) check `response.status` and decide
 * whether to clear credentials. Anonymous callers (no token) just get an
 * unauthenticated request.
 */
async function authedFetch(url, options = {}) {
  let stored = getStoredToken();

  if (stored && isAccessTokenExpired(stored.token)) {
    if (await refreshAccessToken()) stored = getStoredToken();
  }

  const withAuth = (tok) => {
    const headers = { ...(options.headers || {}) };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return fetch(url, { ...options, headers });
  };

  let response = await withAuth(stored && stored.token);
  if (response.status === 401 && stored) {
    if (await refreshAccessToken()) {
      const fresh = getStoredToken();
      response = await withAuth(fresh && fresh.token);
    }
  }
  return response;
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
    const response = await authedFetch(`${REGISTRY_BASE_URL}/api/auth/me`);

    if (response.status === 401) {
      // Still 401 after authedFetch tried to refresh — the refresh token is
      // gone/expired too, so the session is genuinely over. Clear it.
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

/**
 * Update the authenticated user's registry profile.
 *
 * @param {Object} updates - Fields to update (e.g. { displayName })
 * @returns {Promise<Object|null>} Updated user or null on 401
 */
async function updateRegistryProfile(updates) {
  const stored = getStoredToken();
  if (!stored) return null;

  try {
    const response = await authedFetch(`${REGISTRY_BASE_URL}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    if (response.status === 401) {
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
 * Get the authenticated user's published packages.
 *
 * @returns {Promise<Object|null>} { packages: [...] } or null
 */
async function getRegistryPackages() {
  const stored = getStoredToken();
  if (!stored) return null;

  try {
    const response = await authedFetch(
      `${REGISTRY_BASE_URL}/api/auth/me/packages`,
    );

    if (response.status === 401) {
      clearToken();
      return null;
    }
    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Update a published package's metadata.
 *
 * @param {string} scope - Package scope (e.g. "@trops")
 * @param {string} name - Package name
 * @param {Object} updates - Fields to update (displayName, description, category, tags, visibility)
 * @returns {Promise<Object|null>} Updated package or null
 */
async function updateRegistryPackage(scope, name, updates) {
  const stored = getStoredToken();
  if (!stored) return null;

  try {
    const response = await authedFetch(
      `${REGISTRY_BASE_URL}/api/packages/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      },
    );

    if (response.status === 401) {
      clearToken();
      return null;
    }
    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Delete a published package from the registry.
 *
 * @param {string} scope - Package scope (e.g. "@trops")
 * @param {string} name - Package name
 * @returns {Promise<Object|null>} Response or null
 */
async function deleteRegistryPackage(scope, name) {
  const stored = getStoredToken();
  if (!stored) {
    return {
      success: false,
      error: "Not signed in to the registry.",
      status: 0,
    };
  }

  try {
    const response = await authedFetch(
      `${REGISTRY_BASE_URL}/api/packages/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );

    if (response.status === 401) {
      clearToken();
      return {
        success: false,
        error: "Session expired. Sign in again and retry.",
        status: 401,
      };
    }

    // Read body text once so we can either parse JSON on success or
    // surface the raw server error message on failure.
    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      let serverMsg = bodyText;
      try {
        const parsed = JSON.parse(bodyText);
        serverMsg = parsed?.error || parsed?.message || bodyText;
      } catch {
        // bodyText is already a plain string; use it as-is.
      }
      return {
        success: false,
        error:
          serverMsg ||
          `Registry returned ${response.status} ${response.statusText || ""}`.trim(),
        status: response.status,
      };
    }

    // Success path — 204 No Content is common; JSON is optional.
    if (response.status === 204 || !bodyText.trim()) {
      return { success: true };
    }
    try {
      return { success: true, ...JSON.parse(bodyText) };
    } catch {
      return { success: true };
    }
  } catch (err) {
    return {
      success: false,
      error: `Network error: ${err?.message || "unknown"}`,
      status: 0,
    };
  }
}

module.exports = {
  initiateDeviceFlow,
  pollForToken,
  getStoredToken,
  getAuthStatus,
  getRegistryProfile,
  updateRegistryProfile,
  getRegistryPackages,
  updateRegistryPackage,
  deleteRegistryPackage,
  clearToken,
  refreshAccessToken,
  authedFetch,
  isAccessTokenExpired,
};
