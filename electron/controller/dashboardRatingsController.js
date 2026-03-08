/**
 * dashboardRatingsController.js
 *
 * Local storage for dashboard ratings and reviews.
 * Stores user ratings per dashboard package in a JSON file.
 * Runs in the Electron main process.
 */

const { app } = require("electron");
const path = require("path");
const { getFileContents, writeToFile } = require("../utils/file");
const {
  validateAndBuildRating,
  enrichWithRatings,
} = require("../schema/dashboardRatingsUtils");

const ratingsFilename = "dashboard-ratings.json";
const appName = "Dashboard";

/**
 * Get the ratings file path for an app.
 */
function getRatingsPath(appId) {
  return path.join(app.getPath("userData"), appName, appId, ratingsFilename);
}

/**
 * Read all ratings from disk.
 */
function readRatings(appId) {
  const filepath = getRatingsPath(appId);
  return getFileContents(filepath, {});
}

/**
 * Write ratings to disk.
 */
function writeRatings(appId, ratings) {
  const filepath = getRatingsPath(appId);
  writeToFile(filepath, JSON.stringify(ratings, null, 2));
}

/**
 * Save or update a rating for a dashboard package.
 */
function saveDashboardRating(appId, packageName, rating = {}) {
  const result = validateAndBuildRating(packageName, rating);
  if (!result.success) return result;

  const ratings = readRatings(appId);
  ratings[packageName] = result.rating;
  writeRatings(appId, ratings);

  return { success: true, rating: ratings[packageName] };
}

/**
 * Get the user's rating for a specific dashboard package.
 */
function getDashboardRating(appId, packageName) {
  const ratings = readRatings(appId);
  return ratings[packageName] || null;
}

/**
 * Get all dashboard ratings.
 */
function listDashboardRatings(appId) {
  return readRatings(appId);
}

/**
 * Delete a rating for a dashboard package.
 */
function deleteDashboardRating(appId, packageName) {
  const ratings = readRatings(appId);
  if (!ratings[packageName]) {
    return { success: false, error: "No rating found for this package" };
  }
  delete ratings[packageName];
  writeRatings(appId, ratings);
  return { success: true };
}

/**
 * Enrich registry packages with local rating data.
 */
function enrichPackagesWithRatings(packages, appId) {
  const ratings = readRatings(appId);
  return enrichWithRatings(packages, ratings);
}

module.exports = {
  saveDashboardRating,
  getDashboardRating,
  listDashboardRatings,
  deleteDashboardRating,
  enrichPackagesWithRatings,
};
