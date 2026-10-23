/**
 * The Add panel's "Recently created" group (QA 2026-10-22): the user's own
 * widgets — made in Create or the Widget Builder (@ai-built), published under
 * their username, or loaded from their own folder — newest first, so what
 * they just made is the first thing they can place.
 *
 * When a package was installed comes from its registry entry (`registeredAt`,
 * written on every install or update and kept across restarts).
 */
import { widgetSource } from "./widgetSource";

export const RECENT_LIMIT = 5;
export const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Array<{ key: string, widget: object }>} widgets  the sidebar's widgets
 * @param {Array<object>} registry  `widgets.list()` entries
 * @param {{ username?: string, now?: number, limit?: number, days?: number }} [opts]
 * @returns {Array<{ key: string, widget: object }>} newest first
 */
export function recentlyCreated(widgets, registry, opts = {}) {
  const {
    username = "",
    now = Date.now(),
    limit = RECENT_LIMIT,
    days = RECENT_DAYS,
  } = opts;
  const byPackage = new Map();
  for (const entry of registry || []) {
    if (!entry) continue;
    const id = entry.packageId || entry.name;
    if (id) byPackage.set(id, entry);
  }
  const since = now - days * DAY_MS;
  const rows = [];
  for (const row of widgets || []) {
    const pkg = row && row.widget && row.widget._sourcePackage;
    const entry = pkg ? byPackage.get(pkg) : null;
    if (!entry) continue;
    const at = Date.parse(entry.registeredAt || "");
    if (!Number.isFinite(at) || at < since || at > now + DAY_MS) continue;
    const mine =
      widgetSource(row, username) === "mine" || entry.loadedInPlace === true;
    if (!mine) continue;
    rows.push({ row, at });
  }
  rows.sort((a, b) => b.at - a.at || a.row.key.localeCompare(b.row.key));
  return rows.slice(0, limit).map((r) => r.row);
}
