/**
 * Static wiring pins for bot teams (bot-teams PRD TEAM-001):
 *  - Dashboard Config has a Bots tab rendering this dashboard's team
 *  - DashboardStage passes the dashboards list to Dashboard Config, and the
 *    current dashboard (+ list) to the assistant dock via WorkspaceContext,
 *    so the Bot Activity panel can create bots on the dashboard you're on.
 */
const fs = require("fs");
const path = require("path");

const modalSrc = fs.readFileSync(
  path.join(__dirname, "DashboardConfigModal.js"),
  "utf8",
);
const stageSrc = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);

describe("Dashboard Config — Bots tab", () => {
  it("imports and renders BotsTab for this dashboard", () => {
    expect(modalSrc).toMatch(/import \{ BotsTab \} from "\.\/BotsTab"/);
    expect(modalSrc).toMatch(/onClick=\{\(\) => setActiveTab\("bots"\)\}/);
    expect(modalSrc).toMatch(
      /activeTab === "bots" && \(\s*<BotsTab workspace=\{workspace\} workspaces=\{workspaces\}/,
    );
  });
});

describe("DashboardStage — bot teams wiring", () => {
  it("passes the dashboards list into Dashboard Config", () => {
    expect(stageSrc).toMatch(
      /<DashboardConfigModal[\s\S]*?workspaces=\{workspaceConfig\}/,
    );
  });

  it("wraps the assistant dock in WorkspaceContext (current dashboard + list)", () => {
    expect(stageSrc).toMatch(
      /<WorkspaceContext\.Provider\s+value=\{dockWorkspaceContext\}\s*>\s*\{renderAiAssistant\}/,
    );
    expect(stageSrc).toMatch(/workspaceData: workspaceSelected/);
    expect(stageSrc).toMatch(/workspaces: workspaceConfig/);
  });
});
