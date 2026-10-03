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
      /useTeamBots\(workspaceSelected\?\.id \?\? null\)/,
    );
    expect(stageSrc).toMatch(/botsAttention=\{team\.attention\}/);
    expect(stageSrc).toMatch(/stageMode === "bots" \? \(\s*<BotsView/);
  });

  it("offers the Bots view in preview and in popouts (B3), never in edit mode", () => {
    expect(stageSrc).toMatch(
      /onStageModeChange=\{\s*popout \|\| previewMode\s*\?[\s\S]{0,200}setStageMode\(mode\)[\s\S]{0,120}:\s*null\s*\}/,
    );
    expect(stageSrc).toMatch(
      /\(popout \|\| previewMode\) && workspaceSelected/,
    );
    // Team data loads in popouts too; the lead is still only ensured in the
    // main window.
    expect(stageSrc).toMatch(
      /useTeamBots\(workspaceSelected\?\.id \?\? null\)/,
    );
    expect(stageSrc).toMatch(/if \(popout \|\| !workspaceSelected\) return/);
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

describe("DashboardStage — Bot monitor hand-off (TEAM-011 B3)", () => {
  it("gives the dock openBotsView and openBotSettings", () => {
    expect(stageSrc).toMatch(
      /workspaceData: workspaceSelected,\s*workspaces: workspaceConfig,\s*openBotsView,\s*openBotSettings,/,
    );
  });

  it("switches in place for the dashboard you're viewing, else pops it out", () => {
    expect(stageSrc).toMatch(
      /String\(workspaceId\) === String\(workspaceSelected\.id\) &&\s*previewMode/,
    );
    expect(stageSrc).toMatch(
      /window\.mainApi\.popout\.open\(workspaceId, \{\s*view: "bots",\s*botId,\s*tab,\s*\}\)/,
    );
  });

  it("a popout can start in Bots mode on a bot, and be re-focused", () => {
    expect(stageSrc).toMatch(/popoutView = null,/);
    expect(stageSrc).toMatch(/popoutBotId = null,/);
    expect(stageSrc).toMatch(/popout\.onShowBots\(/);
    expect(stageSrc).toMatch(/focus=\{botsFocus\}/);
  });

  it("Open in Settings goes to Settings › Bots", () => {
    expect(stageSrc).toMatch(/openAppSettings\("bots"\)/);
  });
});

describe("DashboardStage — leaving the Bots view with unsaved edits (TEAM-011 gaps)", () => {
  it("tracks the Bots view's unsaved edits and hands it Settings", () => {
    expect(stageSrc).toMatch(/const botsDirtyRef = useRef\(false\)/);
    expect(stageSrc).toMatch(
      /onDirtyChange=\{\(d\) => \{\s*botsDirtyRef\.current = d;\s*\}\}/,
    );
    expect(stageSrc).toMatch(
      /onOpenSettings=\{\(section\) => openAppSettings\(section\)\}/,
    );
  });

  it("the header's Dashboard switch and edit button ask first", () => {
    expect(stageSrc).toMatch(
      /const leaveBotsGuarded = \(action\) => \{\s*if \(stageMode === "bots" && botsDirtyRef\.current\) \{\s*setPendingLeaveBots\(\(\) => action\);/,
    );
    expect(stageSrc).toMatch(
      /onStageModeChange=\{\s*popout \|\| previewMode\s*\?\s*\(mode\) =>\s*mode === "bots"\s*\?\s*setStageMode\(mode\)\s*:\s*leaveBotsGuarded\(\(\) => setStageMode\(mode\)\)/,
    );
    expect(stageSrc).toMatch(/leaveBotsGuarded\(handleToggleEditMode\)/);
    expect(stageSrc).toMatch(/title="Discard unsaved changes\?"/);
  });
});

describe("DashboardStage — dashboard tabs respect unsaved bot edits (TEAM-011)", () => {
  it("switching to another tab goes through the guard; the current tab doesn't", () => {
    // Bot edits first, then unsaved layout edits (app-navigation NAV-002 AC6).
    expect(stageSrc).toMatch(
      /onSwitchTab=\{\(tabId\) =>\s*tabId === activeTabId\s*\?\s*handleSwitchTab\(tabId\)\s*:\s*leaveBotsGuarded\(\(\) => handleSwitchTabGuarded\(tabId\)\)\s*\}/,
    );
  });

  it("closing the current tab goes through the guard; background tabs don't", () => {
    expect(stageSrc).toMatch(
      /onCloseTab=\{\(tabId\) =>\s*tabId === activeTabId\s*\?\s*leaveBotsGuarded\(\(\) => handleCloseTab\(tabId\)\)\s*:\s*handleCloseTab\(tabId\)\s*\}/,
    );
  });

  it("opening another dashboard checks layout edits, then bot edits", () => {
    expect(stageSrc).toMatch(
      /function handleOpenTabGuarded\(workspaceItem\) \{[\s\S]{0,500}setPendingNavigation\([\s\S]{0,400}if \(switchingAway\) \{\s*leaveBotsGuarded\(\(\) => handleOpenTab\(workspaceItem\)\);\s*return;\s*\}\s*handleOpenTab\(workspaceItem\);/,
    );
  });

  it("the Assistant's open/close commands stay unguarded", () => {
    expect(stageSrc).toMatch(
      /if \(ws && handleOpenTabRef\.current\) handleOpenTabRef\.current\(ws\);/,
    );
  });

  it("the prompt reads neutrally (tabs too)", () => {
    expect(stageSrc).toMatch(
      /This bot's settings have changes that haven't been saved\. Discard them and continue\?/,
    );
  });
});
