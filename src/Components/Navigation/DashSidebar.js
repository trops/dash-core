import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ButtonIcon3,
  ConfirmationModal,
  FontAwesomeIcon,
  ListRow,
  SearchInput,
  Sidebar,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useSidebar,
  useStatusTokens,
} from "@trops/dash-react";

const CollapsibleContent = ({ children }) => {
  const { collapsed } = useSidebar();
  return collapsed ? null : children;
};
import { Popover, Transition } from "@headlessui/react";
import { AppContext } from "../../Context/App/AppContext";
import { APP_PAGES } from "./appPages";
import { ListGroupLabel } from "../AppPages/ManageLayout";
import {
  NOT_IN_A_FOLDER,
  dashboardsIn,
  folderIcon,
  folderOf,
  newestFirst,
  sortedFolders,
} from "../../utils/dashboardFolders";

/**
 * A Manage page's icon. With something waiting (e.g. bot approvals) it gets
 * a dot in the status colour (`tone`) — on the icon, so it shows when the
 * sidebar is collapsed too.
 */
const PageIcon = ({ icon, attention, tone = "" }) => (
  <span className="relative inline-flex">
    <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
    {attention > 0 ? (
      <span
        data-testid="nav-attention-dot"
        className={`absolute top-0 right-0 h-1.5 w-1.5 rounded-full ${tone}`}
      />
    ) : null}
  </span>
);

