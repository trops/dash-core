/**
 * ownDataFile — a widget's own data file never asks the user.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isOwnDataFile } = require("./ownDataFile");

describe("isOwnDataFile", () => {
  const w = "ai-built.shoppinglist.ShoppingList";
  it("its own file, any copy", () => {
    assert.equal(isOwnDataFile(w, `${w}--7-a-3.json`), true);
    assert.equal(isOwnDataFile(w, `${w}--12.json`), true);
  });
  it("not another widget's, not a path, not a made-up name", () => {
    assert.equal(isOwnDataFile(w, "ai-built.other.Other--7.json"), false);
    assert.equal(isOwnDataFile(w, `${w}--../x.json`), false);
    assert.equal(isOwnDataFile(w, `${w}--a/b.json`), false);
    assert.equal(isOwnDataFile(w, `${w}--.json`), false);
    assert.equal(isOwnDataFile(w, "shopping-list.json"), false);
    assert.equal(isOwnDataFile(w, "undefined.json"), false);
    assert.equal(isOwnDataFile(null, `${w}--7.json`), false);
  });
});
