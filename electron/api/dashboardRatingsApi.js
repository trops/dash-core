/**
 * dashboardRatingsApi.js
 *
 * IPC bridge for dashboard ratings (renderer side).
 */
const { ipcRenderer } = require("electron");
const {
  DASHBOARD_RATING_SAVE,
  DASHBOARD_RATING_GET,
  DASHBOARD_RATING_LIST,
  DASHBOARD_RATING_DELETE,
} = require("../events");

const dashboardRatingsApi = {
  saveDashboardRating: (appId, packageName, rating) =>
    ipcRenderer.invoke(DASHBOARD_RATING_SAVE, {
      appId,
      packageName,
      rating,
    }),

  getDashboardRating: (appId, packageName) =>
    ipcRenderer.invoke(DASHBOARD_RATING_GET, { appId, packageName }),

  listDashboardRatings: (appId) =>
    ipcRenderer.invoke(DASHBOARD_RATING_LIST, { appId }),

  deleteDashboardRating: (appId, packageName) =>
    ipcRenderer.invoke(DASHBOARD_RATING_DELETE, { appId, packageName }),
};

module.exports = dashboardRatingsApi;
