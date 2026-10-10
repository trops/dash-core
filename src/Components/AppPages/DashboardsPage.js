import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  FilterMenu,
  InputText,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  SelectInput,
  ThemeContext,
  deepCopy,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useTeamBots } from "../Bots/useTeamBots";
import { STATUS_DOT } from "../Bots/teamUtils";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import { NewDashboardChooser } from "../Settings/details/NewDashboardChooser";
import { DiscoverDashboardsDetail } from "../Settings/details/DiscoverDashboardsDetail";
import { StarRating } from "../Settings/details/StarRating";
import { PublishDashboardModal } from "../Settings/details/PublishDashboardModal";
import { dashboardSummary } from "./dashboardSummary";
import { useApprovalsByDashboard } from "./useApprovalsByDashboard";

const UNCATEGORIZED = "Uncategorized";
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

/** A page's grid as a small preview, drawn with theme tokens. */
const LayoutPreview = ({ grid, hairline, selectedBg }) => {
  if (!grid) {
    return (
      <div
        className={`flex items-center justify-center h-32 rounded-lg border text-xs opacity-60 ${hairline}`}
      >
        No grid on this page
      </div>
    );
  }
  return (
    <div
      className={`h-48 rounded-lg border p-2 ${hairline}`}
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
          className={`rounded-md border ${hairline} ${selectedBg}`}
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
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const team = useTeamBots(ws.id);
  const [pageIndex, setPageIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
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
      (e, err) => console.error("Save dashboard error:", err),
    );
  };

  const saveName = () => {
    if (!name.trim()) return;
    save({ ...ws, name: name.trim() });
    setRenaming(false);
  };

  const duplicate = () => {
    setMenuOpen(false);
    save({
      ...deepCopy(ws),
      id: Date.now(),
      version: Date.now(),
      name: `${ws.name || "Dashboard"} (Copy)`,
    });
  };

  async function exportZip() {
    setMenuOpen(false);
    if (!appId) return;
    setExportStatus("Exporting…");
    try {
      const result = await window.mainApi.dashboardConfig.exportDashboardConfig(
        appId,
        ws.id,
        {},
      );
      setExportStatus(
        result?.success ? "Exported." : result?.error || "Export failed.",
      );
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
          <Button3
            title="⋯"
            size="sm"
            ariaLabel="More actions"
            onClick={() => setMenuOpen((v) => !v)}
          />
        </div>
      </div>
      {menuOpen ? (
        <div className="flex flex-row flex-wrap justify-end gap-2">
          <Button3
            title="Rename"
            size="xs"
            onClick={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
          />
          <Button3 title="Duplicate" size="xs" onClick={duplicate} />
          <Button3 title="Export ZIP" size="xs" onClick={exportZip} />
          {isShareable ? (
            <Button3
              title="Publish"
              size="xs"
              onClick={() => {
                setMenuOpen(false);
                setPublishOpen(true);
              }}
            />
          ) : null}
          <Button3
            title="Delete"
            size="xs"
            onClick={() => {
              setMenuOpen(false);
              onRequestDelete(ws);
            }}
          />
        </div>
      ) : null}
      {exportStatus ? (
        <span className={`text-xs ${muted}`}>{exportStatus}</span>
      ) : null}
      {attention ? (
        <span className="flex flex-row items-center gap-1.5 text-sm text-amber-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          {attention}
        </span>
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
                        <span
                          className={`text-xs uppercase tracking-wider font-semibold ${muted}`}
                        >
                          Lead
                        </span>
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
            <span className="text-xs text-amber-400">
              {plural(summary.unresolvedProviders, "required provider")} not set
              — fix in Dashboard Config.
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
          value={String(ws.menuId || "")}
          onChange={(val) => save({ ...ws, menuId: val ? Number(val) : null })}
          options={folderOptions}
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
  onOpenWizard = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
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
  // null | "picker" | "marketplace"
  const [mode, setMode] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const summaries = useMemo(() => {
    const map = new Map();
    for (const ws of workspaces) {
      map.set(
        ws.id,
        dashboardSummary(ws, {
          getWidgetConfig,
          getWidgetRequirements,
          appProviders,
        }),
      );
    }
    return map;
  }, [workspaces, appProviders]);

  const folderNameOf = (ws) =>
    menuItems.find((m) => m.id === ws.menuId)?.name || UNCATEGORIZED;

  // The header's New Dashboard opens the chooser in the detail pane.
  const prevCreate = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreate.current) setMode("picker");
    prevCreate.current = createRequested;
    if (createRequested && onCreateAcknowledged) onCreateAcknowledged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

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

  let detail;
  if (mode === "picker") {
    detail = (
      <NewDashboardChooser
        onSelect={(option) => {
          if (option === "marketplace") setMode("marketplace");
          else if (option === "wizard") {
            setMode(null);
            if (onOpenWizard) onOpenWizard();
          }
        }}
      />
    );
  } else if (mode === "marketplace") {
    detail = (
      <DiscoverDashboardsDetail
        onBack={() => setMode(null)}
        appId={appId}
        onInstallComplete={() => {
          onReloadWorkspaces && onReloadWorkspaces();
          themeCtx.loadThemes && themeCtx.loadThemes();
        }}
      />
    );
  } else if (selected) {
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
    // The page's base text colour (plain names inherit it); muted text
    // keeps its own token.
    <div
      data-testid="dashboards-page"
      className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
    >
      {/* Filter bar — fixed; the list and detail scroll on their own. */}
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
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
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        <div
          role="list"
          aria-label="Dashboards"
          className="min-h-0 overflow-y-auto flex flex-col gap-3 pr-2"
        >
          {groups.map((g) => (
            <div key={g.name || "all"} className="flex flex-col gap-1">
              {g.name ? <SectionLabel text={g.name} className="px-3" /> : null}
              {g.items.map((ws) => {
                const s = summaries.get(ws.id);
                const needs =
                  (s && s.unresolvedProviders > 0) || approvalsFor(ws.id) > 0;
                const active = !mode && selected && ws.id === selected.id;
                const theme = ws.themeKey ? themes[ws.themeKey] : null;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setMode(null);
                      setSelectedId(ws.id);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 border flex flex-row items-center gap-3 ${
                      active
                        ? `${selectedBg} ${selectedBorder}`
                        : "border-transparent"
                    }`}
                  >
                    {theme ? <ThemeColorDots theme={theme} /> : null}
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span
                        data-name
                        className={`text-sm font-medium truncate ${strong}`}
                      >
                        {ws.name || "Untitled"}
                      </span>
                      <span className={`text-xs ${muted}`}>
                        {s
                          ? `${plural(s.pages.length, "page")} · ${plural(
                              s.widgets.length,
                              "widget",
                            )}`
                          : ""}
                      </span>
                    </span>
                    {needs ? (
                      <span
                        data-testid="dashboard-attention"
                        title="Needs attention"
                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          {!ordered.length ? (
            <span className={`text-sm px-3 ${muted}`}>
              No dashboards match.
            </span>
          ) : null}
        </div>
        <div
          data-testid="dashboard-detail"
          className={`col-span-2 min-h-0 overflow-y-auto rounded-lg border p-5 ${hairline}`}
        >
          {detail}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete dashboard"
        message={`Delete "${deleteTarget?.name || "Untitled"}"? This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default DashboardsPage;
