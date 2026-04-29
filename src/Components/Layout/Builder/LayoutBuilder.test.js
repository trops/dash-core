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
