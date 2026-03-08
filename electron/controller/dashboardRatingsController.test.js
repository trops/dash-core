const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAndBuildRating,
  enrichWithRatings,
} = require("../schema/dashboardRatingsUtils");

describe("validateAndBuildRating", () => {
  it("returns error when package name is missing", () => {
    const result = validateAndBuildRating("", { stars: 3 });
    assert.equal(result.success, false);
    assert.match(result.error, /package name/i);
  });

  it("returns error when package name is null", () => {
    const result = validateAndBuildRating(null, { stars: 3 });
    assert.equal(result.success, false);
  });

  it("returns error for stars below 1", () => {
    const result = validateAndBuildRating("pkg", { stars: 0 });
    assert.equal(result.success, false);
    assert.match(result.error, /stars/i);
  });

  it("returns error for stars above 5", () => {
    const result = validateAndBuildRating("pkg", { stars: 6 });
    assert.equal(result.success, false);
  });

  it("returns error for non-integer stars", () => {
    const result = validateAndBuildRating("pkg", { stars: 2.5 });
    assert.equal(result.success, false);
  });

  it("returns error when stars is missing", () => {
    const result = validateAndBuildRating("pkg", {});
    assert.equal(result.success, false);
  });

  it("returns error when rating is undefined", () => {
    const result = validateAndBuildRating("pkg");
    assert.equal(result.success, false);
  });

  it("builds a valid rating entry", () => {
    const result = validateAndBuildRating("my-dashboard", {
      stars: 4,
      review: "Great dashboard!",
    });
    assert.equal(result.success, true);
    assert.equal(result.rating.stars, 4);
    assert.equal(result.rating.review, "Great dashboard!");
    assert.ok(result.rating.ratedAt);
  });

  it("truncates review to 1000 characters", () => {
    const longReview = "x".repeat(2000);
    const result = validateAndBuildRating("pkg", {
      stars: 5,
      review: longReview,
    });
    assert.equal(result.success, true);
    assert.equal(result.rating.review.length, 1000);
  });

  it("defaults review to empty string when not provided", () => {
    const result = validateAndBuildRating("pkg", { stars: 3 });
    assert.equal(result.success, true);
    assert.equal(result.rating.review, "");
  });

  it("defaults review to empty string when review is a number", () => {
    const result = validateAndBuildRating("pkg", { stars: 3, review: 42 });
    assert.equal(result.success, true);
    assert.equal(result.rating.review, "");
  });

  it("sets ratedAt to an ISO timestamp", () => {
    const result = validateAndBuildRating("pkg", { stars: 1 });
    assert.ok(result.rating.ratedAt);
    assert.ok(!isNaN(Date.parse(result.rating.ratedAt)));
  });

  it("accepts all valid star values 1 through 5", () => {
    for (let s = 1; s <= 5; s++) {
      const result = validateAndBuildRating("pkg", { stars: s });
      assert.equal(result.success, true);
      assert.equal(result.rating.stars, s);
    }
  });
});

describe("enrichWithRatings", () => {
  it("adds userRating field to packages that have ratings", () => {
    const ratings = {
      pkg1: { stars: 5, review: "Love it", ratedAt: "2026-01-01T00:00:00Z" },
    };
    const packages = [
      { name: "pkg1", description: "First" },
      { name: "pkg2", description: "Second" },
    ];
    const enriched = enrichWithRatings(packages, ratings);
    assert.equal(enriched[0].userRating.stars, 5);
    assert.equal(enriched[1].userRating, null);
    assert.equal(enriched[0].description, "First");
  });

  it("returns all null ratings when ratings map is empty", () => {
    const packages = [{ name: "pkg1" }, { name: "pkg2" }];
    const enriched = enrichWithRatings(packages, {});
    assert.equal(enriched[0].userRating, null);
    assert.equal(enriched[1].userRating, null);
  });

  it("handles empty packages array", () => {
    const enriched = enrichWithRatings([], { pkg1: { stars: 3 } });
    assert.deepEqual(enriched, []);
  });

  it("preserves all original package fields", () => {
    const packages = [
      { name: "pkg", version: "1.0.0", author: "me", extra: true },
    ];
    const enriched = enrichWithRatings(packages, {});
    assert.equal(enriched[0].version, "1.0.0");
    assert.equal(enriched[0].author, "me");
    assert.equal(enriched[0].extra, true);
    assert.equal(enriched[0].userRating, null);
  });
});
