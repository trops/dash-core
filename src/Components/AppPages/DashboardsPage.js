import React, { useContext, useMemo, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  EmptyState,
  FilterMenu,
  FontAwesomeIcon,
  InputText,
  ListRow,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  ThemeContext,
  deepCopy,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useProfiles } from "../../hooks/useProfiles";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useTeamBots } from "../Bots/useTeamBots";
import { STATUS_DOT } from "../Bots/teamUtils";
import { relativeTime } from "../Bots/BotMonitor";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import { ListGroupLabel, ManageLayout, OverflowMenu } from "./ManageLayout";
import { StarRating } from "../Settings/details/StarRating";
import { PublishDashboardModal } from "../Settings/details/PublishDashboardModal";
import { dashboardSummary } from "./dashboardSummary";
import { useApprovalsByDashboard } from "./useApprovalsByDashboard";
import { exportedText } from "./exportedText";
import { saveErrorText } from "../../utils/saveErrorText";

const UNCATEGORIZED = "Uncategorized";
// Empty, so it takes the select's placeholder place ("No folder" once).
const NO_FOLDER = "";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;
const getWidgetRequirements = (name) =>
  (name && ComponentManager.config(name)?.providers) || [];

/** "1 provider needs setup · 1 bot needs approval" — or "" when all clear. */
function attentionText(unresolved, approvals) {
  const parts = [];
  if (unresolved > 0) {
    parts.push(
      `${plural(unresolved, "provider")} need${unresolved === 1 ? "s" : ""} setup`,
    );
  }
  if (approvals > 0) {
    parts.push(
      `${plural(approvals, "bot")} need${approvals === 1 ? "s" : ""} approval`,
    );
  }
  return parts.join(" · ");
}

// Layout cleaned of runtime-only widgetConfig before saving (as Settings did).
function forSave(ws) {
  const copy = deepCopy(ws);
  copy.layout = (copy.layout || []).map((item) => {
    const cleaned = { ...item };
    delete cleaned.widgetConfig;
    return cleaned;
  });
  return copy;
}

/** "updated 3 h ago" when the dashboard carries a timestamp, else "". */
function updatedText(ws) {
  const raw = ws && (ws.updatedAt || ws.lastModified);
  if (!raw) return "";
  const iso =
    typeof raw === "number" ? new Date(raw).toISOString() : String(raw);
  const age = relativeTime(iso);
  return age ? `updated ${age}` : "";
}

/** A page's grid as a small preview, drawn with theme tokens. */
const LayoutPreview = ({ grid, hairline, selectedBg }) => {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  // Cells sit on a raised surface with a visible edge, so the grid reads
  // against the recessed frame in both modes.
  const cellSurface = currentTheme["bg-neutral-dark"] || "";
  const cellEdge = currentTheme["border-neutral-medium"] || hairline;
  if (!grid || !grid.cells || !grid.cells.length) {
    return (
      <div className={`rounded-lg border ${hairline} ${selectedBg}`}>
        <EmptyState
          icon={
            <FontAwesomeIcon icon="table-cells-large" className="h-6 w-6" />
          }
          title="No layout yet"
          description="This page has no grid. Open the dashboard to lay out its widgets."
          testId="layout-empty"
        />
      </div>
    );
  }
  return (
    <div
      className={`h-48 rounded-lg border p-2 ${hairline} ${selectedBg}`}
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
        gap: "6px",
      }}
    >
      {grid.cells.map((cell) => (
        <div
          key={`${cell.row}.${cell.col}`}
          data-testid="layout-cell"
          className={`rounded-md border ${cellEdge} ${cellSurface}`}
          style={{
            gridColumn: cell.colSpan ? `span ${cell.colSpan}` : undefined,
            gridRow: cell.rowSpan ? `span ${cell.rowSpan}` : undefined,
          }}
        />
      ))}
    </div>
  );
};

