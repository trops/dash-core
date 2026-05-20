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

describe("PanelEditItemProviders — default-provider fallback awareness", () => {
  // The widget-instance provider panel used to mark any required
  // provider with no per-instance pick as "REQUIRED" in red, even
  // when a global default (provider.isDefaultForType === true) would
  // be used at runtime. The runtime resolution chain (see
  // resolveProviderName in utils/providerResolution.js) already
  // falls through to the default, so the UI flagging "missing" was
  // a divergence between displayed and actual state — the user
  // would see red on a widget that was actually working. These
  // tests pin the three-state rendering: overridden /
  // using-default / missing.
  const panelPath = path.join(__dirname, "PanelEditItemProviders.js");
  const source = fs.readFileSync(panelPath, "utf8");

  test("detects the global default via options.find with isDefaultForType predicate", () => {
    expect(source).toMatch(/options\.find\([\s\S]{0,60}isDefaultForType/);
  });

  test("derives isUsingDefault from 'per-instance empty AND default exists'", () => {
    expect(source).toMatch(
      /isUsingDefault\s*=\s*!isConfigured\s*&&\s*!!defaultOption/,
    );
  });

  test("isMissing now requires NO default to exist (not just NO per-instance pick)", () => {
    // The bug fix: missing must be `required && !configured && !defaultOption`.
    // The old form `required && !configured` would trigger red even
    // when a default existed.
    expect(source).toMatch(
      /isMissing\s*=\s*req\.required\s*&&\s*!isConfigured\s*&&\s*!defaultOption/,
    );
  });

  test("renders a 'using default' badge when isUsingDefault is true", () => {
    expect(source).toMatch(/isUsingDefault\s*&&[\s\S]+?using default/i);
  });

  test("surfaces the resolved default name to the user so they know what's wired", () => {
    expect(source).toMatch(/Using global default/);
  });

  test("the select 'no selection' option shows the default name when applicable", () => {
    expect(source).toMatch(/use default \(\$\{resolvedName\}\)/);
  });

  test("options dropdown annotates the default entry with (default)", () => {
    expect(source).toMatch(/isDefaultForType\s*\?\s*["'`].*default/);
  });
});
