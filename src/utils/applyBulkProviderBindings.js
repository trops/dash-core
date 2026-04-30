/**
 * applyBulkProviderBindings — pure utility for the dashboard config
 * bulk-edit modal's Save path.
 *
 * Takes a workspace + a flat array of provider-binding changes and
 * returns a new workspace with EVERY change reflected in BOTH layers
 * the runtime resolution chain reads from:
 *
 *   layer 1 — `item.selectedProviders[type]` on every matching layout
 *             item (in workspace.layout, every page layout, and the
 *             sidebar layout)
 *   layer 2 — `workspace.selectedProviders[widgetId][type]`
 *
 * Why both: `resolveProviderName` (utils/providerResolution.js)
 * checks layer 1 *first*. Before this helper, the bulk save wrote
 * only layer 2, so a stale layer-1 value (from a prior single-widget
 * pick or a registry import) silently shadowed the user's bulk pick
 * — the user picked a provider, hit Save, and the widget rendered
 * the old value (or nothing).
 *
 * This helper writes through to both layers so a user-driven bulk
 * choice can't be shadowed by stale layer-1 data.
 *
 * Pure: does not mutate the input. Returns a new workspace object
 * when changes are applied; returns the input unchanged when there's
 * nothing to do.
 *
 * @param {Object} workspace
 * @param {Array<{widgetId: string|number, providerType: string, providerName: string|null}>} changes
 * @returns {Object} new workspace
 */
function widgetMatchesId(item, widgetId) {
  if (!item || widgetId == null) return false;
  // Same canonical chain as getAllProviderBindings + the runtime
  // hooks: uuidString preferred, then uuid, then numeric id. String-
  // coerce both sides because workspace.selectedProviders keys are
  // always strings (Object keys) but item.id is a number.
  const target = String(widgetId);
  if (item.uuidString && String(item.uuidString) === target) return true;
  if (item.uuid && String(item.uuid) === target) return true;
  if (item.id != null && String(item.id) === target) return true;
  return false;
}

function shouldClear(providerName) {
  return (
    providerName == null ||
    (typeof providerName === "string" && providerName.trim() === "")
  );
}

/**
 * Apply every change to a single layout array, returning a new array
 * if anything changed, otherwise the same reference.
 */
function applyToLayoutArray(layout, changesByWidgetId) {
  if (!Array.isArray(layout)) return layout;
  let changed = false;
  const next = layout.map((item) => {
    if (!item) return item;
    let matchedChanges = null;
    for (const [widgetId, perTypeChanges] of changesByWidgetId.entries()) {
      if (widgetMatchesId(item, widgetId)) {
        matchedChanges = perTypeChanges;
        break;
      }
    }
    if (!matchedChanges) return item;
    const nextSelected = { ...(item.selectedProviders || {}) };
    let itemChanged = false;
    for (const [providerType, providerName] of Object.entries(matchedChanges)) {
      if (shouldClear(providerName)) {
        if (providerType in nextSelected) {
          delete nextSelected[providerType];
          itemChanged = true;
        }
      } else if (nextSelected[providerType] !== providerName) {
        nextSelected[providerType] = providerName;
        itemChanged = true;
      }
    }
    if (!itemChanged) return item;
    changed = true;
    return { ...item, selectedProviders: nextSelected };
  });
  return changed ? next : layout;
}

export function applyBulkProviderBindings(workspace, changes) {
  if (!workspace || !Array.isArray(changes) || changes.length === 0) {
    return workspace;
  }

  // Group changes by widgetId so we can match each layout item once
  // and apply every type-level change on it in a single pass.
  const changesByWidgetId = new Map();
  for (const change of changes) {
    if (!change || !change.widgetId || !change.providerType) continue;
    const id = String(change.widgetId);
    if (!changesByWidgetId.has(id)) changesByWidgetId.set(id, {});
    changesByWidgetId.get(id)[change.providerType] = change.providerName;
  }
  if (changesByWidgetId.size === 0) return workspace;

  let nextWorkspace = workspace;
  let workspaceChanged = false;

  // ── Layer 2: workspace.selectedProviders ─────────────────────────
  const nextSelectedProviders = {
    ...(workspace.selectedProviders || {}),
  };
  let layer2Changed = false;
  for (const [widgetId, perTypeChanges] of changesByWidgetId.entries()) {
    const prev = nextSelectedProviders[widgetId]
      ? { ...nextSelectedProviders[widgetId] }
      : {};
    let entryChanged = false;
    for (const [providerType, providerName] of Object.entries(perTypeChanges)) {
      if (shouldClear(providerName)) {
        if (providerType in prev) {
          delete prev[providerType];
          entryChanged = true;
        }
      } else if (prev[providerType] !== providerName) {
        prev[providerType] = providerName;
        entryChanged = true;
      }
    }
    if (entryChanged) {
      if (Object.keys(prev).length === 0) {
        if (widgetId in nextSelectedProviders) {
          delete nextSelectedProviders[widgetId];
          layer2Changed = true;
        }
      } else {
        nextSelectedProviders[widgetId] = prev;
        layer2Changed = true;
      }
    }
  }
  if (layer2Changed) {
    nextWorkspace = {
      ...nextWorkspace,
      selectedProviders: nextSelectedProviders,
    };
    workspaceChanged = true;
  }

  // ── Layer 1: item.selectedProviders on every matching layout item ─
  // Coverage mirrors `forEachWidget`: main layout, every page layout,
  // sidebar layout. Reconciliation walks the same dimensions, so this
  // stays consistent with `liveItemIds`.

  // Main layout
  if (Array.isArray(nextWorkspace.layout)) {
    const newLayout = applyToLayoutArray(
      nextWorkspace.layout,
      changesByWidgetId,
    );
    if (newLayout !== nextWorkspace.layout) {
      nextWorkspace = { ...nextWorkspace, layout: newLayout };
      workspaceChanged = true;
    }
  }

  // Per-page layouts
  if (Array.isArray(nextWorkspace.pages)) {
    let pagesChanged = false;
    const nextPages = nextWorkspace.pages.map((page) => {
      if (!page || !Array.isArray(page.layout)) return page;
      const newLayout = applyToLayoutArray(page.layout, changesByWidgetId);
      if (newLayout !== page.layout) {
        pagesChanged = true;
        return { ...page, layout: newLayout };
      }
      return page;
    });
    if (pagesChanged) {
      nextWorkspace = { ...nextWorkspace, pages: nextPages };
      workspaceChanged = true;
    }
  }

  // Sidebar layout
  if (Array.isArray(nextWorkspace.sidebarLayout)) {
    const newSidebar = applyToLayoutArray(
      nextWorkspace.sidebarLayout,
      changesByWidgetId,
    );
    if (newSidebar !== nextWorkspace.sidebarLayout) {
      nextWorkspace = { ...nextWorkspace, sidebarLayout: newSidebar };
      workspaceChanged = true;
    }
  }

  return workspaceChanged ? nextWorkspace : workspace;
}
