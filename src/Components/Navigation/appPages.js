/**
 * appPages — the Manage pages in the left nav (app-navigation PRD NAV-001/002).
 *
 * One list shared by the sidebar, the tab bar, the page host and
 * `openAppSettings` (which sends the Settings sections that moved here to
 * their page). A page opens as a tab with id `page:<key>`; page tabs carry no
 * workspace, so everything dashboard-only switches off while one is active.
 *
 * Pure: no React.
 */

export const APP_PAGES = [
  {
    key: "dashboards",
    label: "Dashboards",
    icon: "clone",
    description: "All your dashboards and folders.",
    settingsSections: ["dashboards", "folders"],
  },
  {
    key: "bots",
    label: "Bots",
    icon: "robot",
    description: "Every bot, grouped by the dashboard team it works for.",
    settingsSections: ["bots"],
  },
  {
    key: "providers",
    label: "Providers",
    icon: "plug",
    description: "Connections your widgets and bots use.",
    settingsSections: ["providers"],
  },
  {
    key: "widgets",
    label: "Widgets",
    icon: "puzzle-piece",
    description: "Installed widget packages and the widgets in them.",
    settingsSections: ["widgets"],
  },
  {
    key: "themes",
    label: "Themes",
    icon: "palette",
    description: "The app theme and the themes your dashboards use.",
    settingsSections: ["themes"],
  },
];

export const PAGE_TAB_PREFIX = "page:";

export const pageTabId = (key) => PAGE_TAB_PREFIX + key;

export const isPageTabId = (id) =>
  typeof id === "string" && id.startsWith(PAGE_TAB_PREFIX);

export const pageKeyOf = (id) =>
  isPageTabId(id) ? id.slice(PAGE_TAB_PREFIX.length) : null;

export const getAppPage = (key) => APP_PAGES.find((p) => p.key === key) || null;

/** The page a (moved) Settings section now lives on, or null. */
export const pageForSettingsSection = (section) =>
  APP_PAGES.find((p) => p.settingsSections.includes(section)) || null;

/** A tab for a page — no `workspace`. Null for an unknown page. */
export function makePageTab(key) {
  const page = getAppPage(key);
  if (!page) return null;
  return {
    id: pageTabId(key),
    kind: "page",
    pageKey: key,
    name: page.label,
  };
}
