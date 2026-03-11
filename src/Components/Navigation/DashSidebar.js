import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon, Sidebar, ThemeContext } from "@trops/dash-react";
import { Popover, Transition } from "@headlessui/react";

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
    >
      <Sidebar.Header>
        <div className="flex items-center justify-between">
          {!collapsed && (
            <span className="font-bold text-lg tracking-tight opacity-80">
              Dash.
            </span>
          )}
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

        {/* Recents (only when expanded and has items) */}
        {!collapsed && visibleRecents.length > 0 && (
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

        {/* Dashboards */}
        <Sidebar.Group label="Dashboards">
          <Sidebar.Item
            icon={<FontAwesomeIcon icon="plus" className="h-3.5 w-3.5" />}
            onClick={onNewDashboard}
          >
            New Dashboard
          </Sidebar.Item>
        </Sidebar.Group>

        {/* Dashboard folders (only when expanded) */}
        {!collapsed && (
          <>
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
          </>
        )}
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

  const displayName =
    authStatus === "authenticated" && authProfile
      ? authProfile.displayName || authProfile.username
      : "Account";

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
    <Popover className="relative">
      {({ open, close }) => {
        const rect =
          open && buttonRef.current
            ? buttonRef.current.getBoundingClientRect()
            : null;

        return (
          <>
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
                  className="fixed w-52 rounded-lg border border-white/10 bg-neutral-900 shadow-xl"
                  style={{
                    zIndex: 9999,
                    left: rect?.left ?? 0,
                    bottom: rect
                      ? window.innerHeight - rect.top + 8
                      : 0,
                  }}
                >
                  <div className="p-1.5 space-y-0.5">
                    <PopoverItem
                      icon="cog"
                      label="Settings"
                      onClick={() => {
                        onOpenSettings();
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

                    <div className="border-t border-white/10 my-1" />

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
  );
};

const PopoverItem = ({ icon, label, onClick, active = false }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center w-full gap-2 px-3 py-2 rounded-md text-sm ${
      active
        ? "text-white bg-white/10"
        : "text-white/80 hover:text-white hover:bg-white/10"
    } transition-colors duration-150 cursor-pointer`}
  >
    <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5 flex-shrink-0" />
    <span className="flex-1 text-left">{label}</span>
    {active && (
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
    )}
  </button>
);
