/**
 * appPaths.js
 *
 * Paths to an app's data files: <userData>/Dashboard/<appId>/<file>.
 * Shared by every profile — a profile is a list of ids (see
 * profile/profileStore.js), not a separate folder.
 */
const { app } = require("electron");
const path = require("path");

const appName = "Dashboard";

function getAppDataDir(appId) {
  return path.join(app.getPath("userData"), appName, appId);
}

function getAppFilePath(appId, filename) {
  return path.join(getAppDataDir(appId), filename);
}

module.exports = { getAppDataDir, getAppFilePath };
