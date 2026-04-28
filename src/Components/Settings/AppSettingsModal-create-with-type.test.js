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

describe("AppSettingsModal — create-provider-with-type wiring", () => {
  test("AppSettingsModal accepts initialProviderType + initialProviderClass", () => {
    const source = readSrc("AppSettingsModal.js");
    expect(source).toMatch(/initialProviderType/);
    expect(source).toMatch(/initialProviderClass/);
  });

  test("AppSettingsModal threads new props to ProvidersSection", () => {
    const source = readSrc("AppSettingsModal.js");
    // Both prop names should appear at least twice — once in the
    // function signature and once in the JSX prop pass-through.
    const providerTypeCount = (source.match(/initialProviderType/g) || [])
      .length;
    const providerClassCount = (source.match(/initialProviderClass/g) || [])
      .length;
    expect(providerTypeCount).toBeGreaterThanOrEqual(2);
    expect(providerClassCount).toBeGreaterThanOrEqual(2);
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
