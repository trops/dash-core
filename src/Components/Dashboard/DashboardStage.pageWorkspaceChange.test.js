/**
 * handlePageWorkspaceChange must update React state (openTabs), not
 * just the per-page ref.
 *
 * Bug: when a widget edit happens on a page (any workspace with
 * activePageId), the change flows through PageLayoutBuilder →
 * onPageWorkspaceChange → DashboardStage.handlePageWorkspaceChange.
 * That handler only updated `pageRefsMap.current[pageId]` — leaving
 * the React state `openTabs` (and therefore `workspaceSelected`,
 * which is derived from it) stale. The dashboard config bulk-edit
 * modal reads `workspaceSelected` directly, so even though every
 * other cycle's fix landed correctly, the bulk modal still saw
 * pre-edit data.
 *
 * The fix is in DashboardStage.handlePageWorkspaceChange — it must
 * also call setOpenTabs to:
 *   1) replace the matching page's layout with the updated one
 *   2) mirror the workspace-level selectedProviders map (so the
 *      layer-2 writes from PanelEditItemProviders propagate)
 *
 * Static source-presence test mirroring the LayoutBuilder
 * propagation pattern. Extracts just the handlePageWorkspaceChange
 * block so the assertions can't accidentally match a sibling
 * helper.
 */
const fs = require("fs");
const path = require("path");

describe("DashboardStage.handlePageWorkspaceChange — state propagation", () => {
  const stagePath = path.join(__dirname, "DashboardStage.js");
  const source = fs.readFileSync(stagePath, "utf8");

  // Capture the function body. Defined as a useCallback assigned to
  // a const; prettier may put the params/body on separate lines, so
  // the regex tolerates whitespace and newlines between the
  // `useCallback(` and the params, and between the body's closing
  // `}` and the `, [deps]` array.
  const handlerMatch = source.match(
    /handlePageWorkspaceChange\s*=\s*useCallback\(\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/,
  );

  test("handlePageWorkspaceChange function block exists in the source", () => {
    expect(handlerMatch).not.toBeNull();
  });

  test("preserves the existing pageRefsMap update (save path still reads from it)", () => {
    expect(handlerMatch[1]).toMatch(/pageRefsMap\.current/);
  });

  test("calls setOpenTabs so workspaceSelected (derived from openTabs) stays in sync", () => {
    // Without this, the dashboard config bulk-edit modal — which
    // reads workspaceSelected — keeps showing pre-edit provider
    // bindings even after the user unsets a provider in the
    // per-widget settings.
    expect(handlerMatch[1]).toMatch(/setOpenTabs/);
  });

  test("propagates the new page layout into the matching page entry", () => {
    expect(handlerMatch[1]).toMatch(/layout/);
  });

  test("propagates the workspace-level selectedProviders map (layer-2 writes)", () => {
    // PanelEditItemProviders writes layer 2 (workspace.selectedProviders[id])
    // — that update must reach the openTabs state, otherwise the
    // bulk modal's resolveProviderName fallback finds the stale
    // value. The handler must reference selectedProviders explicitly
    // so the merge picks it up.
    expect(handlerMatch[1]).toMatch(/selectedProviders/);
  });
});
