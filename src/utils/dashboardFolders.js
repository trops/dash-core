/**
 * Dashboards and their folders (menu items), shared by the Dashboards page
 * and the left nav.
 *
 * A dashboard's folder is its `menuId`. Ids are saved sometimes as numbers
 * and sometimes as text ("1777165825716"), so they're always compared as
 * text; nothing on disk is rewritten.
 */

/** The folder-column / nav keys that aren't a folder id. */
export const ALL_DASHBOARDS = "all";
export const NOT_IN_A_FOLDER = "none";

export const sameId = (a, b) =>
  a !== null && a !== undefined && b !== null && b !== undefined
    ? String(a) === String(b)
    : false;

/** The folder a dashboard is in, or null (none, or a folder that's gone). */
export const folderOf = (ws, menuItems = []) =>
  (ws && menuItems.find((m) => sameId(m.id, ws.menuId))) || null;

/** The folder's icon, as the nav and pickers show it. */
export const folderIcon = (folder) =>
  (folder && (folder.icon || folder.folder)) || "folder";

/** Folders A–Z. */
export const sortedFolders = (menuItems = []) =>
  [...menuItems].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

// Older dashboards carry their save time only as `version` (Date.now()).
const stamp = (ws) => {
  const raw =
    ws &&
    (ws.updatedAt ||
      ws.lastModified ||
      (typeof ws.version === "number" && ws.version > 1e12 ? ws.version : 0));
  if (!raw) return 0;
  const n = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
};

/** Newest changed first; ties keep their saved order. */
export const newestFirst = (workspaces = []) =>
  workspaces
    .map((ws, i) => ({ ws, i }))
    .sort((a, b) => stamp(b.ws) - stamp(a.ws) || a.i - b.i)
    .map((x) => x.ws);

/**
 * The dashboards under a folder-column / nav key: ALL_DASHBOARDS,
 * NOT_IN_A_FOLDER, or a folder id.
 */
export const dashboardsIn = (key, workspaces = [], menuItems = []) => {
  if (key === ALL_DASHBOARDS) return workspaces;
  if (key === NOT_IN_A_FOLDER)
    return workspaces.filter((ws) => !folderOf(ws, menuItems));
  return workspaces.filter((ws) => sameId(ws.menuId, key));
};

/**
 * A dashboard moved into a folder (or out of every folder, with null). The
 * folder's own id is kept as saved, so the dashboard matches it exactly.
 */
export const withFolder = (ws, folder) => ({
  ...ws,
  menuId: folder ? folder.id : null,
});
