/**
 * Install gate (consolidation Phase 1a): a refused install comes back as
 * "Error invoking remote method …: Error: <name> wasn't installed — it
 * didn't pass its checks:\n- …". Every screen that installs a widget shows
 * that reason cleaned (cleanIpcError) and whole (line breaks kept).
 */
const fs = require("fs");
const path = require("path");

const src = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// Screens that call window.mainApi.widgets.install / installLocal.
const INSTALLERS = [
  "Widget/MissingWidgetsModal.js",
  "Widget/WidgetNotFound.js",
  "Components/AppPages/useWidgetInstall.js",
  "Components/Layout/Builder/Enhanced/EnhancedWidgetDropdown.js",
  "hooks/useRegistrySearch.js",
  "hooks/useWidgetUpdates.js",
];

// Where those reasons are shown: [file, the expression shown].
const DISPLAYS = [
  ["Components/Settings/details/PublishWidgetModal.js", "{result.error}"],
  ["Components/Settings/details/RegistryPackageDetail.js", "{installError}"],
  [
    "Components/Layout/Builder/Enhanced/EnhancedWidgetDropdown.js",
    "{installError}",
  ],
  ["Components/Navigation/WidgetSidebar.js", "{registry.installError}"],
];

describe("install errors are shown cleaned and whole", () => {
  test.each(INSTALLERS)("%s cleans the IPC wrapper", (rel) => {
    const code = src(rel);
    expect(code).toMatch(/import \{[^}]*\bcleanIpcError\b[^}]*\} from/);
    // No raw err.message left as the shown reason.
    expect(code).not.toMatch(/(?:setInstallError|setError)\(\s*err\.message/);
    expect(code).not.toMatch(/error: err\.message \|\|/);
  });

  test.each(DISPLAYS)("%s keeps the reason's line breaks", (rel, shown) => {
    const code = src(rel);
    let at = code.indexOf(shown);
    expect(at).toBeGreaterThan(-1);
    while (at > -1) {
      const tagStart = code.lastIndexOf("<", at);
      const tag = code.slice(tagStart, code.indexOf(">", tagStart) + 1);
      if (/className=/.test(tag) && !/^<\//.test(tag)) {
        expect(tag).toMatch(/whitespace-pre-wrap/);
      }
      at = code.indexOf(shown, at + 1);
    }
  });
});
