/**
 * One door for making things (consolidation Phase 2a): every "New …" opens
 * Create; the Wizard and the old New Dashboard picker are gone; ⌘N / Ctrl+N
 * opens Create. Source checks, like botsTabWiring.test.js.
 */
const fs = require("fs");
const path = require("path");

const read = (...p) =>
  fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const stageSrc = read("Dashboard", "DashboardStage.js");

describe("DashboardStage — one door (Phase 2a)", () => {
  it("the empty screen's New Dashboard opens Create on Dashboard, with no Wizard", () => {
    expect(stageSrc).toMatch(
      /text="New Dashboard"\s*onClick=\{\(\) => openCreate\("dashboard"\)\}/,
    );
    expect(stageSrc).not.toMatch(/Wizard/);
  });

  it("the palette's New Dashboard opens Create on Dashboard", () => {
    expect(stageSrc).toMatch(
      /onCreateNewWorkspace=\{\(\) => openCreate\("dashboard"\)\}/,
    );
  });

  it("⌘N (Mac) / Ctrl+N opens Create — not while editing, over a dialog, or in a popout", () => {
    expect(stageSrc).toMatch(
      /isMac \? e\.metaKey && !e\.ctrlKey : e\.ctrlKey && !e\.metaKey/,
    );
    expect(stageSrc).toMatch(/e\.key !== "n" && e\.key !== "N"/);
    expect(stageSrc).toMatch(/e\.repeat/);
    expect(stageSrc).toMatch(/if \(editingRef\.current\) return;/);
    expect(stageSrc).toMatch(/document\.querySelector\('\[role="dialog"\]'\)/);
    expect(stageSrc).toMatch(
      /setCreateRequest\(\(r\) => r \|\| \{ type: "auto", workspaceId: null \}\)/,
    );
    expect(stageSrc).toMatch(/if \(popout\) return undefined;/);
  });

  it("import and registry are Create's no-AI starts; there's no method picker", () => {
    expect(stageSrc).toMatch(
      /key === "import-dashboard" \? "import" : "registry"/,
    );
    expect(stageSrc).not.toMatch(/setLayoutInitialMethod\(null\)/);
  });
});

describe("Manage › Dashboards — New Dashboard opens Create", () => {
  it("is in OPENS_CREATE", () => {
    expect(read("AppPages", "AppPage.js")).toMatch(
      /OPENS_CREATE = \{\s*dashboards: "dashboard",\s*widgets: "widget",\s*bots: "bot",?\s*\}/,
    );
  });
});

describe("removed for good", () => {
  it.each([
    ["Layout", "DashboardWizard"],
    ["Layout", "LayoutManager", "Panel", "CreationMethodPicker.js"],
    ["Settings", "details", "NewDashboardChooser.js"],
    ["Bots", "TeamLeadSection.js"],
    ["Bots", "AskLead.js"],
    ["Bots", "BotEditorModal.js"],
    ["Dashboard", "WelcomePrompt.js"],
  ])("%s/%s", (...p) => {
    expect(fs.existsSync(path.join(__dirname, "..", ...p))).toBe(false);
  });
});