export const DashSidebar = ({
  collapsed,
  onCollapsedChange,
  workspaces = [],
  menuItems = [],
  activeTabId = null,
  recentDashboards = [],
  authStatus = "loading",
  authProfile = null,
  onOpenWorkspace,
  onNewDashboard,
  onOpenSettings,
  onOpenCommandPalette,
  onSignIn,
  onSignOut,
  // Manage pages (app-navigation NAV-001): the open page, how to open one,
  // and per-page attention counts ({ bots: pendingApprovals }).
  activePageKey = null,
  onOpenPage = null,
  // A folder's name: the Dashboards page on that folder (NAV-017).
  onOpenFolder = null,
  pageAttention = {},
}) => {
  const { themeVariant, changeThemeVariant, currentTheme } =
    useContext(ThemeContext);
  // Attention colours: problems (Issues) in the error colour, things
  // waiting (approvals, setup) in the warning colour.
  const statusTokens = useStatusTokens();
  const toneOf = (key) =>
    key === "issues" ? statusTokens.error : statusTokens.warning;

  const [openFolders, toggleFolder] = useOpenFolders();
  const folders = navFolders(workspaces, menuItems);

  // Filter recents: only show workspaces that still exist, max 5
  const visibleRecents = recentDashboards
    .filter((r) => workspaces.some((ws) => ws.id === r.workspaceId))
    .slice(0, 5);
  const recentWorkspaces = visibleRecents
    .map((r) => workspaces.find((ws) => ws.id === r.workspaceId))
    .filter(Boolean);

  return (
    <Sidebar
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      width="w-56"
      collapsedWidth="w-12"
      // dr-rail: a raised region with a hairline edge (layout rule 1).
      className="dr-rail"
    >
      <Sidebar.Header>
        <div className="flex items-center justify-between">
          <CollapsibleContent>
            <span className="font-bold text-lg tracking-tight opacity-80">
              Dash.
            </span>
          </CollapsibleContent>
          <Sidebar.Trigger />
        </div>
      </Sidebar.Header>

      {/* min-h-0: a long folder list scrolls instead of hiding under Account. */}
      <Sidebar.Content className="min-h-0">
        {/* Search */}
        <Sidebar.Item
          icon={
            <FontAwesomeIcon icon="magnifying-glass" className="h-3.5 w-3.5" />
          }
          onClick={onOpenCommandPalette}
        >
          Search
        </Sidebar.Item>

        {/* Create — one place to make dashboards, widgets, bots and themes
            (create-entry PRD CRE-001); sits above Recents so it doesn't get
            buried under recent items. */}
        <Sidebar.Item
          icon={<FontAwesomeIcon icon="plus" className="h-3.5 w-3.5" />}
          onClick={onNewDashboard}
        >
          Create
        </Sidebar.Item>

        {/* Conversations — every lead's conversations in one Recents
            (lead-workspace: the left nav's Conversations). */}
        <Sidebar.Item
          icon={<FontAwesomeIcon icon="comments" className="h-3.5 w-3.5" />}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("dash:open-workspace", {
                detail: { key: "role:dashlead", all: true },
              }),
            )
          }
        >
          Conversations
        </Sidebar.Item>

        {/* Recents (only when expanded and has items) */}
        <CollapsibleContent>
          {visibleRecents.length > 0 && (
            <Sidebar.Group label="Recents">
              {visibleRecents.map((recent) => {
                const ws = workspaces.find((w) => w.id === recent.workspaceId);
                return (
                  <Sidebar.Item
                    key={recent.workspaceId}
                    icon={
                      <FontAwesomeIcon
                        icon="clock-rotate-left"
                        className="h-3.5 w-3.5"
                      />
                    }
                    active={recent.workspaceId === activeTabId}
                    onClick={() => ws && onOpenWorkspace(ws)}
                  >
                    {(recent.name || "Untitled").replace(/^./, (c) =>
                      c.toUpperCase(),
                    )}
                  </Sidebar.Item>
                );
              })}
            </Sidebar.Group>
          )}
        </CollapsibleContent>

        {/* Manage pages — always visible (icons when collapsed); each opens
            full-screen as a tab (app-navigation NAV-001). */}
        <Sidebar.Group label="Manage">
          {APP_PAGES.map((page) => {
            const attention = pageAttention[page.key] || 0;
            if (page.key === "dashboards" && collapsed) {
              return (
                <DashboardsMenu
                  key={page.key}
                  icon={<PageIcon icon={page.icon} attention={attention} />}
                  active={page.key === activePageKey}
                  workspaces={workspaces}
                  menuItems={menuItems}
                  recents={recentWorkspaces}
                  activeTabId={activeTabId}
                  onOpenWorkspace={onOpenWorkspace}
                  openFolders={openFolders}
                  onToggleFolder={toggleFolder}
                  onOpenAll={() =>
                    onOpenFolder
                      ? onOpenFolder("all")
                      : onOpenPage && onOpenPage(page.key)
                  }
                />
              );
            }
            return (
              <Sidebar.Item
                key={page.key}
                icon={
                  <PageIcon
                    icon={page.icon}
                    attention={attention}
                    // Issues are problems: red, not the amber of setup.
                    tone={toneOf(page.key).solidBg}
                  />
                }
                active={page.key === activePageKey}
                onClick={() => onOpenPage && onOpenPage(page.key)}
                badge={
                  attention > 0 ? (
                    <span className={toneOf(page.key).icon}>{attention}</span>
                  ) : null
                }
              >
                {page.label}
              </Sidebar.Item>
            );
          })}
        </Sidebar.Group>

        {/* Folders, folded (only when expanded) — NAV-017 */}
        <CollapsibleContent>
          {folders.length ? (
            <Sidebar.Group label="Folders">
              {folders.map((folder) => (
                <NavFolder
                  key={folder.key}
                  folder={folder}
                  open={openFolders.has(folder.key)}
                  onToggle={() => toggleFolder(folder.key)}
                  onOpenFolder={onOpenFolder}
                  onOpenWorkspace={onOpenWorkspace}
                  activeTabId={activeTabId}
                />
              ))}
            </Sidebar.Group>
          ) : null}
        </CollapsibleContent>
      </Sidebar.Content>

      <Sidebar.Footer>
        <FooterPopover
          collapsed={collapsed}
          themeVariant={themeVariant}
          changeThemeVariant={changeThemeVariant}
          authStatus={authStatus}
          authProfile={authProfile}
          onOpenSettings={onOpenSettings}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
        />
      </Sidebar.Footer>
    </Sidebar>
  );
};

// ─── Folders in the nav (app-navigation NAV-017) ─────────────────────
const MENU_HEIGHT = 520;
// Folded by default; which ones you left open is remembered (per computer).
const OPEN_FOLDERS_KEY = "dash.nav.openFolders";

function readOpenFolders() {
  try {
    const v = JSON.parse(window.localStorage.getItem(OPEN_FOLDERS_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch (e) {
    return new Set();
  }
}

export function useOpenFolders() {
  const [open, setOpen] = useState(readOpenFolders);
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(
          OPEN_FOLDERS_KEY,
          JSON.stringify([...next]),
        );
      } catch (e) {
        // Not saved; it's only a convenience.
      }
      return next;
    });
  return [open, toggle];
}

const capName = (name) =>
  (name || "Untitled").replace(/^./, (c) => c.toUpperCase());

