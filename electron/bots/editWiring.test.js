/**
 * editWiring.test.js — a change to one widget (consolidation Phase 3) is
 * wired in the bot controller so the renderer and the Builder can't point
 * it elsewhere: the package is found from what's installed, build_widget is
 * held to that widget while its roles run, in place needs the user signed
 * in and is checked against who owns it at install, and the team's own
 * place_widget / installDraft refuse while it runs. Source checks, like
 * teamLeadWiring.test.js (botController needs electron).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);

describe("a change to a widget in the bot controller", () => {
  it("startPlanBuild takes edit, finds the widget itself and holds the plan to it", () => {
    // (release 6c added `settings` after it)
    assert.match(src, /bot = false,\s*edit = null,[\s\S]{0,240}?\} = \{\},/);
    assert.match(src, /editTarget = this\._editTarget\(edit\);/);
    assert.match(src, /plan = editPlan\(plan, editTarget\);/);
    // …which names no dashboard (a change goes to a widget).
    assert.match(src, /const \{ dashboard: _dashboard, \.\.\.rest \} = plan;/);
    assert.match(
      src,
      /resolveEditTarget\(\s*edit,\s*require\("\.\.\/widgetRegistry"\)\.getWidgetRegistry\(\)\.getWidgets\(\) \|\| \[\],?\s*\)/,
    );
    assert.match(
      src,
      /edit: editTarget\s*\? \{ package: editTarget\.package, mode: editTarget\.mode \}\s*: null,/,
    );
  });

  it("in place on a package that isn't AI-built needs the user signed in", () => {
    assert.match(
      src,
      /t\.mode === "update" &&\s*!t\.aiBuilt &&\s*!require\("\.\/registryAuthController"\)\.getAuthStatus\(\)\.authenticated/,
    );
  });

  it("its roles run held to that widget, one change at a time", () => {
    assert.match(
      src,
      /askRole: editTarget\s*\? \(role, request\) => this\._editAskRole\(role, request, editTarget\)/,
    );
    assert.match(src, /if \(this\._editRun && this\._editRun !== target\)/);
    assert.match(src, /this\._editRun = target;\s*this\._cellRoleRuns =/);
    assert.match(src, /edit: this\._editRun \|\| null,/);
  });

  it("its install checks the owner now, then installs as that change", () => {
    assert.match(
      src,
      /editTarget\s*\? this\._planInstallEdit\(draft, editTarget\)/,
    );
    assert.match(src, /getRegistryProfile\(\)/);
    assert.match(
      src,
      // The package's own scope — not the component id it was opened by.
      /!ownsWidget\(\{\s*pkg: target\.package,\s*component: null,\s*username: profile && profile\.username,\s*\}\)/,
    );
    assert.match(
      src,
      /return this\._widgetTools\.installDraft\(\{ name: draft, edit: target \}\);/,
    );
  });

  it("the team's own install and place refuse while it runs (as for a cell)", () => {
    assert.match(
      src,
      /this\._cellBuildRunning\(\)\s*\?\s*\{\s*success: false,/,
    );
    assert.match(src, /placeWidget: \(req\) =>\s*this\._cellBuildRunning\(\)/);
  });

  it("the Builder and Checker can read a widget's other files", () => {
    assert.match(
      src,
      /readWidgetFile: \(\{ name, file \}\) =>\s*require\("\.\.\/widgetRegistry"\)\.readWidgetFile\(/,
    );
  });
});
