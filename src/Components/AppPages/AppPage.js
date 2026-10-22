import React, { useEffect, useState } from "react";
import { Button, SectionLabel, SegmentedControl } from "@trops/dash-react";
import { getAppPage } from "../Navigation/appPages";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { DashboardsPage } from "./DashboardsPage";
import { BotsPage } from "./BotsPage";
import { WidgetsPage } from "./WidgetsPage";
import { ThemesPage } from "./ThemesPage";
import { FoldersSection } from "../Settings/sections/FoldersSection";
import { ProvidersSection } from "../Settings/sections/ProvidersSection";

// New Dashboard, New Widget and New Bot open the Create screen on that type
// (create-entry PRD CRE-008, consolidation Phase 2a); the other pages create
// in place.
const OPENS_CREATE = {
  dashboards: "dashboard",
  widgets: "widget",
  bots: "bot",
};

const CREATE_LABEL = {
  dashboards: "New Dashboard",
  folders: "New Folder",
  bots: "New Bot",
  providers: "New Provider",
  widgets: "New Widget",
  themes: "New Theme",
};

/**
 * AppPage — a Manage page full-screen in the main area, opened as a tab from
 * the left nav (app-navigation PRD NAV-003). Rendered outside
 * DashboardThemeProvider, so it uses the app theme.
 *
 * Dashboards (slice 2, NAV-005, with Folders beside it), Bots (slice 3a,
 * NAV-006), Widgets (slice 3b, NAV-008) and Themes (slice 3c, NAV-009) are
 * their own list + detail pages. The other pages still reuse their Settings section components
 * (they don't depend on the modal) until their redesigns land.
 *
 * @param {string} pageKey            dashboards | bots | providers | widgets | themes
 * @param {string} subsection         Dashboards only: "dashboards" | "folders"
 * @param {object} providerLink       Providers deep link { name, create, type,
 *                                    providerClass, nonce } — a new nonce re-applies it.
 */
export const AppPage = ({
  pageKey,
  subsection = null,
  providerLink = null,
  // Widgets install deep link { action, nonce } — a new nonce re-applies it.
  widgetLink = null,
  workspaces = [],
  menuItems = [],
  dashApi = null,
  credentials = null,
  onReloadWorkspaces = null,
  onReloadMenuItems = null,
  onOpenWorkspace = null,
  onOpenThemeEditor = null,
  // Dashboards page: open a dashboard's tab in its Bots view / with Config.
  onOpenBotsView = null,
  onOpenDashboardConfig = null,
  // Bots page: open a bot in its team's Bots view (workspace, botId).
  onOpenBotInBotsView = null,
  // Bots page: an error's next step ("Open Settings › Providers").
  onOpenAppSettings = null,
  // Widgets page: Settings › Privacy & Security (widget permissions).
  onOpenPrivacySettings = null,
}) => {
  const page = getAppPage(pageKey);
  const { muted, strong, hairline } = useConfigTokens();
  const [sub, setSub] = useState(subsection || "dashboards");
  const [createRequested, setCreateRequested] = useState(false);

  // A link to Settings › Folders lands on the Folders view.
  useEffect(() => {
    if (subsection) setSub(subsection);
  }, [subsection]);

  // A new page (or Dashboards/Folders switch) never inherits a create request.
  useEffect(() => {
    setCreateRequested(false);
  }, [pageKey, sub]);

  if (!page) return null;

  const section = pageKey === "dashboards" ? sub : pageKey;
  const createProps = {
    createRequested,
    onCreateAcknowledged: () => setCreateRequested(false),
  };

  let body = null;
  if (section === "dashboards") {
    body = (
      <DashboardsPage
        workspaces={workspaces}
        menuItems={menuItems}
        dashApi={dashApi}
        credentials={credentials}
        onReloadWorkspaces={onReloadWorkspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotsView={onOpenBotsView}
        onOpenDashboardConfig={onOpenDashboardConfig}
        {...createProps}
      />
    );
  } else if (section === "folders") {
    body = (
      <FoldersSection
        menuItems={menuItems}
        workspaces={workspaces}
        dashApi={dashApi}
        credentials={credentials}
        onReloadMenuItems={onReloadMenuItems}
        onReloadWorkspaces={onReloadWorkspaces}
        {...createProps}
      />
    );
  } else if (section === "bots") {
    body = (
      <BotsPage
        workspaces={workspaces}
        dashApi={dashApi}
        onOpenBotInBotsView={onOpenBotInBotsView}
        onOpenAppSettings={onOpenAppSettings}
        {...createProps}
      />
    );
  } else if (section === "providers") {
    const link = providerLink || {};
    body = (
      <ProvidersSection
        // A new deep link remounts so the section re-reads its initial props.
        key={link.nonce || 0}
        dashApi={dashApi}
        credentials={credentials}
        initialProviderName={link.name || null}
        initialCreateRequested={!!link.create}
        initialProviderType={link.type || null}
        initialProviderClass={link.providerClass || null}
        workspaces={workspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotInBotsView={onOpenBotInBotsView}
        onReloadWorkspaces={onReloadWorkspaces}
        {...createProps}
      />
    );
  } else if (section === "widgets") {
    body = (
      <WidgetsPage
        installRequest={widgetLink}
        workspaces={workspaces}
        credentials={credentials}
        onOpenWorkspace={onOpenWorkspace}
        onOpenPrivacySettings={onOpenPrivacySettings}
        {...createProps}
      />
    );
  } else if (section === "themes") {
    body = (
      <ThemesPage
        workspaces={workspaces}
        dashApi={dashApi}
        credentials={credentials}
        onOpenWorkspace={onOpenWorkspace}
        onOpenThemeEditor={onOpenThemeEditor}
        {...createProps}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div
        className={`flex-shrink-0 flex flex-row items-end justify-between gap-4 px-6 pt-5 pb-3 border-b ${hairline}`}
      >
        <div className="flex flex-col gap-1 min-w-0">
          <SectionLabel text="Manage" />
          <h2 className={`text-xl font-semibold truncate ${strong}`}>
            {page.label}
          </h2>
          <span className={`text-sm ${muted}`}>{page.description}</span>
        </div>
        <div className="flex flex-row items-center gap-3 flex-shrink-0">
          {/* Dashboards / Folders sit beside the page action, so every
              Manage header is the same height. */}
          {pageKey === "dashboards" ? (
            <SegmentedControl
              ariaLabel="Show"
              options={[
                { value: "dashboards", label: "Dashboards" },
                { value: "folders", label: "Folders" },
              ]}
              value={sub}
              onChange={setSub}
            />
          ) : null}
          <Button
            title={CREATE_LABEL[section]}
            size="sm"
            onClick={() =>
              OPENS_CREATE[section]
                ? window.dispatchEvent(
                    new CustomEvent("dash:open-create", {
                      detail: { type: OPENS_CREATE[section] },
                    }),
                  )
                : setCreateRequested(true)
            }
          />
        </div>
      </div>
      <div className="flex flex-col flex-1 min-h-0">{body}</div>
    </div>
  );
};

export default AppPage;
