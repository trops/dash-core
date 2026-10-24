/**
 * A dashboard without a label of its own takes its name, not "New
 * Dashboard" (QA 2026-10-24: saved records of "Untitled dashboard 2" kept
 * the label "New Dashboard").
 *
 * WorkspaceModel pulls in the layout builder UI through its imports, so —
 * like the DashboardStage pins — this checks the source.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "WorkspaceModel.js"),
  "utf8",
);

describe("WorkspaceModel — label", () => {
  test("no label of its own: its name", () => {
    expect(source).toMatch(
      /workspace\.label = "label" in obj \? obj\["label"\] : workspace\.name;/,
    );
  });

  test("the name is set before the label reads it", () => {
    expect(source.indexOf("workspace.name =")).toBeLessThan(
      source.indexOf("workspace.label ="),
    );
  });
});
