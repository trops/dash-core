/**
 * NewProviderPicker — class chooser shown when "+ New Provider" is
 * clicked from the Settings → Providers header without a pre-selected
 * class. Mirrors the existing InstallWidgetPicker pattern (3 option
 * cards: Credentials / MCP / WebSocket).
 *
 * Static source-presence test asserting:
 *   1. NewProviderPicker.js source exists and exports the component.
 *   2. The three card titles are present (Credentials, MCP, WebSocket).
 *   3. ProvidersSection.js wires the chooser via `isShowingClassChooser`
 *      state and imports NewProviderPicker.
 *
 * Why static rather than RTL: the chooser sits inside ProvidersSection,
 * which has many context dependencies (AppContext, dashApi, MCP
 * catalog). The static check verifies wiring; behavior is verified
 * end-to-end via the dash-electron-side hand-off after publish.
 */
const fs = require("fs");
const path = require("path");

describe("NewProviderPicker — class chooser wiring", () => {
  const detailsDir = path.join(__dirname);
  const sectionsDir = path.join(__dirname, "..", "sections");

  test("NewProviderPicker.js exists and exports the component", () => {
    const file = path.join(detailsDir, "NewProviderPicker.js");
    expect(fs.existsSync(file)).toBe(true);
    const source = fs.readFileSync(file, "utf8");
    expect(source).toMatch(/export\s+const\s+NewProviderPicker/);
  });

  test("NewProviderPicker shows all three class cards", () => {
    const source = fs.readFileSync(
      path.join(detailsDir, "NewProviderPicker.js"),
      "utf8",
    );
    expect(source).toMatch(/Credential/);
    expect(source).toMatch(/MCP/);
    expect(source).toMatch(/WebSocket/);
  });

  test("NewProviderPicker invokes onSelect with class strings", () => {
    const source = fs.readFileSync(
      path.join(detailsDir, "NewProviderPicker.js"),
      "utf8",
    );
    expect(source).toMatch(/onSelect\(["']credential["']\)/);
    expect(source).toMatch(/onSelect\(["']mcp["']\)/);
    expect(source).toMatch(/onSelect\(["']websocket["']\)/);
  });

  test("ProvidersSection imports NewProviderPicker and uses isShowingClassChooser", () => {
    const source = fs.readFileSync(
      path.join(sectionsDir, "ProvidersSection.js"),
      "utf8",
    );
    expect(source).toMatch(/NewProviderPicker/);
    expect(source).toMatch(/isShowingClassChooser/);
  });

  test("ProvidersSection routes WebSocket class on the createRequested path", () => {
    const source = fs.readFileSync(
      path.join(sectionsDir, "ProvidersSection.js"),
      "utf8",
    );
    // The createRequested useEffect must branch on `websocket`
    // (in addition to the existing mcp + credential branches) so
    // the deep-link from Widget Builder works for WebSocket types.
    expect(source).toMatch(/initialProviderClass.*===\s*["']websocket["']/);
  });
});