/** The nav's folders: each one folded line, plus Not in a folder. */
function navFolders(workspaces, menuItems) {
  const list = sortedFolders(menuItems).map((f) => ({
    key: String(f.id),
    name: f.name || "Untitled",
    icon: folderIcon(f),
    dashboards: newestFirst(dashboardsIn(f.id, workspaces, menuItems)),
  }));
  const loose = newestFirst(
    dashboardsIn(NOT_IN_A_FOLDER, workspaces, menuItems),
  );
  if (loose.length) {
    list.push({
      key: NOT_IN_A_FOLDER,
      name: "Not in a folder",
      icon: "inbox",
      dashboards: loose,
    });
  }
  return list;
}

/**
 * One folder in the expanded nav: the arrow opens it in place (its
 * dashboards under it); the name opens the Dashboards page on it.
 */
const NavFolder = ({
  folder,
  open,
  onToggle,
  onOpenFolder,
  onOpenWorkspace,
  activeTabId,
}) => (
  <div data-testid={`nav-folder-${folder.key}`}>
    <div className="flex flex-row items-center">
      {/* Quiet until hovered, like other row actions. */}
      <span className="dr-row-actions flex-shrink-0">
        <ButtonIcon3
          icon={open ? "chevron-down" : "chevron-right"}
          ariaLabel={`${open ? "Hide" : "Show"} dashboards in ${folder.name}`}
          className="h-6 w-6"
          onClick={onToggle}
        />
      </span>
      <div className="flex-1 min-w-0">
        <Sidebar.Item
          icon={<FontAwesomeIcon icon={folder.icon} className="h-3.5 w-3.5" />}
          badge={String(folder.dashboards.length)}
          onClick={() => onOpenFolder && onOpenFolder(folder.key)}
        >
          {folder.name}
        </Sidebar.Item>
      </div>
    </div>
    {open
      ? folder.dashboards.map((ws) => (
          <Sidebar.Item
            key={ws.id}
            className="pl-8"
            icon={
              <FontAwesomeIcon
                icon="table-cells-large"
                className="h-3.5 w-3.5"
              />
            }
            active={ws.id === activeTabId}
            onClick={() => onOpenWorkspace(ws)}
          >
            {capName(ws.name)}
          </Sidebar.Item>
        ))
      : null}
  </div>
);

/**
 * The collapsed nav's Dashboards icon: a menu beside the bar with Recents,
 * the folders (open one in place), Find, and All dashboards.
 */
