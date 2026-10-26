import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ConfirmationModal,
  FontAwesomeIcon,
  ListRow,
  Sidebar,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useSidebar,
} from "@trops/dash-react";

const CollapsibleContent = ({ children }) => {
  const { collapsed } = useSidebar();
  return collapsed ? null : children;
};
import { Popover, Transition } from "@headlessui/react";
import { AppContext } from "../../Context/App/AppContext";
import { APP_PAGES } from "./appPages";

/**
 * A Manage page's icon. With something waiting (e.g. bot approvals) it gets
 * an amber dot — on the icon, so it shows when the sidebar is collapsed too.
 */
const PageIcon = ({ icon, attention }) => (
  <span className="relative inline-flex">
    <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
    {attention > 0 ? (
      <span
        data-testid="nav-attention-dot"
        className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-amber-400"
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
  pageAttention = {},
}) => {
  const { themeVariant, changeThemeVariant, currentTheme } =
    useContext(ThemeContext);

  const workspacesForFolder = (folderId) =>
    workspaces.filter((ws) => ws.menuId === folderId);

  const orphanedWorkspaces = workspaces.filter(
    (ws) => !menuItems.some((mi) => mi.id === ws.menuId),
  );

  // Filter recents: only show workspaces that still exist, max 5
  const visibleRecents = recentDashboards
    .filter((r) => workspaces.some((ws) => ws.id === r.workspaceId))
    .slice(0, 5);

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

      <Sidebar.Content>
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
            return (
              <Sidebar.Item
                key={page.key}
                icon={<PageIcon icon={page.icon} attention={attention} />}
                active={page.key === activePageKey}
                onClick={() => onOpenPage && onOpenPage(page.key)}
                badge={
                  attention > 0 ? (
                    <span className="text-amber-400">{attention}</span>
                  ) : null
                }
              >
                {page.label}
              </Sidebar.Item>
            );
          })}
        </Sidebar.Group>

        {/* Dashboard folders (only when expanded) */}
        <CollapsibleContent>
          {menuItems.map((menuItem) => {
            const folderWorkspaces = workspacesForFolder(menuItem.id);
            const folderIcon = menuItem.icon || menuItem.folder || "folder";
            if (folderWorkspaces.length === 0) return null;
            return (
              <Sidebar.Group key={menuItem.id} label={menuItem.name}>
                {folderWorkspaces.map((ws) => (
                  <Sidebar.Item
                    key={ws.id}
                    icon={
                      <FontAwesomeIcon
                        icon={folderIcon}
                        className="h-3.5 w-3.5"
                      />
                    }
                    active={ws.id === activeTabId}
                    onClick={() => onOpenWorkspace(ws)}
                  >
                    {(ws.name || "Untitled").replace(/^./, (c) =>
                      c.toUpperCase(),
                    )}
                  </Sidebar.Item>
                ))}
              </Sidebar.Group>
            );
          })}
          {orphanedWorkspaces.length > 0 && (
            <Sidebar.Group label="Uncategorized">
              {orphanedWorkspaces.map((ws) => (
                <Sidebar.Item
                  key={ws.id}
                  icon={
                    <FontAwesomeIcon icon="clone" className="h-3.5 w-3.5" />
                  }
                  active={ws.id === activeTabId}
                  onClick={() => onOpenWorkspace(ws)}
                >
                  {(ws.name || "Untitled").replace(/^./, (c) =>
                    c.toUpperCase(),
                  )}
                </Sidebar.Item>
              ))}
            </Sidebar.Group>
          )}
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
}) => (
  <ListRow
    icon={<FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 flex-shrink-0" />}
    title={label}
    selected={current}
    onClick={onClick}
    trailing={
      active ? (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0 mr-2" />
      ) : null
    }
  />
);
