/**
 * fsGrantAttribution.test.js — file grants a shared widget api gave the
 * wrong widget are dropped; everything else stays.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  dataFileOwner,
  dropMisattributedFsPaths,
} = require("./fsGrantAttribution");

const NOTEPAD = "trops.dash-samples.NotepadWidget";
const NOTIFY = "trops.dash-samples.NotificationWidget";
const fsGrant = (readPaths, writePaths = []) => ({
  grantOrigin: "live",
  domains: { fs: { actions: ["readFromFile"], readPaths, writePaths } },
});

test("dataFileOwner: the widget a data file is named for", () => {
  assert.strictEqual(
    dataFileOwner("1777506315333-trops.dash-samples.NotepadWidget-3.json"),
    NOTEPAD,
  );
  assert.strictEqual(dataFileOwner("notes.json"), null);
  assert.strictEqual(dataFileOwner("*"), null);
  assert.strictEqual(dataFileOwner("12-Notepad-3.json"), null);
  assert.strictEqual(dataFileOwner(null), null);
});

test("drops another widget's data files, keeps its own and other paths", () => {
  const own = `1-${NOTIFY}-4.json`;
  const other = `1-${NOTEPAD}-3.json`;
  const { grants, removed } = dropMisattributedFsPaths({
    [NOTIFY]: fsGrant([own, other, "notes.json", "*"], [other]),
  });
  assert.strictEqual(removed, 2);
  assert.deepStrictEqual(grants[NOTIFY].domains.fs.readPaths, [
    own,
    "notes.json",
    "*",
  ]);
  assert.deepStrictEqual(grants[NOTIFY].domains.fs.writePaths, []);
  assert.deepStrictEqual(grants[NOTIFY].domains.fs.actions, ["readFromFile"]);
  assert.strictEqual(grants[NOTIFY].grantOrigin, "live");
});

test("grants without fs, and a clean file, are returned as-is", () => {
  const input = {
    "@trops/gmail": { servers: { gmail: { tools: ["send"] } } },
    [NOTEPAD]: fsGrant([`1-${NOTEPAD}-3.json`]),
  };
  const { grants, removed } = dropMisattributedFsPaths(input);
  assert.strictEqual(removed, 0);
  assert.strictEqual(grants, input);
});

test("idempotent, and the input isn't mutated", () => {
  const input = { [NOTIFY]: fsGrant([`1-${NOTEPAD}-3.json`]) };
  const once = dropMisattributedFsPaths(input);
  assert.strictEqual(input[NOTIFY].domains.fs.readPaths.length, 1);
  const twice = dropMisattributedFsPaths(once.grants);
  assert.strictEqual(twice.removed, 0);
});
