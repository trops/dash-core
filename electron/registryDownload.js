/**
 * registryDownload — every download from the Dash registry (widgets, themes,
 * dashboards, bots) goes through here.
 *
 * Public packages download signed out (decided 2026-10-23); private ones need
 * the sign-in, and the registry answers 401 for them so the app can ask.
 * Signed in, the sign-in is sent (refreshed when it has expired). If the
 * registry still refuses it, the download is tried once more without it, so
 * a public package installs anyway. The sign-in isn't cleared here: a
 * registry or network blip can refuse a good one, and the sign-in check
 * (getProfile) clears it when it's really gone.
 *
 * Each request carries this Dash install's anonymous ID, so the registry can
 * count unique installs of a package without an account. A read that isn't
 * an install (an update's preview, a starter's thumbnail) says so with
 * ?purpose=preview, so it isn't counted as one.
 */
const INSTALL_ID_HEADER = "x-dash-install-id";

let installIdStore = null;
function getInstallIdStore() {
  if (!installIdStore) {
    const Store = require("electron-store");
    // Its own store: signing out clears the sign-in store, not this.
    installIdStore = new Store({ name: "dash-install" });
  }
  return installIdStore;
}

/** This Dash install's anonymous ID, made once (a random UUID). */
function getInstallId() {
  try {
    const s = getInstallIdStore();
    let id = s.get("installId");
    if (typeof id !== "string" || !id) {
      id = require("crypto").randomUUID();
      s.set("installId", id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * What to tell the user when the registry refused a download, or null.
 * 401 = it isn't public, so sign in (or sign in again); 429 = too many
 * downloads signed out.
 * @returns {{ error: string, authRequired?: boolean } | null}
 */
function downloadRefusal(response, { expired = false } = {}) {
  if (response.status === 401) {
    return {
      error: expired
        ? "Your Dash registry session expired. Sign in again to install this."
        : "Sign in to the Dash registry to install this.",
      authRequired: true,
    };
  }
  if (response.status === 429) {
    return {
      error:
        "Too many downloads from the Dash registry — try again in a few minutes.",
    };
  }
  return null;
}

function withPurpose(url, purpose) {
  try {
    const u = new URL(url);
    u.searchParams.set("purpose", purpose);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The download functions over their dependencies (tests pass mocks; the
 * module's own exports use the real sign-in, fetch and install ID).
 */
function createRegistryDownload({
  authedFetch,
  getStoredToken,
  fetchImpl,
  installId,
}) {
  /**
   * Fetch a registry download URL.
   * @param {{ purpose?: "preview" }} opts  preview: read, not installed
   * @returns {Promise<{ response: Response, expired: boolean }>} expired: a
   *   sign-in was sent and refused
   */
  async function registryDownloadFetch(rawUrl, { purpose = null } = {}) {
    const url = purpose ? withPurpose(rawUrl, purpose) : rawUrl;
    const headers = {};
    const id = installId();
    if (id) headers[INSTALL_ID_HEADER] = id;

    const signedIn = !!getStoredToken();
    let response = await authedFetch(url, { headers });
    let expired = false;
    if (response.status === 401 && signedIn) {
      expired = true;
      response = await fetchImpl(url, { headers });
    }
    return { response, expired };
  }
  return { registryDownloadFetch, downloadRefusal };
}

const auth = () => require("./controller/registryAuthController");
const real = createRegistryDownload({
  authedFetch: (...args) => auth().authedFetch(...args),
  getStoredToken: () => auth().getStoredToken(),
  fetchImpl: (...args) => fetch(...args),
  installId: getInstallId,
});

module.exports = {
  INSTALL_ID_HEADER,
  getInstallId,
  registryDownloadFetch: real.registryDownloadFetch,
  downloadRefusal,
  createRegistryDownload,
};
