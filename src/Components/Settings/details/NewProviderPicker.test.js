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

/**
 * Back-button consistency — chooser → form → ← Back
 *
 * When the user reaches a create-provider form via the NewProviderPicker
 * class chooser (Credential / MCP / WebSocket), each form must render a
 * "← Back" affordance that returns to the chooser. The button is opt-in
 * via an `onBack` prop so the deep-link entry path (Widget Builder
 * dispatch) and the edit-mode entry path (list click → Edit) do not show
 * a button that has no chooser to return to.
 *
 * Static source-presence tests, mirroring the existing chooser-wiring tests
 * above. Behavior verified end-to-end via the dash-electron-side hand-off.
 */
describe("Create-provider forms — consistent back-to-chooser button", () => {
  const detailsDir = path.join(__dirname);
  const sectionsDir = path.join(__dirname, "..", "sections");

  const readDetail = (name) =>
    fs.readFileSync(path.join(detailsDir, name), "utf8");
  const readSection = (name) =>
    fs.readFileSync(path.join(sectionsDir, name), "utf8");

  test("ProviderDetail accepts onBack prop and renders Back conditionally", () => {
    const source = readDetail("ProviderDetail.js");
    // Prop is destructured in the component signature
    expect(source).toMatch(/onBack[\s,=}]/);
    // Renders only when onBack is provided
    expect(source).toMatch(/\{onBack\s*&&/);
    // Uses a chevron-left back arrow + "Back" label in that branch
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}chevron-left/);
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}Back/);
  });

  test("McpCatalogDetail accepts onBack prop and renders Back conditionally", () => {
    const source = readDetail("McpCatalogDetail.js");
    expect(source).toMatch(/onBack[\s,=}]/);
    expect(source).toMatch(/\{onBack\s*&&/);
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}chevron-left/);
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}Back/);
  });

  test("WebSocketProviderForm accepts onBack prop and renders Back conditionally", () => {
    const source = readDetail("WebSocketProviderForm.js");
    expect(source).toMatch(/onBack[\s,=}]/);
    expect(source).toMatch(/\{onBack\s*&&/);
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}chevron-left/);
    expect(source).toMatch(/\{onBack\s*&&[\s\S]{0,500}Back/);
  });

  test("ProvidersSection tracks chooser-entry and re-opens chooser via onBack", () => {
    const source = readSection("ProvidersSection.js");
    // A flag that distinguishes chooser-entry from deep-link / list-click entry
    expect(source).toMatch(/cameFromClassChooser/);
    // The chooser onSelect sets it true so the next form knows to show ← Back
    expect(source).toMatch(/setCameFromClassChooser\(true\)/);
    // Re-opening the chooser happens in more than one place (the original
    // createRequested useEffect path, plus the new onBack handler).
    const reopens = (source.match(/setIsShowingClassChooser\(true\)/g) || [])
      .length;
    expect(reopens).toBeGreaterThan(1);
  });

  test("ProvidersSection passes onBack only on the chooser-entry path", () => {
    const source = readSection("ProvidersSection.js");
    // onBack is forwarded to each of the three create-flow details, gated
    // on cameFromClassChooser so the edit/deep-link paths stay unaffected.
    expect(source).toMatch(/onBack=\{cameFromClassChooser/);
  });

  test("Sidebar list-item click dismisses the class chooser", () => {
    // Bug repro: chooser open + click an existing provider → list
    // highlights but chooser stays. Render-branch order has
    // isShowingClassChooser ahead of the selected-provider branch, so
    // the click was silently setting selectedName behind the chooser.
    // The list-item onClick must clear every detail-overlay flag so
    // the read-only detail wins on the next render.
    const source = readSection("ProvidersSection.js");
    const onClickBlock = source.match(
      /onClick=\{\(\)\s*=>\s*\{[\s\S]{0,800}setSelectedName\(name\)[\s\S]{0,800}\}\}/,
    );
    expect(onClickBlock).toBeTruthy();
    expect(onClickBlock[0]).toMatch(/setIsShowingClassChooser\(false\)/);
  });
});

/**
 * Providers list — search + class filter + alphabetized All view.
 *
 * The Settings → Providers sidebar has been reorganized to mirror
 * the Widgets sidebar: a search box up top, a 4-pill class filter
 * (All / Credentials / MCP / WebSocket), and a single alphabetized
 * list when the filter is "All". The per-class footer "Add MCP
 * Server" / "Add WebSocket Provider" buttons are removed in favor
 * of the chooser opened by the section-header "+ New Provider"
 * button (which got a "← Back" affordance in 0.1.455).
 */
describe("Providers list — search and class filter", () => {
  const sectionsDir = path.join(__dirname, "..", "sections");
  const readSection = (name) =>
    fs.readFileSync(path.join(sectionsDir, name), "utf8");

  test("Sidebar has a search input for filtering providers", () => {
    const source = readSection("ProvidersSection.js");
    expect(source).toMatch(/placeholder=["']Search providers/i);
  });

  test("searchQuery state is declared and wired to a setter", () => {
    const source = readSection("ProvidersSection.js");
    expect(source).toMatch(/searchQuery/);
    expect(source).toMatch(/setSearchQuery/);
  });

  test("Default class filter is 'all'", () => {
    const source = readSection("ProvidersSection.js");
    // The providerTab useState initializer must be "all".
    expect(source).toMatch(/providerTab[^=]*=\s*useState\(["']all["']\)/);
  });

  test("Sidebar has 4 class-filter triggers (All / Credentials / MCP / WebSocket)", () => {
    const source = readSection("ProvidersSection.js");
    expect(source).toMatch(/Tabs3\.Trigger\s+value=["']all["']/);
    expect(source).toMatch(/Tabs3\.Trigger\s+value=["']credentials["']/);
    expect(source).toMatch(/Tabs3\.Trigger\s+value=["']mcp["']/);
    expect(source).toMatch(/Tabs3\.Trigger\s+value=["']websocket["']/);
  });

  test("Filter logic has an 'all' branch that merges all three groups", () => {
    const source = readSection("ProvidersSection.js");
    // Some branch must compare providerTab to "all" and produce a
    // merged list containing credential + mcp + websocket providers.
    expect(source).toMatch(/providerTab\s*===\s*["']all["']/);
    // The merged-all expression spreads all three groups; capture the
    // shape of `[...credentialProviders, ...mcpProviders, ...wsProviders]`
    // (or any permutation, in case of refactor).
    expect(source).toMatch(/\.\.\.credentialProviders/);
    expect(source).toMatch(/\.\.\.mcpProviders/);
    expect(source).toMatch(/\.\.\.wsProviders/);
  });

  test("Sidebar shows a count of visible providers", () => {
    const source = readSection("ProvidersSection.js");
    // Mirrors "127 widgets" in the Widgets sidebar — assert the
    // pattern `<length>` followed by the word "provider".
    expect(source).toMatch(/\.length\}\s*\n?\s*provider/);
  });

  test("Per-tab footer 'Add MCP Server' / 'Add WebSocket Provider' buttons are removed", () => {
    const source = readSection("ProvidersSection.js");
    // The new chooser ("+ New Provider" header button) is the
    // canonical add path.
    expect(source).not.toMatch(/Add MCP Server/);
    expect(source).not.toMatch(/Add WebSocket Provider/);
  });
});