const DashboardsMenu = ({
  icon,
  active,
  workspaces,
  menuItems,
  recents,
  activeTabId,
  onOpenWorkspace,
  onOpenAll,
  // Shared with the expanded nav, so a folder opened here shows open there.
  openFolders,
  onToggleFolder: toggleFolder,
}) => {
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { currentTheme } = useContext(ThemeContext) || {};
  const panelStyles = getStylesForItem(
    themeObjects.DROPDOWN_PANEL,
    currentTheme,
    {},
  );
  const dividerStyles = getStylesForItem(
    themeObjects.DROPDOWN_PANEL_DIVIDER,
    currentTheme,
    {},
  );
  const muted = (currentTheme || {})["text-neutral-medium"] || "";

  // Focus goes back to the Dashboards icon when the menu closes.
  const close = () => {
    setOpen(false);
    setQuery("");
    const button =
      anchorRef.current && anchorRef.current.querySelector("button");
    if (button) button.focus();
  };
  // …and into Find when it opens.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const input = panelRef.current.querySelector("input");
    if (input) input.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (ws) => {
    close();
    onOpenWorkspace(ws);
  };
  const dashRow = (ws, meta = null, className = "") => (
    <ListRow
      key={ws.id}
      icon="table-cells-large"
      selected={ws.id === activeTabId}
      onClick={() => pick(ws)}
      title={capName(ws.name)}
      meta={meta}
      className={className}
    />
  );

  const q = query.trim().toLowerCase();
  const matches = q
    ? newestFirst(
        workspaces.filter((ws) => (ws.name || "").toLowerCase().includes(q)),
      ).slice(0, 12)
    : [];
  const rect =
    open && anchorRef.current
      ? anchorRef.current.getBoundingClientRect()
      : null;
  const top = rect
    ? Math.max(8, Math.min(rect.top, window.innerHeight - MENU_HEIGHT - 8))
    : 0;

  return (
    <div ref={anchorRef}>
      <Sidebar.Item
        icon={icon}
        active={active || open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Dashboards
      </Sidebar.Item>
      {open && rect
        ? createPortal(
            <>
              <div
                className="fixed inset-0"
                style={{ zIndex: 9998 }}
                onClick={close}
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-label="Dashboards"
                data-testid="nav-dashboards-menu"
                className={`fixed w-72 flex flex-col rounded-lg border shadow-xl ${panelStyles.borderColor || ""} ${panelStyles.backgroundColor || ""} ${panelStyles.textColor || ""}`}
                style={{
                  zIndex: 9999,
                  left: rect.right + 8,
                  top,
                  maxHeight: MENU_HEIGHT,
                }}
              >
                <div className="flex flex-col gap-2 p-2">
                  <span className="px-1 text-sm font-semibold">Dashboards</span>
                  <SearchInput
                    value={query}
                    onChange={setQuery}
                    placeholder="Find a dashboard…"
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-1">
                  <div className="flex flex-col gap-0.5">
                    {q ? (
                      matches.length ? (
                        matches.map((ws) => {
                          const f = folderOf(ws, menuItems);
                          return dashRow(ws, f ? f.name : "Not in a folder");
                        })
                      ) : (
                        <span className={`text-sm px-2 py-1 ${muted}`}>
                          No dashboards match.
                        </span>
                      )
                    ) : (
                      <>
                        {recents.length ? (
                          <ListGroupLabel text="Recents" />
                        ) : null}
                        {recents.map((ws) => dashRow(ws))}
                        <ListGroupLabel text="Folders" />
                        {navFolders(workspaces, menuItems).map((f) => {
                          const isOpen = openFolders.has(f.key);
                          return (
                            <div
                              key={f.key}
                              data-testid={`menu-folder-${f.key}`}
                            >
                              {/* The count and arrow always show (ListRow's
                                trailing slot is for hover actions). */}
                              <div className="flex flex-row items-center">
                                <div className="flex-1 min-w-0">
                                  <ListRow
                                    icon={f.icon}
                                    onClick={() => toggleFolder(f.key)}
                                    ariaLabel={`${isOpen ? "Hide" : "Show"} dashboards in ${f.name}`}
                                    title={f.name}
                                  />
                                </div>
                                <span
                                  aria-hidden="true"
                                  className={`flex flex-row items-center gap-2 px-2 text-xs ${muted}`}
                                >
                                  {f.dashboards.length}
                                  <FontAwesomeIcon
                                    icon={
                                      isOpen ? "chevron-down" : "chevron-right"
                                    }
                                    className="h-3 w-3"
                                  />
                                </span>
                              </div>
                              {isOpen
                                ? f.dashboards.map((ws) =>
                                    dashRow(ws, null, "pl-4"),
                                  )
                                : null}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`border-t p-1 ${dividerStyles.borderColor || ""}`}
                >
                  <div className="flex flex-row items-center">
                    <div className="flex-1 min-w-0">
                      <ListRow
                        icon="clone"
                        onClick={() => {
                          close();
                          onOpenAll();
                        }}
                        title="All dashboards"
                        testId="menu-all-dashboards"
                      />
                    </div>
                    <span
                      aria-hidden="true"
                      className={`text-xs px-2 ${muted}`}
                    >
                      {workspaces.length}
                    </span>
                  </div>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
};

const FooterPopover = ({
  collapsed,
  themeVariant,
  changeThemeVariant,
  authStatus,
  authProfile,
  onOpenSettings,
  onSignIn,
  onSignOut,
}) => {
  const buttonRef = useRef(null);
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const { currentTheme } = useContext(ThemeContext) || {};
  const appContext = useContext(AppContext) || {};
  const triggerAppUpdatesCheck = appContext.triggerAppUpdatesCheck;
  const appId = appContext.credentials?.appId;
  const profileSwitch = useProfileSwitch(appId);
  const activeProfile =
    profileSwitch.profiles.length > 1
      ? profileSwitch.profiles.find((p) => p.id === profileSwitch.activeId)
      : null;

  // The menu uses the theme's dropdown colors, so it reads in light mode too.
  const panelStyles = getStylesForItem(
    themeObjects.DROPDOWN_PANEL,
    currentTheme,
    {},
  );
  const headerStyles = getStylesForItem(
    themeObjects.DROPDOWN_PANEL_HEADER,
    currentTheme,
    {},
  );
  const dividerStyles = getStylesForItem(
    themeObjects.DROPDOWN_PANEL_DIVIDER,
    currentTheme,
    {},
  );
  const divider = (
    <div className={`border-t ${dividerStyles.borderColor || ""} my-1`} />
  );

  const accountName =
    authStatus === "authenticated" && authProfile
      ? authProfile.displayName || authProfile.username
      : "Account";
  // With more than one profile, the footer says which one you're in.
  const displayName = activeProfile
    ? `${accountName} · ${activeProfile.name}`
    : accountName;

  // Load initial DND state
  useEffect(() => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 2000),
    );
    const fetch = window.mainApi?.notifications?.getPreferences();
    if (fetch) {
      Promise.race([fetch, timeout])
        .then((prefs) => {
          if (prefs) setDoNotDisturb(prefs.doNotDisturb);
        })
        .catch(() => {});
    }
  }, []);

  // Sync when toggled from macOS menu
  useEffect(() => {
    const cleanup = window.mainApi?.notifications?.onDndChanged?.((dnd) => {
      setDoNotDisturb(dnd);
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  function handleToggleDnd() {
    const newValue = !doNotDisturb;
    setDoNotDisturb(newValue);
    window.mainApi?.notifications
      ?.setGlobal({ doNotDisturb: newValue })
      ?.catch(() => {});
  }

  return (
    <>
      {profileSwitch.confirm}
      <Popover className="relative">
        {({ open, close }) => {
          const rect =
            open && buttonRef.current
              ? buttonRef.current.getBoundingClientRect()
              : null;

          return (
            <>
              <WhenOpened open={open} onOpen={profileSwitch.reload} />
              <Popover.Button
                ref={buttonRef}
                className="flex items-center w-full gap-2 px-3 py-2 rounded-md text-sm opacity-80 hover:opacity-100 transition-colors duration-150 cursor-pointer hover:bg-white/5 focus:outline-none"
                title={collapsed ? displayName : undefined}
              >
                <FontAwesomeIcon
                  icon={authStatus === "authenticated" ? "circle-user" : "user"}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                {!collapsed && (
                  <span className="flex-1 text-left truncate">
                    {displayName}
                  </span>
                )}
              </Popover.Button>
              {createPortal(
                <Transition
                  show={open}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <div
                    className="fixed inset-0"
                    style={{ zIndex: 9998 }}
                    onClick={close}
                  />
                  <Popover.Panel
                    static
                    className={`fixed w-56 rounded-lg border ${panelStyles.borderColor || ""} ${panelStyles.backgroundColor || ""} ${panelStyles.textColor || ""} shadow-xl`}
                    style={{
                      zIndex: 9999,
                      left: rect?.left ?? 0,
                      bottom: rect ? window.innerHeight - rect.top + 8 : 0,
                    }}
                  >
                    <div className="p-1.5 space-y-0.5">
                      {/* Profiles (dash-profiles PRD) — only once there is
                        more than Default, so one-profile users see no
                        change. Picking one switches; the window reloads. */}
                      {profileSwitch.profiles.length > 1 ? (
                        <>
                          <div
                            className={`uppercase text-xs font-semibold px-3 py-1.5 ${headerStyles.textColor || ""}`}
                          >
                            Profiles
                          </div>
                          {profileSwitch.profiles.map((p) => (
                            <PopoverItem
                              key={p.id}
                              icon={
                                p.id === profileSwitch.activeId
                                  ? "circle-check"
                                  : "user"
                              }
                              label={p.name}
                              current={p.id === profileSwitch.activeId}
                              onClick={() => {
                                close();
                                if (p.id !== profileSwitch.activeId) {
                                  profileSwitch.request(p);
                                }
                              }}
                            />
                          ))}
                          <PopoverItem
                            icon="users-gear"
                            label="Manage profiles…"
                            onClick={() => {
                              onOpenSettings("profiles");
                              close();
                            }}
                          />
                          {divider}
                        </>
                      ) : null}
                      <PopoverItem
                        icon="cog"
                        label="Settings"
                        onClick={() => {
                          onOpenSettings("general");
                          close();
                        }}
                      />
                      <PopoverItem
                        icon={themeVariant === "dark" ? "sun" : "moon"}
                        label={
                          themeVariant === "dark" ? "Light Mode" : "Dark Mode"
                        }
                        onClick={() => {
                          changeThemeVariant(
                            themeVariant === "dark" ? "light" : "dark",
                          );
                          close();
                        }}
                      />
                      <PopoverItem
                        icon={doNotDisturb ? "bell-slash" : "bell"}
                        label="Do Not Disturb"
                        onClick={handleToggleDnd}
                        active={doNotDisturb}
                      />
                      {/* Always rendered — if AppContext isn't above the
                        sidebar in some edge mount path the click
                        no-ops rather than the item vanishing.
                        Previously gated on `typeof === "function"`
                        which hid the item entirely whenever the
                        consuming app hadn't propagated AppContext,
                        making the feature invisible instead of just
                        inert. */}
                      <PopoverItem
                        icon="arrows-rotate"
                        label="Check for updates"
                        onClick={() => {
                          if (typeof triggerAppUpdatesCheck === "function") {
                            triggerAppUpdatesCheck();
                          } else {
                            (window.__DASH_DEBUG ||= []).push({
                              t: Date.now(),
                              src: "DashSidebar",
                              event:
                                "triggerAppUpdatesCheck:missing-from-context",
                            });
                          }
                          close();
                        }}
                      />
                      {/* Same gating logic surfaces as a tiny inline
                        hint when the context is missing — invisible
                        in the normal case but tells us what's
                        happening if a future mount path drops
                        AppContext. Uses safelist-safe text-xs (the
                        previous diagnostic used text-[10px] which is
                        an arbitrary-value class outside the safelist
                        and silently fails to render in dash-electron's
                        prebuilt CSS bundle). */}

                      {divider}

                      {authStatus === "authenticated" ? (
                        <PopoverItem
                          icon="right-from-bracket"
                          label="Sign Out"
                          onClick={() => {
                            onSignOut();
                            close();
                          }}
                        />
                      ) : (
                        <PopoverItem
                          icon="right-to-bracket"
                          label="Sign In"
                          onClick={() => {
                            onSignIn();
                            close();
                          }}
                        />
                      )}
                    </div>
                  </Popover.Panel>
                </Transition>,
                document.body,
              )}
            </>
          );
        }}
      </Popover>
    </>
  );
};

/**
 * The account menu's profile list: loads the profiles, and switches —
 * asking first when bots are running, since switching stops the ones not
 * in the new profile. The main process reloads the window on success.
 */
function useProfileSwitch(appId) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [pending, setPending] = useState(null);

  // Read on mount and each time the menu opens (a profile may have been
  // created in Settings since).
  const reload = React.useCallback(() => {
    const api = window.mainApi?.profiles;
    if (!appId || !api) return;
    Promise.resolve(api.list(appId))
      .then((res) => {
        if (!res || !res.success) return;
        setProfiles(res.profiles || []);
        setActiveId(res.activeProfileId);
      })
      .catch(() => {});
  }, [appId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function doSwitch(profile) {
    setPending(null);
    await window.mainApi?.profiles?.switch?.(appId, profile.id);
  }

  async function request(profile) {
    let running = [];
    try {
      running = (await window.mainApi?.bots?.listRunning?.()) || [];
    } catch (_e) {
      running = [];
    }
    if (running.length) setPending({ profile, running });
    else doSwitch(profile);
  }

  const count = pending ? pending.running.length : 0;
  const confirm = pending ? (
    <ConfirmationModal
      isOpen
      setIsOpen={() => setPending(null)}
      title={`Switch to ${pending.profile.name}`}
      message={`${count} bot${count === 1 ? " is" : "s are"} running. Switching stops ${
        count === 1 ? "it" : "them"
      } unless ${count === 1 ? "it's" : "they're"} also in ${pending.profile.name}.`}
      confirmLabel="Switch"
      onConfirm={() => doSwitch(pending.profile)}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { profiles, activeId, request, confirm, reload };
}

// Calls onOpen each time the menu opens (headlessui's Popover.Button
// doesn't pass an onClick through).
const WhenOpened = ({ open, onOpen }) => {
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  return null;
};

const PopoverItem = ({
  icon,
  label,
  onClick,
  active = false,
  current = false,
}) => {
  const statusTokens = useStatusTokens();
  return (
    <ListRow
      icon={
        <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 flex-shrink-0" />
      }
      title={label}
      selected={current}
      onClick={onClick}
      trailing={
        active ? (
          <span
            className={`h-1.5 w-1.5 rounded-full flex-shrink-0 mr-2 ${statusTokens.warning.solidBg}`}
          />
        ) : null
      }
    />
  );
};
