/**
 * editTarget.test.js — the widget a change goes to is found from what's
 * installed, never taken from the renderer (consolidation Phase 3).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveEditTarget,
  ownsWidget,
  isAiBuilt,
  inPlaceProblem,
} = require("./editTarget");

const installed = [
  // As the registry lists them: components by their bare names.
  { name: "inbox", componentNames: ["Inbox", "Sent"] },
  {
    name: "@ai-built/notes",
    packageId: "@ai-built/notes",
    componentNames: ["Notes"],
  },
  { name: "@other/inbox", componentNames: ["Inbox"] },
  { name: "@jg/tools", packageId: "@jg/tools", componentNames: ["Clock"] },
  {
    name: "@ai-built/pipeline",
    packageId: "@ai-built/pipeline",
    componentNames: ["Pipeline", "Stages"],
  },
];

describe("resolveEditTarget", () => {
  it("names the package as the registry keeps it", () => {
    assert.deepEqual(
      resolveEditTarget(
        { component: "jg.tools.Clock", mode: "update" },
        installed,
      ),
      {
        package: "@jg/tools",
        component: "jg.tools.Clock",
        componentName: "Clock",
        mode: "update",
        aiBuilt: false,
      },
    );
  });
  it("a package with no registry name changes only as a new widget", () => {
    // Whose an unscoped "inbox" is can't be told — not from the id sent.
    assert.match(
      resolveEditTarget({ component: "jg.inbox.Sent" }, installed).error,
      /Sent has no registry name, so it can't be changed in place/,
    );
    const t = resolveEditTarget(
      { component: "ai-built.inbox.Inbox", mode: "new" },
      installed,
    );
    assert.equal(t.package, "inbox");
    assert.equal(t.aiBuilt, false);
  });
  it("an AI-built package holding other widgets changes only as a new widget", () => {
    assert.match(
      resolveEditTarget({ component: "ai-built.pipeline.Stages" }, installed)
        .error,
      /Stages shares its package with other widgets/,
    );
    assert.equal(
      resolveEditTarget(
        { component: "ai-built.pipeline.Stages", mode: "new" },
        installed,
      ).mode,
      "new",
    );
  });
  it("an AI-built widget says so; anything but new is an update", () => {
    const t = resolveEditTarget(
      { component: "ai-built.notes.Notes" },
      installed,
    );
    assert.equal(t.aiBuilt, true);
    assert.equal(t.mode, "update");
    assert.equal(
      resolveEditTarget(
        { component: "ai-built.notes.Notes", mode: "new" },
        installed,
      ).mode,
      "new",
    );
  });
  it("a widget that isn't installed, or no component, is refused", () => {
    assert.match(
      resolveEditTarget({ component: "jg.gone.Gone" }, installed).error,
      /isn't installed/,
    );
    assert.match(
      resolveEditTarget({ component: "Inbox" }, installed).error,
      /Which widget/,
    );
    assert.match(resolveEditTarget(null, installed).error, /Which widget/);
  });
});

describe("ownsWidget", () => {
  it("AI-built is always yours; otherwise the scope is your username", () => {
    assert.equal(ownsWidget({ pkg: "inbox", component: "ai-built.x.X" }), true);
    assert.equal(
      ownsWidget({ pkg: "inbox", component: "jg.inbox.Inbox", username: "JG" }),
      true,
    );
    assert.equal(
      ownsWidget({
        pkg: "inbox",
        component: "jg.inbox.Inbox",
        username: "other",
      }),
      false,
    );
    assert.equal(
      ownsWidget({ pkg: "inbox", component: "jg.inbox.Inbox" }),
      false,
    );
    assert.equal(isAiBuilt("@ai-built/notes", null), true);
  });
});

describe("inPlaceProblem", () => {
  it("names why a change can't go in place, or null", () => {
    const p = (pkg, componentName) =>
      inPlaceProblem({ package: pkg, componentName });
    assert.equal(p("@jg/inbox", "Inbox"), null);
    assert.equal(p("@ai-built/notes", "Notes"), null);
    assert.equal(p("@AI-Built/Notes", "Notes"), null);
    assert.equal(p("inbox", "Inbox"), "has no registry name");
    assert.equal(p("", "Inbox"), "has no registry name");
    assert.equal(
      p("@ai-built/pipeline", "Stages"),
      "shares its package with other widgets",
    );
  });
});
