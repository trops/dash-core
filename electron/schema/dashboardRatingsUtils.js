/**
 * dashboardRatingsUtils.js
 *
 * Pure utility functions for dashboard ratings logic.
 * No Electron or file I/O dependencies — safe to test anywhere.
 */

/**
 * Validate and build a rating entry.
 *
 * @param {string} packageName - Dashboard package name
 * @param {Object} rating - Rating input
 * @param {number} rating.stars - 1-5 star rating
 * @param {string} [rating.review] - Optional text review
 * @returns {Object} { success, rating, error }
 */
function validateAndBuildRating(packageName, rating = {}) {
  if (!packageName) {
    return { success: false, error: "Package name is required" };
  }

  const stars = Number(rating.stars);
  if (!stars || stars < 1 || stars > 5 || !Number.isInteger(stars)) {
    return {
      success: false,
      error: "Stars must be an integer between 1 and 5",
    };
  }

  const entry = {
    stars,
    review:
      typeof rating.review === "string" ? rating.review.slice(0, 1000) : "",
    ratedAt: new Date().toISOString(),
  };

  return { success: true, rating: entry };
}

/**
 * Enrich packages with user rating data (pure function).
 *
 * @param {Array} packages - Registry packages
 * @param {Object} ratings - Map of packageName → rating data
 * @returns {Array} Packages with userRating field added
 */
function enrichWithRatings(packages, ratings) {
  return packages.map((pkg) => ({
    ...pkg,
    userRating: ratings[pkg.name] || null,
  }));
}

module.exports = {
  validateAndBuildRating,
  enrichWithRatings,
};
