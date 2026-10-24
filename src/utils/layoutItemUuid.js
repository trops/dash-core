/**
 * A layout item's uuid — what its data file (`<uuid>.json`), events and
 * provider picks are keyed by: `<dashboardId>-<component>-<id>`. One formula
 * for loading a dashboard (LayoutModel) and for adding a widget in edit mode
 * (addItemToItemLayout, DashboardModel), so a widget keeps its uuid when the
 * dashboard is saved and reloaded (QA 2026-10-24: one added in edit mode was
 * "<component>-<component>" until a reload, so what it saved before then was
 * lost, and two of the same widget shared a file).
 *
 * @param {string|number|null|undefined} dashboardId
 * @param {string} component
 * @param {string|number} id  the item's id in the layout
 * @returns {string}
 */
export function layoutItemUuid(dashboardId, component, id) {
  return dashboardId !== undefined && dashboardId !== null
    ? `${dashboardId}-${component}-${id}`
    : `${component}-${id}`;
}
