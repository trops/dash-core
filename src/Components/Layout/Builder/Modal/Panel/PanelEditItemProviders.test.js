/**
 * PanelEditItemProviders.handleProviderChange must write through to
 * BOTH provider-binding layers — the per-widget item.selectedProviders
 * (layer 1) AND the workspace.selectedProviders[widgetId] map (layer 2).
 *
 * Bug repro: open a widget's per-widget settings → Providers tab →
 * unset a provider → Save Changes → open the dashboard config bulk
 * modal. Expected: bulk modal shows the binding cleared. Actual
 * (before this fix): bulk modal still shows the OLD provider as set
 * because PanelEditItemProviders only deleted the layer-1 key. Layer
 * 2 retained the stale value, and `resolveProviderName` fell through
 * empty layer 1 to find it.
 *
 * Same write-through invariant applyBulkProviderBindings enforces
 * for the bulk path. Both write paths must agree or the modals fall
 * out of sync.
 *
 * Static source-presence test mirroring the LayoutBuilder
 * propagation pattern. Extracts just the handleProviderChange block
 * so the assertions can't accidentally match a sibling helper.
 */
const fs = require("fs");
const path = require("path");

describe("PanelEditItemProviders.handleProviderChange — both-layer write-through", () => {
  const panelPath = path.join(__dirname, "PanelEditItemProviders.js");
  const source = fs.readFileSync(panelPath, "utf8");

  const handlerMatch = source.match(
    /function handleProviderChange\([\s\S]*?\n  \}\n/,
  );

  test("handleProviderChange function block exists in the source", () => {
    expect(handlerMatch).not.toBeNull();
  });

  test("layer 1: updates updatedItem.selectedProviders (existing behaviour)", () => {
    expect(handlerMatch[0]).toMatch(/updatedItem\.selectedProviders/);
  });

  test("layer 2: also updates updatedWorkspace.selectedProviders so the bulk modal sees the change", () => {
    expect(handlerMatch[0]).toMatch(/updatedWorkspace\.selectedProviders/);
  });

  test("layer 2: keys by the canonical widget-identity chain (uuidString || uuid || id)", () => {
    // Same chain `applyBulkProviderBindings` uses; required so the
    // workspace-level write lands under the key the runtime hooks
    // and bulk modal will read by.
    expect(handlerMatch[0]).toMatch(
      /uuidString\s*\|\|[\s\S]{0,40}uuid\s*\|\|[\s\S]{0,40}id/,
    );
  });
});
