/**
 * widgetComponent.test.js — the layout component id for a widget the
 * Builder names (CRE-011 3c).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveWidgetComponent } = require("./widgetComponent");

const installed = () => [
  { name: "@ai-built/gmailunread", widgets: [{ name: "GmailUnread" }] },
  {
    name: "@trops/algolia",
    widgets: [{ name: "AlgoliaSearchWidget" }, { name: "AlgoliaRulesList" }],
  },
];

describe("resolveWidgetComponent", () => {
  it("a one-widget package → its scoped id", () => {
    assert.deepEqual(
      resolveWidgetComponent("@ai-built/gmailunread", null, installed),
      {
        component: "ai-built.gmailunread.GmailUnread",
      },
    );
    assert.equal(
      resolveWidgetComponent("ai-built/gmailunread", null, installed).component,
      "ai-built.gmailunread.GmailUnread",
    );
  });

  it("a package with several widgets needs component", () => {
    assert.match(
      resolveWidgetComponent("@trops/algolia", null, installed).error,
      /several widgets/,
    );
    assert.equal(
      resolveWidgetComponent(
        "@trops/algolia",
        "trops.algolia.AlgoliaRulesList",
        installed,
      ).component,
      "trops.algolia.AlgoliaRulesList",
    );
    assert.match(
      resolveWidgetComponent("@trops/algolia", "Nope", installed).error,
      /no component "Nope"/,
    );
  });

  it("a dotted id is taken as is; a bare name or a missing package is an error", () => {
    assert.equal(
      resolveWidgetComponent("dash.bots.BotResults", null, installed).component,
      "dash.bots.BotResults",
    );
    assert.match(
      resolveWidgetComponent("Clock", null, installed).error,
      /full component id/,
    );
    assert.match(
      resolveWidgetComponent("@x/nope", null, installed).error,
      /isn't installed/,
    );
  });
});

describe("resolveWidgetComponent — the piece's name picks the component (Create build fixes)", () => {
  it("a name matching one component, ignoring spaces and case", () => {
    assert.equal(
      resolveWidgetComponent("@trops/algolia", null, installed, {
        name: "Algolia Rules List",
      }).component,
      "trops.algolia.AlgoliaRulesList",
    );
  });

  it("a name that matches none still asks which", () => {
    assert.match(
      resolveWidgetComponent("@trops/algolia", null, installed, {
        name: "Rules",
      }).error,
      /several widgets/,
    );
  });
});

// Found live (Phase 2b): "Use in this cell" on the registry's Digital Clock
// failed — the clock package's components end in "Widget".
describe("resolveWidgetComponent — names with or without the Widget suffix", () => {
  const clocks = () => [
    {
      name: "@trops/clock",
      widgets: [
        { name: "AnalogClockWidget", displayName: "Analog Clock" },
        { name: "DigitalClockWidget", displayName: "Digital Clock" },
        { name: "MinimalTextClockWidget", displayName: "Words" },
      ],
    },
  ];
  it('"Digital Clock" → DigitalClockWidget', () => {
    assert.deepEqual(
      resolveWidgetComponent("@trops/clock", null, clocks, {
        name: "Digital Clock",
      }),
      { component: "trops.clock.DigitalClockWidget" },
    );
  });
  it("a display name picks its widget", () => {
    assert.deepEqual(
      resolveWidgetComponent("@trops/clock", null, clocks, { name: "Words" }),
      { component: "trops.clock.MinimalTextClockWidget" },
    );
  });
  it("no match still says which to pick", () => {
    assert.match(
      resolveWidgetComponent("@trops/clock", null, clocks, { name: "Flip" })
        .error,
      /has several widgets/,
    );
  });
});
