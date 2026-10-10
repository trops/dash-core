/**
 * Edit-mode staging helpers (create-entry CRE-006 AC6).
 *
 * While a dashboard is being edited, every change waits for Save. Save reads
 * each page's layout from `pageRefsMap` and the pinned sidebar's layout from
 * `sidebarWorkspaceRef` (LayoutBuilder keeps those current), so a change made
 * outside LayoutBuilder — a provider pick, a Dashboard Config bulk edit, a
 * grid ↔ sidebar move — must be mirrored into them or Save writes the stale
 * layout.
 */

/**
 * Mirror a workspace's page layouts and sidebar layout into Save's refs.
 * Updates an existing page ref in place (a mounted LayoutBuilder holds that
 * object), and creates one for a page that has none yet.
 *
 * @param {object|null} ws
 * @param {{ pageRefsMap: { current: object },
 *           sidebarWorkspaceRef: { current: object|null } }} refs
 */
export function syncLayoutRefs(ws, { pageRefsMap, sidebarWorkspaceRef }) {
  if (!ws) return;
  if (Array.isArray(ws.sidebarLayout)) {
    sidebarWorkspaceRef.current = {
      ...(sidebarWorkspaceRef.current || {}),
      layout: ws.sidebarLayout,
    };
  }
  if (!Array.isArray(ws.pages)) return;
  for (const page of ws.pages) {
    if (!page || !page.id || !Array.isArray(page.layout)) continue;
    if (!pageRefsMap.current[page.id]) {
      pageRefsMap.current[page.id] = { current: null };
    }
    pageRefsMap.current[page.id].current = {
      ...(pageRefsMap.current[page.id].current || {}),
      layout: page.layout,
    };
  }
}
