/**
 * AppSettingsModal — create-provider-with-type wiring.
 *
 * Static source-presence test asserting the new props/identifiers
 * are wired across AppSettingsModal → ProvidersSection → catalog
 * detail. Used to support the cross-modal "Add new <type> provider"
 * flow dispatched from dash-electron's WidgetBuilderModal.
 *
 * Why static rather than RTL: the AppSettingsModal renders many
 * sections that each depend on `dashApi`, `appContext`, the MCP
 * catalog, and the dash-react `SettingsModal` shell. Mocking that
 * full surface area is out of scope for this PLAN. Static checks
 * verify the wiring exists; behavior is verified end-to-end via
 * the dash-electron-side hand-off after publish.
 */
const fs = require("fs");
const path = require("path");

const SETTINGS_DIR = path.join(__dirname);

function readSrc(rel) {
  return fs.readFileSync(path.join(SETTINGS_DIR, rel), "utf8");
}

describe("Providers page — create-provider-with-type wiring", () => {
  // Providers moved from the Settings modal to its Manage page
  // (app-navigation NAV-004): the deep link now rides AppPage's
  // `providerLink` into ProvidersSection.
  test("AppPage threads the provider deep link to ProvidersSection", () => {
    const source = readSrc("../AppPages/AppPage.js");
    expect(source).toMatch(/initialProviderName=\{link\.name/);
    expect(source).toMatch(/initialCreateRequested=\{!!link\.create\}/);
    expect(source).toMatch(/initialProviderType=\{link\.type/);
    expect(source).toMatch(/initialProviderClass=\{link\.providerClass/);
  });

  test("ProvidersSection accepts initialProviderType + initialProviderClass", () => {
    const source = readSrc("sections/ProvidersSection.js");
    expect(source).toMatch(/initialProviderType/);
    expect(source).toMatch(/initialProviderClass/);
  });

  test("ProvidersSection routes mcp class to MCP add flow", () => {
    const source = readSrc("sections/ProvidersSection.js");
    // Must reference initialProviderClass === "mcp" or equivalent
    // routing in the create-trigger logic.
    expect(source).toMatch(/initialProviderClass.*===\s*["']mcp["']/);
  });

  test("McpCatalogDetail accepts initialSelectedId", () => {
    const source = readSrc("details/McpCatalogDetail.js");
    expect(source).toMatch(/initialSelectedId/);
  });
});
