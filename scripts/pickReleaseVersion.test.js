/**
 * pickReleaseVersion.test.js: the publish workflow picks the version at
 * merge time, so PRs waiting at once never claim the same one.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pickVersion } = require("./pickReleaseVersion");

describe("pickVersion", () => {
  it("keeps package.json's version when you bumped it past npm", () => {
    assert.equal(pickVersion("0.1.968", ["0.1.966", "0.1.967"]), "0.1.968");
  });

  it("takes the next patch when package.json's version is published", () => {
    assert.equal(pickVersion("0.1.967", ["0.1.966", "0.1.967"]), "0.1.968");
  });

  it("three PRs made from the same master get one version each, in merge order", () => {
    const published = ["0.1.967"];
    const picked = [];
    for (let i = 0; i < 3; i++) {
      // Each PR's package.json still says what master said when it was made.
      const v = pickVersion("0.1.967", published);
      picked.push(v);
      published.push(v);
    }
    assert.deepEqual(picked, ["0.1.968", "0.1.969", "0.1.970"]);
  });

  it("moves past a bump someone else already published", () => {
    // Two PRs both bumped to 0.1.968 by hand; the second merge can't reuse it.
    assert.equal(pickVersion("0.1.968", ["0.1.967", "0.1.968"]), "0.1.969");
  });

  it("goes past the highest version, not package.json's, when master is behind npm", () => {
    assert.equal(pickVersion("0.1.967", ["0.1.967", "0.1.970"]), "0.1.971");
  });

  it("compares versions as numbers, not text", () => {
    assert.equal(pickVersion("0.1.99", ["0.1.99", "0.1.100"]), "0.1.101");
  });

  it("ignores prerelease versions", () => {
    assert.equal(
      pickVersion("0.1.967", ["0.1.967", "0.2.0-beta.1"]),
      "0.1.968",
    );
  });

  it("publishes package.json's version for a package npm doesn't have yet", () => {
    assert.equal(pickVersion("1.0.0", []), "1.0.0");
  });
});
