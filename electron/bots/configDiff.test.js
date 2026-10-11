/**
 * configDiff.test.js — what a widget config update would break (G6).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { compareConfigs } = require("./configDiff");

const OLD = `import W from "./W";
export default {
  component: W,
  type: "widget",
  userConfig: {
    title: { type: "text", defaultValue: "Inbox" },
    count: { type: "number", defaultValue: 10 },
  },
  events: ["messageSelected"],
};`;

describe("compareConfigs", () => {
  it("an update that keeps everything is fine; additions are notes", () => {
    const next = OLD.replace(
      'events: ["messageSelected"]',
      'events: ["messageSelected", "dateChanged"]',
    ).replace(
      'count: { type: "number", defaultValue: 10 },',
      'count: { type: "number", defaultValue: 10 },\n    since: { type: "text", defaultValue: "" },',
    );
    const d = compareConfigs(OLD, next);
    assert.equal(d.ok, true);
    assert.deepEqual(d.breaking, []);
    assert.deepEqual(d.notes, [
      'new setting "since"',
      'new event "dateChanged"',
    ]);
  });

  it("flags removed settings, changed types and removed events", () => {
    const next = OLD.replace(
      '    title: { type: "text", defaultValue: "Inbox" },\n',
      "",
    )
      .replace(
        'count: { type: "number", defaultValue: 10 }',
        'count: { type: "text", defaultValue: "10" }',
      )
      .replace('events: ["messageSelected"]', "events: []");
    const d = compareConfigs(OLD, next);
    assert.equal(d.ok, false);
    assert.equal(d.breaking.length, 3);
    assert.match(d.breaking[0], /setting "title" was removed/);
    assert.match(
      d.breaking[1],
      /setting "count" changed type \(number → text\)/,
    );
    assert.match(
      d.breaking[2],
      /event "messageSelected" is no longer published/,
    );
    assert.match(d.notes[0], /default changed/);
  });

  it("a config it can't read is reported, not guessed", () => {
    const d = compareConfigs(OLD, "export default { a: process.env.X };");
    assert.equal(d.ok, false);
    assert.match(d.error, /Couldn't read the new config/);
  });
});

describe("compareConfigs — other shapes the Builder writes", () => {
  it("userConfig as a list and events as { publishes }", () => {
    const old =
      'export default { type: "widget", userConfig: [{ key: "title", type: "text" }], events: { publishes: ["greeted"], subscribes: [] } };';
    const next =
      'export default { type: "widget", userConfig: [], events: { publishes: [], subscribes: [] } };';
    const d = compareConfigs(old, next);
    assert.equal(d.ok, false);
    assert.match(d.breaking[0], /setting "title" was removed/);
    assert.match(d.breaking[1], /event "greeted" is no longer published/);
  });
});
