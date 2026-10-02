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
      /activeTab === "bots" && \(\s*<BotsTab\s+workspace=\{workspace\}\s+onOpenBotsView=\{onOpenBotsView\}/,
    );
  });
});

describe("DashboardStage — Bots view wiring (TEAM-011)", () => {
  it("loads the team once and feeds the header badge and the Bots view", () => {
    expect(stageSrc).toMatch(
      /useTeamBots\(\s*popout \? null : \(?workspaceSelected\?\.id \?\? null\)?\s*\)/,
    );
    expect(stageSrc).toMatch(/botsAttention=\{team\.attention\}/);
    expect(stageSrc).toMatch(/stageMode === "bots" \? \(\s*<BotsView/);
  });

  it("only offers the Bots view in preview, never in popouts", () => {
    expect(stageSrc).toMatch(
      /onStageModeChange=\{\s*popout \|\| !previewMode \? null : setStageMode\s*\}/,
    );
    expect(stageSrc).toMatch(/!popout && previewMode && workspaceSelected/);
  });

  it("entering edit mode returns to the dashboard", () => {
    expect(stageSrc).toMatch(
      /setPreviewMode\(false\);\s*setStageMode\("dashboard"\);/,
    );
  });

  it("Dashboard Config's Open in Bots view leaves edit mode through its guard", () => {
    expect(stageSrc).toMatch(
      /onOpenBotsView=\{\(\) => \{[\s\S]*?setIsConfigModalOpen\(false\);[\s\S]*?handleToggleEditMode\(\);/,
    );
  });
});

describe("DashboardStage — bot teams wiring", () => {
  it("passes the dashboards list into Dashboard Config", () => {
    expect(stageSrc).toMatch(
      /<DashboardConfigModal[\s\S]*?workspaces=\{workspaceConfig\}/,
    );
  });

  it("makes sure an opened dashboard has its idle team lead (TEAM-002)", () => {
    expect(stageSrc).toMatch(
      /bots\.ensureLead\(\s*workspaceSelected\.id,\s*workspaceSelected\.name/,
    );
    // Never from a popped-out widget window.
    expect(stageSrc).toMatch(/if \(popout \|\| !workspaceSelected\) return/);
  });

  it("wraps the assistant dock in WorkspaceContext (current dashboard + list)", () => {
    expect(stageSrc).toMatch(
      /<WorkspaceContext\.Provider\s+value=\{dockWorkspaceContext\}\s*>\s*\{renderAiAssistant\}/,
    );
    expect(stageSrc).toMatch(/workspaceData: workspaceSelected/);
    expect(stageSrc).toMatch(/workspaces: workspaceConfig/);
  });
});
