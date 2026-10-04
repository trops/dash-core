/**
 * themeSummary — the Themes page's view of the installed themes
 * (app-navigation PRD NAV-009): rows with the app theme first and which
 * dashboards use each theme, search / chips, Duplicate's copy, and theme
 * colours as inline values for previews. Pure.
 */

const nameOf = (key, theme) => (theme && theme.name) || key;

/**
 * @returns {Array<{ key, name, theme, isApp, usedBy: Array<{ workspaceId,
 *   workspaceName }> }>} — the app theme first, then A-Z by name.
 */
export function themeRows(
  themes,
  { appThemeKey = null, workspaces = [] } = {},
) {
  const rows = Object.entries(themes || {}).map(([key, theme]) => ({
    key,
    name: nameOf(key, theme),
    theme,
    isApp: key === appThemeKey,
    usedBy: (workspaces || [])
      .filter((ws) => ws && ws.themeKey === key)
      .map((ws) => ({
        workspaceId: ws.id,
        workspaceName: ws.name || String(ws.id),
      })),
  }));
  return rows.sort(
    (a, b) => Number(b.isApp) - Number(a.isApp) || a.name.localeCompare(b.name),
  );
}

const inUse = (row) => row.isApp || row.usedBy.length > 0;
const CHIPS = { inUse, notUsed: (row) => !inUse(row) };

/** Search by name, then the In use / Not used chips. */
export function filterThemes(rows, { query = "", chip } = {}) {
  const q = query.trim().toLowerCase();
  const keep = CHIPS[chip] || (() => true);
  return (rows || []).filter(
    (row) => keep(row) && (!q || row.name.toLowerCase().includes(q)),
  );
}

/**
 * A copy of a raw (stored) theme for Duplicate: a new `theme-<time>` key (as
 * the creation wizard makes), "<name> (Copy)", and no registry metadata — the
 * copy is the user's own, so it can be published.
 */
export function duplicateTheme(raw, key, now = Date.now()) {
  const newKey = `theme-${now}`;
  const copy = JSON.parse(JSON.stringify(raw || {}));
  delete copy._registryMeta;
  return {
    key: newKey,
    theme: { ...copy, id: newKey, name: `${nameOf(key, raw)} (Copy)` },
  };
}

/**
 * A theme token's colour (hex) for an inline style. ThemeModel resolves
 * `cssValue` for every theme, so non-active themes preview correctly.
 */
export function paint(variant, token) {
  return (variant && variant.cssValue && variant.cssValue[token]) || undefined;
}
