/**
 * activeLayout.js
 *
 * Which layout a tool should read and write (create-entry PRD CRE-011,
 * scenarios G4). Dashboards with pages draw the shown page's layout
 * (`pages[].layout`, the page `activePageId` names, else the first); the
 * top-level `layout` is only a mirror of the shown page, written when the
 * dashboard saves (src/utils/layout.js). Dashboards without pages draw the
 * top-level layout.
 *
 * Writing the mirror alone — what the AI Assistant's layout tools used to
 * do — changes nothing on screen and is lost at the next save.
 *
 * Pure (NFR-006): no Electron.
 */
"use strict";

/** The page the dashboard shows, or null for a dashboard without pages. */
function shownPage(ws) {
  if (!ws || !Array.isArray(ws.pages) || !ws.pages.length) return null;
  return ws.pages.find((p) => p && p.id === ws.activePageId) || ws.pages[0];
}

/**
 * Resolve a page by id or name (case-insensitive); none asked → the shown
 * page. @returns {{ page: object|null, error?: string }}
 */
function resolvePage(ws, page) {
  const hasPages = ws && Array.isArray(ws.pages) && ws.pages.length > 0;
  if (page === undefined || page === null || page === "") {
    return { page: shownPage(ws) };
  }
  if (!hasPages) {
    return { page: null, error: "This dashboard has no pages." };
  }
  const want = String(page).trim().toLowerCase();
  const hit =
    ws.pages.find((p) => p && String(p.id).toLowerCase() === want) ||
    ws.pages.find(
      (p) =>
        p &&
        String(p.name || "")
          .trim()
          .toLowerCase() === want,
    );
  if (!hit) {
    return {
      page: null,
      error: `No page "${page}". Pages: ${ws.pages
        .map((p) => p && p.name)
        .filter(Boolean)
        .join(", ")}.`,
    };
  }
  return { page: hit };
}

/**
 * The layout a tool works on: the asked-for page's, else the shown page's,
 * else the top-level layout. @returns {{ layout: object[], page: object|null,
 * error?: string }}
 */
function layoutOf(ws, page) {
  const res = resolvePage(ws, page);
  if (res.error) return { layout: [], page: null, error: res.error };
  if (res.page) {
    return {
      layout: Array.isArray(res.page.layout) ? res.page.layout : [],
      page: res.page,
    };
  }
  return {
    layout: Array.isArray(ws && ws.layout) ? ws.layout : [],
    page: null,
  };
}

/**
 * Put a changed layout back where it came from (mutates `ws`): into its page,
 * and into the top-level mirror when that page is the one shown (or the
 * dashboard has no pages).
 */
function withLayout(ws, layout, page) {
  if (page) {
    page.layout = layout;
    if (page === shownPage(ws)) ws.layout = JSON.parse(JSON.stringify(layout));
  } else {
    ws.layout = layout;
  }
  return ws;
}

/** Every layout the dashboard holds (each page's, or the top-level one). */
function allLayouts(ws) {
  if (ws && Array.isArray(ws.pages) && ws.pages.length) {
    return ws.pages.map((p) => (p && Array.isArray(p.layout) ? p.layout : []));
  }
  return [Array.isArray(ws && ws.layout) ? ws.layout : []];
}

module.exports = { shownPage, resolvePage, layoutOf, withLayout, allLayouts };
