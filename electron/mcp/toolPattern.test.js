/**
 * toolPattern.test.js
 *
 * Pins wildcard tool names: the scanner turns a template tool name into a
 * pattern, and the gate matches real tool names against it.
 *
 * Run with `node --test electron/mcp/toolPattern.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  isToolPattern,
  toolPatternFromTemplate,
  toolMatches,
  toolListAllows,
} = require("./toolPattern");

test("turns a template tool name into a wildcard", () => {
  assert.strictEqual(
    toolPatternFromTemplate("algolia_search_${selectedIndex}"),
    "algolia_search_*",
  );
  assert.strictEqual(toolPatternFromTemplate("get_${a}_${b}"), "get_*_*");
  assert.strictEqual(toolPatternFromTemplate("list_files"), "list_files");
});

test("drops templates with too little literal text", () => {
  assert.strictEqual(toolPatternFromTemplate("${toolName}"), null);
  assert.strictEqual(toolPatternFromTemplate("${a}_${b}"), null);
  assert.strictEqual(toolPatternFromTemplate("x${a}"), null);
});

test("matches tool names against patterns", () => {
  assert.strictEqual(isToolPattern("algolia_search_*"), true);
  assert.strictEqual(isToolPattern("algolia_search_products"), false);
  assert.strictEqual(
    toolMatches("algolia_search_*", "algolia_search_products"),
    true,
  );
  assert.strictEqual(
    toolMatches("algolia_search_*", "algolia_delete_products"),
    false,
  );
  assert.strictEqual(toolMatches("get_*_*", "get_a_b"), true);
  assert.strictEqual(toolMatches("list_files", "list_files"), true);
  assert.strictEqual(toolMatches("list_files", "list_files_all"), false);
});

test("treats other regex characters literally", () => {
  assert.strictEqual(toolMatches("a.b_*", "a.b_x"), true);
  assert.strictEqual(toolMatches("a.b_*", "axb_x"), false);
});

test("checks a whole list", () => {
  assert.strictEqual(
    toolListAllows(["list_indices", "algolia_search_*"], "algolia_search_x"),
    true,
  );
  assert.strictEqual(
    toolListAllows(["list_indices"], "algolia_search_x"),
    false,
  );
  assert.strictEqual(toolListAllows(undefined, "x"), false);
});
