/**
 * tabModel — open / close / restore for the bottom tab bar, which now holds
 * dashboards (`{ id: workspace.id, name, workspace }`) and Manage pages
 * (`{ id: "page:<key>", kind: "page", pageKey, name }`) — app-navigation
 * PRD NAV-002.
 *
 * Pure: returns new state; DashboardStage applies it.
 */
import { isPageTabId, makePageTab, pageKeyOf } from "./appPages";

/** Open a page as a tab, or switch to it if it's already open. */
export function openPageTab(tabs, key) {
  const tab = makePageTab(key);
  if (!tab) return { tabs, activeTabId: null };
  if (tabs.some((t) => t.id === tab.id)) {
    return { tabs, activeTabId: tab.id };
  }
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

/** Close a tab; closing the active one activates the last remaining tab. */
export function closeTab(tabs, tabId, activeTabId) {
  const remaining = tabs.filter((t) => t.id !== tabId);
  if (activeTabId !== tabId) return { tabs: remaining, activeTabId };
  return {
    tabs: remaining,
    activeTabId: remaining.length ? remaining[remaining.length - 1].id : null,
  };
}

/**
 * Rebuild tabs from saved ids (dashboard ids and `page:<key>`), in order.
 * Dashboards that no longer exist and unknown pages are dropped.
 */
export function restoreTabs(savedIds, workspaces = []) {
  const out = [];
  for (const id of savedIds || []) {
    if (isPageTabId(id)) {
      const tab = makePageTab(pageKeyOf(id));
      if (tab) out.push(tab);
      continue;
    }
    const ws = workspaces.find((w) => w.id === id);
    if (ws) out.push({ id: ws.id, name: ws.name || "Untitled", workspace: ws });
  }
  return out;
}
