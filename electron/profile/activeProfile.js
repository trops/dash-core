/**
 * activeProfile.js
 *
 * The main process's appId, recorded once at startup, so code that isn't
 * handed an appId (recent dashboards, the MCP Dash server) can still ask
 * which profile is active.
 */
const profileStore = require("./profileStore");

let appId = null;

function setAppId(id) {
  appId = id || null;
}

function getAppId() {
  return appId;
}

/** The active profile's id, or Default when no appId was recorded. */
function getActiveProfileId() {
  if (!appId) return profileStore.DEFAULT_PROFILE_ID;
  try {
    return profileStore.getActiveProfileId(appId);
  } catch (_e) {
    return profileStore.DEFAULT_PROFILE_ID;
  }
}

module.exports = { setAppId, getAppId, getActiveProfileId };
