/**
 * LayoutBuilder — workspace-id guard on AI widget placement events.
 *
 * Bug repro: a widget built with the AI Widget Builder for one
 * dashboard could appear in a different dashboard, and in some cases
 * a cell of the *other* dashboard would be overwritten — looking
 * like "every widget got replaced" when in reality the *wrong*
 * workspace's cell was being clobbered. Multiple LayoutBuilders are
 * mounted simultaneously (one per open dashboard tab) and they all
 * listen for the global `dash:place-widget-in-cell` /
 * `dash:swap-widget-in-cell` events. When the event detail's
 * `gridItemId` / `widgetId` happens to collide across workspaces
 * (small integers, very likely), the wrong workspace responds.
 *
 * The fix is a forward-compatible workspace-id guard: each handler
 * must read `workspaceId` from `e.detail` and no-op (with a
 * `console.warn`) when it is provided and doesn't match
 * `wsRef.current?.id`. The guard is opt-in (only enforced when
 * `workspaceId` is truthy) so older dash-electron versions that
 * don't yet pass the field continue to work — they just don't get
 * the protection. The dispatch-site change ships in dash-electron
 * separately.
 *
 * Static source-presence tests, mirroring the NewProviderPicker
 * pattern. Behavior is verified end-to-end after dash-electron also
 * passes `workspaceId` in the event detail.
 */
const fs = require("fs");
const path = require("path");

describe("LayoutBuilder — workspace-id guard on AI placement events", () => {
  const layoutBuilderPath = path.join(__dirname, "LayoutBuilder.js");

  // Extract the body of the `const handler = (e) => { ... };`
  // immediately preceding an `addEventListener(eventName, ...)`.
  function extractHandlerBody(source, eventName) {
    const re = new RegExp(
      "const\\s+handler\\s*=\\s*\\(e\\)\\s*=>\\s*\\{([\\s\\S]*?)\\};\\s*window\\.addEventListener\\(\\s*[\"']" +
        eventName +
        "[\"']",
    );
    const m = source.match(re);
    return m ? m[1] : null;
  }

  test("place-widget handler reads workspaceId from event detail", () => {
    const source = fs.readFileSync(layoutBuilderPath, "utf8");
    const body = extractHandlerBody(source, "dash:place-widget-in-cell");
    expect(body).not.toBeNull();
    expect(body).toMatch(/workspaceId/);
  });

  test("place-widget handler guards against wrong workspace (no-op when workspaceId mismatches wsRef.current.id)", () => {
    const source = fs.readFileSync(layoutBuilderPath, "utf8");
    const body = extractHandlerBody(source, "dash:place-widget-in-cell");
    expect(body).not.toBeNull();
    expect(body).toMatch(
      /workspaceId\s*&&\s*wsRef\.current\??\.id\s*!==\s*workspaceId/,
    );
  });

  test("swap-widget handler reads workspaceId from event detail", () => {
    const source = fs.readFileSync(layoutBuilderPath, "utf8");
    const body = extractHandlerBody(source, "dash:swap-widget-in-cell");
    expect(body).not.toBeNull();
    expect(body).toMatch(/workspaceId/);
  });

  test("swap-widget handler guards against wrong workspace (no-op when workspaceId mismatches wsRef.current.id)", () => {
    const source = fs.readFileSync(layoutBuilderPath, "utf8");
    const body = extractHandlerBody(source, "dash:swap-widget-in-cell");
    expect(body).not.toBeNull();
    expect(body).toMatch(
      /workspaceId\s*&&\s*wsRef\.current\??\.id\s*!==\s*workspaceId/,
    );
  });
});

// Consolidation Phase 2b: Create's cell builds place their widget here, into
// the open edit — on the one page and scope the cell is on, with the
// connection and settings the user picked at the preview.
describe("LayoutBuilder — placing a cell build's widget", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "LayoutBuilder.js"),
    "utf8",
  );
  test("only the named scope and page act (grid ids repeat across them)", () => {
    expect(source).toMatch(
      /if \(targetScope && targetScope !== \(scope \|\| "main"\)\) return;/,
    );
    expect(source).toMatch(
      /targetPage != null &&\s*pageId != null &&\s*targetPage !== pageId/,
    );
  });
  test("the picked settings and connection go on the new widget", () => {
    expect(source).toMatch(
      /newItem\.userPrefs = \{ \.\.\.\(newItem\.userPrefs \|\| \{\}\), \.\.\.userPrefs \};/,
    );
    expect(source).toMatch(
      /newItem\.selectedProviders = \{ \.\.\.selectedProviders \};/,
    );
  });
  test("a just-installed widget is waited for (briefly) before placing", () => {
    expect(source).toMatch(/if \(tries < 20\)/);
    expect(source).toMatch(/if \(timer\) clearTimeout\(timer\);/);
  });
});

// Consolidation Phase 3: a new widget made from one (Change with AI › Save as
// a new widget) takes its place — only on its scope and page, once it's
// registered.
describe("LayoutBuilder — swapping in a new widget made from one", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "LayoutBuilder.js"),
    "utf8",
  );
  const start = source.indexOf("// Listen for AI widget remix");
  const body = source.slice(
    start,
    source.indexOf('"dash:swap-widget-in-cell", handler);', start),
  );
  test("only the named scope and page act", () => {
    expect(body).toMatch(
      /if \(targetScope && targetScope !== \(scope \|\| "main"\)\) return;/,
    );
    expect(body).toMatch(
      /targetPage != null &&\s*pageId != null &&\s*targetPage !== pageId/,
    );
  });
  test("it waits for a just-installed widget to be registered", () => {
    expect(body).toMatch(/if \(tries < 20\)/);
  });
});
