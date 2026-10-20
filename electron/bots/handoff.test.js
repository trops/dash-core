/**
 * handoff.test.js — a team lead hands "make something" to the Dash team
 * (consolidation Phase 2c-2): its answer ends with
 * <handoff>{"type","request","note"}</handoff>; Dash reads it, shows a
 * "Plan this with the Dash team" button, and never shows the marker.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { extractHandoff, withoutHandoff, createType } = require("./handoff");

const answer = `The Dash team makes bots — they'll plan it for Morning Brief with you.
<handoff>{"type":"bot","request":"A bot that summarizes my unread email every weekday at 7:30","note":"News Digest already covers headlines at 7:00; they want email."}</handoff>`;

describe("extractHandoff", () => {
  it("reads type, request and note", () => {
    assert.deepEqual(extractHandoff(answer), {
      type: "bot",
      request: "A bot that summarizes my unread email every weekday at 7:30",
      note: "News Digest already covers headlines at 7:00; they want email.",
    });
  });
  it("an unknown type is Auto; no request or bad JSON is no hand-off", () => {
    assert.equal(
      extractHandoff('<handoff>{"type":"robot","request":"x"}</handoff>').type,
      "auto",
    );
    assert.equal(extractHandoff('<handoff>{"type":"bot"}</handoff>'), null);
    assert.equal(extractHandoff("<handoff>{oops</handoff>"), null);
    assert.equal(extractHandoff("Just an answer."), null);
  });
  it("tolerates a code fence and keeps text short", () => {
    const h = extractHandoff(
      '<handoff>```json\n{"type":"widget","request":"' +
        "x".repeat(3000) +
        '"}\n```</handoff>',
    );
    assert.equal(h.type, "widget");
    assert.equal(h.request.length, 2000);
  });
});

describe("withoutHandoff", () => {
  it("drops the marker — and a half-streamed one", () => {
    assert.equal(
      withoutHandoff(answer),
      "The Dash team makes bots — they'll plan it for Morning Brief with you.",
    );
    assert.equal(withoutHandoff('Sure.\n<handoff>{"type":"bo'), "Sure.");
    assert.equal(withoutHandoff("Sure.\n\n<hand"), "Sure.");
    assert.equal(withoutHandoff("a < b"), "a < b");
  });
});

describe("createType", () => {
  it("a bot opens Create › Bot; a widget or layout plans a change to the dashboard", () => {
    assert.equal(createType("bot"), "bot");
    assert.equal(createType("widget"), "dashboard");
    assert.equal(createType("layout"), "dashboard");
    assert.equal(createType("auto"), "auto");
  });
});

describe("the renderer's copy", () => {
  it("is the same code (src/utils/handoff.js)", () => {
    const strip = (s) =>
      s
        .replace(/^"use strict";\n/m, "")
        .replace(/module\.exports = \{[\s\S]*?\};/, "")
        .replace(/export \{[\s\S]*?\};/, "")
        .replace(/^\/\/ A copy[\s\S]*?\n(?=\/\*\*)/m, "")
        .trim();
    const main = fs.readFileSync(path.join(__dirname, "handoff.js"), "utf8");
    const renderer = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "utils", "handoff.js"),
      "utf8",
    );
    assert.equal(strip(renderer), strip(main));
  });
});
