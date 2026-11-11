/**
 * The main process connects a widget changed in place to its bot when the
 * change installs (team-dashboards TD-009) — Create needn't stay open.
 * Static checks on botController's wiring; the listener helper itself is
 * placeWidget.addWidgetListener's (tested there).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { addWidgetListener } = require("../utils/placeWidget");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);

describe("botController — wiring a changed widget", () => {
  it("the edit target keeps the wire and the widget's copy", () => {
    assert.match(
      ctrl,
      /wire: cleanWire\(edit\.wire\),\s*workspaceId:[\s\S]{0,240}itemId:/,
    );
  });
  it("only a change in place that installed is wired", () => {
    assert.match(
      ctrl,
      /res\.success !== false &&\s*!res\.error &&\s*target\.wire &&\s*target\.mode === "update"\s*\)\s*\{\s*const wired = this\._wireEditedWidget\(target\);/,
    );
  });
  it("adds the bot's event to the widget's new listener and saves", () => {
    assert.match(
      ctrl,
      /_wireEditedWidget\(target\) \{[\s\S]{0,700}addWidgetListener\(\s*workspace,\s*target\.itemId,\s*wire\.handlerName,\s*botEventType\(bot, wire\.event\),\s*\);[\s\S]{0,200}return this\._saveWorkspace\(next\);/,
    );
  });
  it("adding it twice changes nothing, on every page it's on", () => {
    const ws = {
      id: 7,
      layout: [{ id: 11, component: "a.b.C" }],
      pages: [{ id: "p1", layout: [{ id: 11, component: "a.b.C" }] }],
    };
    const ev = "bot:local/shop[bot_s].completed";
    const once = addWidgetListener(ws, "11", "showShop", ev);
    const twice = addWidgetListener(once, "11", "showShop", ev);
    assert.deepEqual(twice.layout[0].listeners, { showShop: [ev] });
    assert.deepEqual(twice.pages[0].layout[0].listeners, { showShop: [ev] });
  });
});
