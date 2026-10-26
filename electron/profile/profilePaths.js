/**
 * profilePaths.js
 *
 * Where the active profile's files live. Controllers for per-profile data
 * (dashboards, folders, themes, layouts, ratings) build their paths here
 * instead of joining userData/Dashboard/<appId> themselves, so switching
 * profile switches every one of them together.
 *
 * Shared data (providers, settings, widget data, installed widgets) is
 * not per profile and keeps its own paths.
 */
const path = require("path");
const profileStore = require("./profileStore");

/**
 * @param {string} appId
 * @param {string} [profileId] defaults to the active profile
 * @returns {string} the profile's data folder
 */
function getProfileDataDir(appId, profileId) {
  const id = profileId || profileStore.getActiveProfileId(appId);
  return profileStore.getProfileDir(appId, id);
}

/**
 * @param {string} appId
 * @param {string} filename e.g. "workspaces.json"
 * @param {string} [profileId] defaults to the active profile
 * @returns {string} the file's path inside the profile's folder
 */
function getProfileFilePath(appId, filename, profileId) {
  return path.join(getProfileDataDir(appId, profileId), filename);
}

module.exports = { getProfileDataDir, getProfileFilePath };
