/**
 * upsertMenuItem.js
 *
 * Pure function that upserts a menu item into a list. Used by
 * `menuItemsController.saveMenuItemForApplication` so the controller
 * can stay free of business logic and the upsert is unit-testable
 * without mocking Electron.
 *
 * Behavior:
 *   - Replace any existing entry with the same id (string-coerced
 *     match) instead of appending a duplicate.
 *   - Heal pre-existing dupes already in the list. Walks from the
 *     END so the LAST entry per id wins — that matches the user's
 *     most recent intent (which would be the one they last saved).
 *
 * Without this, a dashboard install path that re-saves an existing
 * folder (e.g. when the publisher's menuId matches the user's
 * local folder id) creates a second record with the same id but
 * different icon, and the sidebar nav renders both.
 *
 * @param {Array} items - existing menu items list
 * @param {Object} menuItem - item to upsert
 * @returns {Array} new list (input is not mutated)
 */
function upsertMenuItem(items, menuItem) {
  // Step 1: heal pre-existing duplicates. Walk from the END so the
  // LAST entry per id wins (matches "user's most recent intent").
  const filtered = (Array.isArray(items) ? items : []).filter(
    (mi) => mi !== null,
  );
  const seen = new Set();
  const healed = [];
  for (let i = filtered.length - 1; i >= 0; i -= 1) {
    const m = filtered[i];
    if (!m || m.id === undefined || m.id === null) {
      healed.unshift(m);
      continue;
    }
    const key = String(m.id);
    if (seen.has(key)) continue;
    seen.add(key);
    healed.unshift(m);
  }
  // Step 2: upsert the new item against the healed list.
  if (menuItem && menuItem.id !== undefined && menuItem.id !== null) {
    const existingIdx = healed.findIndex(
      (mi) => mi && String(mi.id) === String(menuItem.id),
    );
    if (existingIdx >= 0) {
      healed[existingIdx] = { ...healed[existingIdx], ...menuItem };
    } else {
      healed.push(menuItem);
    }
  } else if (menuItem) {
    healed.push(menuItem);
  }
  return healed;
}

module.exports = { upsertMenuItem };