/** One dashboard's details (the right-hand panel). */
const DashboardDetailPanel = ({
  ws,
  summary,
  approvals,
  folderName,
  themeName,
  menuItems,
  themes,
  appId,
  dashApi,
  onReloadWorkspaces,
  onOpenWorkspace,
  onOpenBotsView,
  onOpenDashboardConfig,
  onRequestDelete,
  // Set when there is more than one profile: take it out of the active one.
  onRequestRemoveFromProfile = null,
  activeProfileName = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const team = useTeamBots(ws.id);
  const [pageIndex, setPageIndex] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(ws.name || "");
  const [publishOpen, setPublishOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);

  const page = summary.pages[pageIndex] || summary.pages[0];
  const attention = attentionText(summary.unresolvedProviders, approvals);
  const registryPackage = ws._dashboardConfig?.registryPackage;
  const isShareable = ws._dashboardConfig?.shareable !== false;
  const teamBots = [team.lead, ...(team.members || [])].filter(Boolean);

  const save = (updated) => {
    if (!dashApi || !appId) return;
    dashApi.saveWorkspace(
      appId,
      forSave(updated),
      () => onReloadWorkspaces && onReloadWorkspaces(),
      (e, err) =>
        window.dispatchEvent(
          new CustomEvent("dash:notify", {
            detail: {
              type: "error",
              title: "Couldn't save the dashboard",
              message: saveErrorText(err) || "Try again.",
              duration: 8000,
            },
          }),
        ),
    );
  };

  const saveName = () => {
    if (!name.trim()) return;
    save({ ...ws, name: name.trim() });
    setRenaming(false);
  };

  const duplicate = () => {
    save({
      ...deepCopy(ws),
      id: Date.now(),
      version: Date.now(),
      name: `${ws.name || "Dashboard"} (Copy)`,
    });
  };

  // With its bots by default (create-entry 5a): they come back wired to
  // the imported dashboard's widgets.
  async function exportZip(includeBots = true) {
    if (!appId) return;
    setExportStatus("Exporting…");
    try {
      const result = await window.mainApi.dashboardConfig.exportDashboardConfig(
        appId,
        ws.id,
        { includeBots },
      );
      setExportStatus(exportedText(result));
    } catch (err) {
      setExportStatus(err.message || "Export failed.");
    }
    setTimeout(() => setExportStatus(null), 3000);
  }

  const folderOptions = menuItems
    .map((m) => ({ label: m.name, value: String(m.id) }))
    .sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  const themeOptions = Object.entries(themes || {})
    .map(([key, t]) => ({ label: t.name || key, value: key }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          {renaming ? (
            <div className="flex flex-row items-end gap-2">
              <InputText
                label="Dashboard name"
                value={name}
                onChange={(v) => setName(v)}
              />
              <Button3 title="Save name" size="sm" onClick={saveName} />
              <Button3
                title="Cancel"
                size="sm"
                onClick={() => {
                  setRenaming(false);
                  setName(ws.name || "");
                }}
              />
            </div>
          ) : (
            <h3 className={`text-lg font-semibold truncate ${strong}`}>
              {ws.name || "Untitled"}
            </h3>
          )}
          <span className={`text-sm ${muted}`}>
            {folderName}
            {themeName ? ` · theme ${themeName}` : ""}
          </span>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Button title="Open" size="sm" onClick={() => onOpenWorkspace(ws)} />
          <Button3
            title="Bots view"
            size="sm"
            onClick={() => onOpenBotsView(ws)}
          />
          <Button3
            title="Dashboard Config"
            size="sm"
            onClick={() => onOpenDashboardConfig(ws)}
          />
          <OverflowMenu
            items={[
              {
                label: "Rename",
                icon: "pen",
                onClick: () => setRenaming(true),
              },
              { label: "Duplicate", icon: "clone", onClick: duplicate },
              {
                label: (team.members || []).length
                  ? "Export ZIP with bots"
                  : "Export ZIP",
                icon: "file-zipper",
                onClick: () => exportZip(true),
              },
              (team.members || []).length
                ? {
                    label: "Export ZIP without bots",
                    icon: "file-zipper",
                    onClick: () => exportZip(false),
                  }
                : null,
              isShareable
                ? {
                    label: "Publish",
                    icon: "cloud-arrow-up",
                    onClick: () => setPublishOpen(true),
                  }
                : null,
              onRequestRemoveFromProfile
                ? {
                    label: `Remove from ${activeProfileName || "this profile"}`,
                    icon: "circle-minus",
                    onClick: () => onRequestRemoveFromProfile(ws),
                  }
                : null,
              {
                label: "Delete",
                icon: "trash-can",
                onClick: () => onRequestDelete(ws),
              },
            ]}
          />
        </div>
      </div>
      {exportStatus ? (
        <span className={`text-sm ${muted}`}>{exportStatus}</span>
      ) : null}
      {attention ? (
        <div>
          <StatusBadge state="warning" label={attention} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Layout + pages */}
        <div className="flex flex-col gap-2">
          <SectionLabel text={`Layout · ${page ? page.name : ""}`} />
          <LayoutPreview
            grid={page ? page.grid : null}
            hairline={hairline}
            selectedBg={selectedBg}
          />
          <div className="flex flex-row flex-wrap gap-1.5">
            {summary.pages.map((p, i) => (
              <button
                key={p.id || i}
                type="button"
                aria-pressed={p === page}
                onClick={() => setPageIndex(i)}
                className={`px-2 py-1 rounded-md border text-xs ${
                  p === page
                    ? `${selectedBg} ${hairline} ${strong}`
                    : `border-transparent ${muted}`
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Widgets */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text={`Widgets · ${summary.widgets.length}`} />
          {summary.widgets.length ? (
            <div className="flex flex-col gap-1.5">
              {summary.widgets.map((w) => (
                <div
                  key={w.id}
                  className="flex flex-row items-center justify-between gap-3 text-sm min-w-0"
                >
                  <span className="truncate">{w.name}</span>
                  {w.package ? (
                    <span className={`text-xs font-mono truncate ${muted}`}>
                      {w.package}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>No widgets yet</span>
          )}
        </div>

        {/* Bots */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Bots" />
          {teamBots.length ? (
            <div className="flex flex-col gap-1.5">
              {teamBots.map((b) => {
                const status = team.statusOf ? team.statusOf(b.id) : "Idle";
                const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
                return (
                  <div
                    key={b.id}
                    className="flex flex-row items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-row items-center gap-2 min-w-0">
                      <span className="truncate">{b.name}</span>
                      {b.role === "lead" ? (
                        <StatusBadge state="neutral" label="Lead" />
                      ) : null}
                    </span>
                    <span
                      className={`flex flex-row items-center gap-1.5 text-xs flex-shrink-0 ${muted}`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${dot}`}
                      />
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>No bots yet</span>
          )}
        </div>

        {/* Providers */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Providers" />
          {summary.providers.length ? (
            <div className="flex flex-col gap-1.5 text-sm">
              {summary.providers.map((p) => (
                <span key={p} className="truncate">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>None</span>
          )}
          {summary.unresolvedProviders > 0 ? (
            <span className={`text-sm ${muted}`}>
              <StatusBadge
                state="warning"
                compact
                label={`${plural(summary.unresolvedProviders, "required provider")} not set`}
              />{" "}
              Fix in Dashboard Config.
            </span>
          ) : null}
        </div>
      </div>

      {/* Folder + theme */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t ${hairline}`}
      >
        <SelectInput
          label="Folder"
          // A dashboard outside every folder (or in a folder that is gone)
          // shows "No folder", not a blank select.
          value={
            menuItems.some((m) => m.id === ws.menuId)
              ? String(ws.menuId)
              : NO_FOLDER
          }
          onChange={(val) =>
            save({
              ...ws,
              menuId: val && val !== NO_FOLDER ? Number(val) : null,
            })
          }
          options={[{ label: "No folder", value: NO_FOLDER }, ...folderOptions]}
          placeholder="No folder"
        />
        <SelectInput
          label="Theme"
          value={ws.themeKey || ""}
          onChange={(val) => save({ ...ws, themeKey: val || null })}
          options={themeOptions}
          placeholder="Select a theme"
        />
      </div>

      {registryPackage ? (
        <div className="flex flex-col gap-2">
          <span className={`text-xs ${muted}`}>
            Imported from the registry:{" "}
            <span className="font-mono">{registryPackage}</span>
          </span>
          {appId ? (
            <StarRating
              appId={appId}
              packageName={registryPackage}
              interactive={true}
            />
          ) : null}
        </div>
      ) : null}

      <PublishDashboardModal
        isOpen={publishOpen}
        setIsOpen={setPublishOpen}
        appId={appId}
        workspaceId={ws.id}
        workspaceName={ws.name}
      />
    </div>
  );
};

/**
 * DashboardsPage — every dashboard as list + detail (app-navigation PRD
 * NAV-005): grouped by folder (or A–Z), search across dashboard and widget
 * names, a Folder filter; the detail shows the layout per page, widgets,
 * bots, providers and what needs attention, with Open / Bots view /
 * Dashboard Config and Rename / Duplicate / Export / Publish / Delete.
 */
export const DashboardsPage = ({
  workspaces = [],
  menuItems = [],
  dashApi = null,
  credentials = null,
  onReloadWorkspaces = null,
  onOpenWorkspace = () => {},
  onOpenBotsView = () => {},
  onOpenDashboardConfig = () => {},
}) => {
  const { muted } = useConfigTokens();
  const themeCtx = useContext(ThemeContext) || {};
  const themes = themeCtx.themes || {};
  const appContext = useContext(AppContext) || {};
  const appProviders = appContext.providers || {};
  const approvalsFor = useApprovalsByDashboard();
  const appId = credentials?.appId;

  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState([]);
  const [view, setView] = useState("grouped");
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const profiles = useProfiles(appId);

  const summaries = useMemo(() => {
    const map = new Map();
    for (const ws of workspaces) {
      map.set(
        ws.id,
        dashboardSummary(ws, {
          getWidgetConfig,
          getWidgetRequirements,
          appProviders,
          providersLoaded: appContext.providersLoaded,
        }),
      );
    }
    return map;
  }, [workspaces, appProviders, appContext.providersLoaded]);

  const folderNameOf = (ws) =>
    menuItems.find((m) => m.id === ws.menuId)?.name || UNCATEGORIZED;

  const q = query.trim().toLowerCase();
  const visible = workspaces.filter((ws) => {
    if (folders.length && !folders.includes(folderNameOf(ws))) return false;
    if (!q) return true;
    const s = summaries.get(ws.id);
    const haystack = [
      ws.name || "",
      ...(s ? s.widgets.map((w) => `${w.name} ${w.component || ""}`) : []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const groups =
    view === "grouped"
      ? [
          ...menuItems.map((m) => ({
            name: m.name,
            items: visible.filter((ws) => ws.menuId === m.id),
          })),
          {
            name: UNCATEGORIZED,
            items: visible.filter(
              (ws) => !menuItems.some((m) => m.id === ws.menuId),
            ),
          },
        ].filter((g) => g.items.length)
      : [
          {
            name: null,
            items: [...visible].sort((a, b) =>
              (a.name || "Untitled").localeCompare(b.name || "Untitled"),
            ),
          },
        ];
  const ordered = groups.flatMap((g) => g.items);
  const selected =
    ordered.find((ws) => ws.id === selectedId) || ordered[0] || null;

  const folderOptions = [...menuItems.map((m) => m.name), UNCATEGORIZED].map(
    (name) => ({
      value: name,
      label: name,
      count: workspaces.filter((ws) => folderNameOf(ws) === name).length,
    }),
  );

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !dashApi || !appId) return;
    dashApi.deleteWorkspace(
      appId,
      target.id,
      () => {
        if (selectedId === target.id) setSelectedId(null);
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => console.error("Delete dashboard error:", err),
    );
  };

  // Out of the active profile only — it stays on this computer.
  const confirmRemove = async () => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    const res = await profiles.removeFromActive("dashboards", target.id);
    if (!res.success) {
      window.dispatchEvent(
        new CustomEvent("dash:notify", {
          detail: {
            type: "error",
            title: "Couldn't remove the dashboard from this profile",
            message: res.error || "Try again.",
            duration: 8000,
          },
        }),
      );
      return;
    }
    if (selectedId === target.id) setSelectedId(null);
    onReloadWorkspaces && onReloadWorkspaces();
  };
  const removeElsewhere = removeTarget
    ? profiles.otherHolders("dashboards", removeTarget.id)
    : [];

  let detail;
  if (selected) {
    const theme = selected.themeKey ? themes[selected.themeKey] : null;
    detail = (
      <DashboardDetailPanel
        key={selected.id}
        ws={selected}
        summary={summaries.get(selected.id)}
        approvals={approvalsFor(selected.id)}
        folderName={folderNameOf(selected)}
        themeName={theme ? theme.name || selected.themeKey : null}
        menuItems={menuItems}
        themes={themes}
        appId={appId}
        dashApi={dashApi}
        onReloadWorkspaces={onReloadWorkspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotsView={onOpenBotsView}
        onOpenDashboardConfig={onOpenDashboardConfig}
        onRequestDelete={setDeleteTarget}
        onRequestRemoveFromProfile={
          profiles.hasProfiles ? setRemoveTarget : null
        }
        activeProfileName={profiles.active?.name}
      />
    );
  } else {
    detail = (
      <span className={`text-sm ${muted}`}>
        {q || folders.length
          ? "No dashboards match these filters."
          : "No dashboards yet."}
      </span>
    );
  }

  return (
    <ManageLayout
      testId="dashboards-page"
      listLabel="Dashboards"
      detailTestId="dashboard-detail"
      toolbar={
        <>
          <div className="w-72">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search dashboards or widgets…"
            />
          </div>
          <FilterMenu
            label="Folder"
            options={folderOptions}
            selected={folders}
            onChange={setFolders}
          />
          <SegmentedControl
            ariaLabel="Order"
            options={[
              { value: "grouped", label: "Grouped" },
              { value: "alphabetical", label: "A-Z" },
            ]}
            value={view}
            onChange={setView}
          />
        </>
      }
      list={
        <>
          {groups.map((g) => (
            <div key={g.name || "all"} className="flex flex-col gap-0.5">
              {g.name ? <ListGroupLabel text={g.name} /> : null}
              {g.items.map((ws) => {
                const s = summaries.get(ws.id);
                const needs =
                  (s && s.unresolvedProviders > 0) || approvalsFor(ws.id) > 0;
                const active = selected && ws.id === selected.id;
                const theme = ws.themeKey ? themes[ws.themeKey] : null;
                const meta = [
                  s
                    ? `${plural(s.pages.length, "page")} · ${plural(
                        s.widgets.length,
                        "widget",
                      )}`
                    : "",
                  updatedText(ws),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <ListRow
                    key={ws.id}
                    icon="table-cells-large"
                    selected={!!active}
                    onClick={() => setSelectedId(ws.id)}
                    title={<span data-name>{ws.name || "Untitled"}</span>}
                    meta={
                      <span className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{meta}</span>
                        {theme ? <ThemeColorDots theme={theme} /> : null}
                        {needs ? (
                          <span data-testid="dashboard-attention">
                            <StatusBadge
                              state="warning"
                              compact
                              label="Needs attention"
                            />
                          </span>
                        ) : null}
                      </span>
                    }
                  />
                );
              })}
            </div>
          ))}
          {!ordered.length ? (
            <span className={`text-sm px-2 ${muted}`}>
              No dashboards match.
            </span>
          ) : null}
        </>
      }
      detail={detail}
    >
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete dashboard"
        message={`Delete "${deleteTarget?.name || "Untitled"}"${
          profiles.hasProfiles ? " from this computer and every profile" : ""
        }? This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmationModal
        isOpen={!!removeTarget}
        setIsOpen={() => setRemoveTarget(null)}
        title={`Remove "${removeTarget?.name || "Untitled"}" from ${
          profiles.active?.name || "this profile"
        }`}
        message={
          removeElsewhere.length
            ? `"${removeTarget?.name || "Untitled"}" won't show in ${profiles.active?.name || "this profile"}. It stays in ${removeElsewhere.join(", ")}.`
            : `"${removeTarget?.name || "Untitled"}" isn't in any other profile, so it won't show anywhere. It stays on this computer — add it back in Settings › Profiles.`
        }
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </ManageLayout>
  );
};

export default DashboardsPage;
