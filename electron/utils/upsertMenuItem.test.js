/**
 * upsertMenuItem.test.js
 *
 * Pins UPSERT-by-id semantics on the pure function backing
 * `menuItemsController.saveMenuItemForApplication`. Pre-fix the
 * controller did `menuItemsArray.push(menuItem)` unconditionally,
 * so any code path that re-saved a folder with an existing id
 * created a duplicate. The dashboard install path was the most
 * likely culprit — when the publisher's menuId matched the user's
 * local folder id, the dashboard install re-applied the publisher's
 * icon as a SECOND record under the same id.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { upsertMenuItem } = require("./upsertMenuItem");

describe("upsertMenuItem — basic upsert", () => {
  test("insert: new id appends to the list", () => {
    const next = upsertMenuItem([{ id: 1, name: "A", icon: "folder" }], {
      id: 2,
      name: "B",
      icon: "tag",
    });
    assert.equal(next.length, 2);
    assert.deepEqual(next.map((m) => m.id).sort(), [1, 2]);
  });

  test("update: existing id REPLACES instead of duplicating", () => {
    const next = upsertMenuItem([{ id: 1, name: "Folder", icon: "folder" }], {
      id: 1,
      name: "Folder",
      icon: "graduation-cap",
    });
    assert.equal(next.length, 1, "no duplicate");
    assert.equal(next[0].icon, "graduation-cap");
  });

  test("update merges fields rather than overwriting wholesale", () => {
    const next = upsertMenuItem(
      [{ id: 1, name: "Folder", icon: "folder", custom: "keep-me" }],
      { id: 1, icon: "tag" },
    );
    assert.equal(next.length, 1);
    assert.equal(next[0].name, "Folder", "preserved");
    assert.equal(next[0].icon, "tag", "updated");
    assert.equal(next[0].custom, "keep-me", "preserved");
  });

  test("string vs number id matches via String() coercion", () => {
    const next = upsertMenuItem([{ id: 100, name: "Folder", icon: "folder" }], {
      id: "100",
      name: "Renamed",
    });
    assert.equal(next.length, 1);
    assert.equal(next[0].name, "Renamed");
  });
});

describe("upsertMenuItem — heals pre-existing duplicates", () => {
  test("file with two entries sharing same id collapses to one (last wins)", () => {
    // Mirrors the production scenario observed in the user's
    // menuItems.json: two records with the same id but different
    // icons (`graduation-cap` then `magnifying-glass`).
    const dirty = [
      { id: 1, name: "Algolia Experiments", icon: "graduation-cap" },
      { id: 1, name: "Algolia Experiments", icon: "magnifying-glass" },
      { id: 2, name: "Comms", icon: "phone" },
    ];
    const next = upsertMenuItem(dirty, {
      id: 99,
      name: "New",
      icon: "tag",
    });
    assert.equal(next.length, 3, "two id=1 dupes collapsed to one");
    const algolia = next.filter((m) => m.id === 1);
    assert.equal(algolia.length, 1);
    assert.equal(algolia[0].icon, "magnifying-glass", "last-seen entry wins");
  });

  test("upserting against a list that already has dupes — both heals AND upserts", () => {
    const dirty = [
      { id: 1, name: "X", icon: "a" },
      { id: 1, name: "X", icon: "b" },
    ];
    const next = upsertMenuItem(dirty, { id: 1, icon: "c" });
    assert.equal(next.length, 1);
    assert.equal(next[0].icon, "c");
  });
});

describe("upsertMenuItem — defensive", () => {
  test("null input list → treats as empty", () => {
    const next = upsertMenuItem(null, { id: 1, name: "A" });
    assert.equal(next.length, 1);
    assert.equal(next[0].id, 1);
  });

  test("undefined menuItem → returns input filtered of nulls", () => {
    const next = upsertMenuItem([{ id: 1 }, null, { id: 2 }], undefined);
    assert.deepEqual(
      next.map((m) => m.id),
      [1, 2],
    );
  });

  test("menuItem without id appends without crashing", () => {
    const next = upsertMenuItem([{ id: 1 }], { name: "no-id-here" });
    assert.equal(next.length, 2);
  });

  test("does not mutate the input list", () => {
    const input = [{ id: 1, icon: "a" }];
    const before = JSON.stringify(input);
    upsertMenuItem(input, { id: 1, icon: "b" });
    assert.equal(JSON.stringify(input), before);
  });
});
