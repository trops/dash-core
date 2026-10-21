/**
 * Dashboard Config hands one widget to the edit panel (consolidation Phase
 * 3P): where that widget is — its layout item, the layout it's in, its page
 * (null for the pinned sidebar or a dashboard without pages) and its scope.
 *
 * @param {object} workspace  the dashboard being edited
 * @param {{ uuid?: string, component?: string, itemId?: string|number }} target
 *   what Config knows about the widget: its uuid, or its component and
 *   layout id
 * @returns {{ item, layout, pageId, scope } | null}
 */
export function findWidgetForHandOff(workspace, target) {
  if (!workspace || !target) return null;
  const matches = (i) =>
    !!i &&
    ((target.uuid != null &&
      (i.uuid === target.uuid || i.uuidString === target.uuid)) ||
      (target.component != null &&
        target.itemId != null &&
        i.component === target.component &&
        String(i.id) === String(target.itemId)));
  const pages = Array.isArray(workspace.pages) ? workspace.pages : [];
  for (const page of pages) {
    const layout = Array.isArray(page && page.layout) ? page.layout : [];
    const item = layout.find(matches);
    if (item) return { item, layout, pageId: page.id ?? null, scope: "main" };
  }
  if (!pages.length && Array.isArray(workspace.layout)) {
    const item = workspace.layout.find(matches);
    if (item) {
      return { item, layout: workspace.layout, pageId: null, scope: "main" };
    }
  }
  if (Array.isArray(workspace.sidebarLayout)) {
    const item = workspace.sidebarLayout.find(matches);
    if (item) {
      return {
        item,
        layout: workspace.sidebarLayout,
        pageId: null,
        scope: "sidebar",
      };
    }
  }
  return null;
}
