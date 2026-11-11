/**
 * botWidgetWiring (team-dashboards TD-009): a line from a bot to a widget is
 * saved on the dashboard right away and never over unsaved edits; a copy the
 * Dash team made is connected once it's in the widget's place (in place,
 * the main process connects it when it installs).
 */
const fs = require("fs");
const path = require("path");

const stage = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);
const lead = fs.readFileSync(
  path.join(__dirname, "..", "LeadWorkspace", "LeadWorkspace.js"),
  "utf8",
);

describe("DashboardStage — a line from the Bots diagram", () => {
  test("refused while the dashboard is being edited or has unsaved edits, saying why", () => {
    expect(stage).toMatch(
      /function changeFromDiagram\(change, what\) \{[\s\S]{0,600}if \(!previewModeRef\.current \|\| isDirty\) \{[\s\S]{0,300}Save or cancel your edits to[\s\S]{0,200}refused\.refused = true;\s*reject\(refused\);/,
    );
  });
  test("shown at once, saved, and put back if the save fails", () => {
    expect(stage).toMatch(
      /const next = reconcileWorkspaceAfterLayoutChange\(change\(before\)\);\s*updateTabWorkspace\(next\);\s*const failed = \(_e, error\) => \{\s*updateTabWorkspace\(before\);/,
    );
  });
  test("the Bots view gets it", () => {
    expect(stage).toMatch(/onChangeDashboard=\{changeFromDiagram\}/);
  });
  test("Change with AI carries the wire", () => {
    expect(stage).toMatch(
      /wire: d\.wire && typeof d\.wire === "object" \? d\.wire : null/,
    );
  });
});

describe("DashboardStage — dash:wire-bot-to-widget", () => {
  test("the dashboard on screen: staged while editing, else saved right away", () => {
    expect(stage).toMatch(
      /if \(here\) \{[\s\S]{0,200}applyWiringChanges\(workspaceSelected, change\)[\s\S]{0,60}if \(!previewModeRef\.current\) \{\s*stageWorkspaceEdit\(next\);\s*return;\s*\}\s*saveRightAway\(next, "listener"\);/,
    );
  });
  test("another dashboard: its saved copy, reconciled, then a reload", () => {
    expect(stage).toMatch(
      /reconcileWorkspaceAfterLayoutChange\(applyWiringChanges\(ws, change\)\),\s*\(\) => loadWorkspaces\(\),/,
    );
  });
});

describe("LeadWorkspace — a copy gets connected once it's in place", () => {
  test("every try that places it connects it; nothing else does", () => {
    expect(lead).toMatch(
      /if \(result === true && w\.wire && w\.onDashboard && w\.itemId != null\) \{\s*setTimeout\(wireWidget\(w\), 50\);/,
    );
    // Never the original widget: the done step doesn't wire.
    expect(lead).not.toMatch(/pendingWire/);
    expect(lead.match(/wireWidget\(w\)/g)).toHaveLength(1);
  });
  test("the user's words are asked at once, once", () => {
    expect(lead).toMatch(
      /if \(!w \|\| !w\.ask \|\| wireAsked\.current \|\| loading \|\| !contact\) return;\s*wireAsked\.current = true;\s*ask\(w\.ask\);/,
    );
  });
});
