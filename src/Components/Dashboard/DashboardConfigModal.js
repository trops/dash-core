import React, { useState, useMemo, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Button2,
  Button3,
  Tag,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import {
  getAllProviderBindings,
  groupByProviderType,
} from "../../utils/providerResolution";

/**
 * DashboardConfigModal
 *
 * Workspace-scoped wiring panel. Lets a user assign providers to every
 * widget in the current workspace from one place instead of opening each
 * widget's settings individually. v1 ships the Providers tab; Listeners
 * tab lands in a follow-up PR (data model needs more exploration).
 *
 * Auto-opens on dashboard install when any required provider is still
 * unresolved after applying app-wide defaults. Also openable manually
 * via the dashboard toolbar's config button.
 *
 * @param {boolean} isOpen
 * @param {(open: boolean) => void} setIsOpen
 * @param {object}   workspace          Current workspace (layout/pages/sidebarLayout/selectedProviders).
 * @param {object|Array} appProviders   Either a map keyed by provider name, or an array. Each entry has
 *                                      at least { name?, type, providerClass, isDefaultForType }.
 * @param {(componentName: string) => Array} getWidgetRequirements
 *                                      Called per widget instance. Should return the `providers: [...]`
 *                                      array from the component's .dash.js. Usually backed by
 *                                      ComponentManager.componentMap().
 * @param {(changes: Array<{widgetId, providerType, providerName}>) => void} onSaveBindings
 *                                      Called with the staged changes on Save. The parent persists
 *                                      by forwarding to its existing `handleProviderSelect` /
 *                                      `saveWorkspace` plumbing.
 */
export const DashboardConfigModal = ({
  isOpen,
  setIsOpen,
  workspace,
  appProviders,
  getWidgetRequirements,
  onSaveBindings,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  // Staged changes: widgetId -> { [providerType]: providerName }. Empty
  // until the user picks something; applied on Save via onSaveBindings.
  const [staged, setStaged] = useState({});

  const bindings = useMemo(
    () =>
      getAllProviderBindings({
        workspace,
        appProviders,
        getWidgetRequirements,
      }),
    [workspace, appProviders, getWidgetRequirements],
  );

  // Reflect staged choice in resolution without persisting. Used to
  // render the "still unresolved after your changes" count in real time.
  const effectiveBindings = useMemo(
    () =>
      bindings.map((b) => {
        const override = staged[b.widgetId]?.[b.providerType];
        if (override !== undefined) {
          return {
            ...b,
            resolvedProviderName: override || null,
            staged: true,
          };
        }
        return b;
      }),
    [bindings, staged],
  );

  const grouped = useMemo(
    () => groupByProviderType(effectiveBindings),
    [effectiveBindings],
  );

  // Provider options per type, derived from the app's providers map.
  const providersByType = useMemo(() => {
    const byType = new Map();
    const push = (name, data) => {
      if (!data?.type) return;
      if (!byType.has(data.type)) byType.set(data.type, []);
      byType.get(data.type).push({
        name,
        isDefaultForType: !!data.isDefaultForType,
      });
    };
    if (!appProviders) return byType;
    if (Array.isArray(appProviders)) {
      for (const p of appProviders) push(p?.name, p);
    } else {
      for (const [name, data] of Object.entries(appProviders))
        push(name, data);
    }
    return byType;
  }, [appProviders]);

  const unresolvedCount = effectiveBindings.filter(
    (b) => b.required && !b.resolvedProviderName,
  ).length;

  const hasStagedChanges = Object.keys(staged).some(
    (wid) => Object.keys(staged[wid] || {}).length > 0,
  );

  function stageBinding(widgetId, providerType, providerName) {
    setStaged((prev) => {
      const next = { ...prev };
      const wid = next[widgetId] ? { ...next[widgetId] } : {};
      wid[providerType] = providerName || "";
      next[widgetId] = wid;
      return next;
    });
  }

  // Bulk-apply: write this provider as the binding for every widget of
  // this type that doesn't already have an explicit widget-level override.
  function stageBulk(providerType, providerName) {
    const affected = effectiveBindings.filter(
      (b) =>
        b.providerType === providerType &&
        !b.layoutItem?.selectedProviders?.[providerType],
    );
    setStaged((prev) => {
      const next = { ...prev };
      for (const b of affected) {
        if (!b.widgetId) continue;
        next[b.widgetId] = {
          ...(next[b.widgetId] || {}),
          [providerType]: providerName || "",
        };
      }
      return next;
    });
  }

  function handleSave() {
    const changes = [];
    for (const [widgetId, byType] of Object.entries(staged)) {
      for (const [providerType, providerName] of Object.entries(byType)) {
        changes.push({
          widgetId,
          providerType,
          providerName: providerName || null,
        });
      }
    }
    if (typeof onSaveBindings === "function") onSaveBindings(changes);
    setStaged({});
    setIsOpen(false);
  }

  function handleCancel() {
    setStaged({});
    setIsOpen(false);
  }

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} setIsOpen={handleCancel} width="w-full max-w-3xl">
      <div
        className={`flex flex-col rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex flex-row items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon="sliders" className="h-4 w-4 opacity-70" />
            <span className="text-lg font-semibold">Dashboard Config</span>
            {unresolvedCount > 0 && (
              <Tag
                text={`${unresolvedCount} unresolved`}
                className="bg-amber-900/40 text-amber-200"
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <FontAwesomeIcon icon="xmark" className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs (one tab today; listeners lands in v2) */}
        <div className="flex-shrink-0 flex flex-row items-center gap-2 px-4 pt-3 border-b border-white/10">
          <div className="px-3 py-1.5 text-sm font-medium border-b-2 border-indigo-400 -mb-px">
            Providers
          </div>
          <div className="px-3 py-1.5 text-sm opacity-40 cursor-not-allowed">
            Listeners (coming soon)
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {grouped.size === 0 && (
            <div className="text-sm opacity-60 text-center py-6">
              No widgets in this dashboard require providers.
            </div>
          )}

          {Array.from(grouped.entries()).map(([providerType, rows]) => {
            const options = providersByType.get(providerType) || [];
            const unresolvedHere = rows.filter(
              (r) => r.required && !r.resolvedProviderName,
            ).length;
            // The "top" dropdown reflects the currently-agreeable choice:
            // if every row has the same resolved value, show it; otherwise
            // show "" (mixed) so the dropdown is neutral.
            const allSame = rows.every(
              (r) => r.resolvedProviderName === rows[0].resolvedProviderName,
            );
            const topValue = allSame ? rows[0].resolvedProviderName || "" : "";

            return (
              <ProviderTypeRow
                key={providerType}
                providerType={providerType}
                rows={rows}
                options={options}
                topValue={topValue}
                unresolvedHere={unresolvedHere}
                onBulk={(name) => stageBulk(providerType, name)}
                onPerWidget={(widgetId, name) =>
                  stageBinding(widgetId, providerType, name)
                }
              />
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex flex-row justify-end gap-2 p-4 border-t border-white/10">
          <Button3 title="Cancel" onClick={handleCancel} />
          <Button2
            title={hasStagedChanges ? "Save changes" : "Save"}
            onClick={handleSave}
            disabled={!hasStagedChanges}
          />
        </div>
      </div>
    </Modal>
  );
};

/**
 * A single provider-type row: bulk dropdown + expandable per-widget
 * list. Local state for whether the per-widget overrides panel is open.
 */
function ProviderTypeRow({
  providerType,
  rows,
  options,
  topValue,
  unresolvedHere,
  onBulk,
  onPerWidget,
}) {
  const [expanded, setExpanded] = useState(unresolvedHere > 0);
  const widgetCount = rows.length;

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
      <div className="flex flex-row items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            <code className="text-xs bg-white/10 px-1.5 py-0.5 rounded">
              {providerType}
            </code>
            <span className="text-xs opacity-60">
              {widgetCount} widget{widgetCount === 1 ? "" : "s"}
            </span>
            {unresolvedHere > 0 && (
              <span className="text-xs text-amber-300 flex items-center gap-1">
                <FontAwesomeIcon
                  icon="triangle-exclamation"
                  className="h-3 w-3"
                />
                {unresolvedHere} unresolved
              </span>
            )}
          </div>
        </div>
        <select
          value={topValue}
          onChange={(e) => onBulk(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm min-w-[14rem]"
        >
          <option value="">— Select provider —</option>
          {options.map((opt) => (
            <option key={opt.name} value={opt.name}>
              {opt.name}
              {opt.isDefaultForType ? "  (default)" : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs opacity-60 hover:opacity-100 flex items-center gap-1"
      >
        <FontAwesomeIcon
          icon={expanded ? "chevron-down" : "chevron-right"}
          className="h-3 w-3"
        />
        {expanded ? "Hide" : "Show"} per-widget overrides
      </button>

      {expanded && (
        <div className="pl-3 border-l border-white/10 space-y-2">
          {rows.map((row) => {
            const hasExplicitOverride =
              !!row.layoutItem?.selectedProviders?.[providerType];
            return (
              <div
                key={`${row.widgetId}:${row.providerType}`}
                className="flex flex-row items-center gap-3"
              >
                <div className="flex-1 min-w-0 text-xs">
                  <span className="font-mono opacity-80 truncate">
                    {row.component || "widget"}
                  </span>
                  <span className="opacity-40 mx-1">·</span>
                  <span className="font-mono opacity-40 truncate">
                    {(row.widgetId || "").slice(0, 8)}
                  </span>
                  {hasExplicitOverride && (
                    <span className="ml-2 text-[10px] text-indigo-300 uppercase tracking-wide">
                      widget override
                    </span>
                  )}
                  {!row.resolvedProviderName && row.required && (
                    <span className="ml-2 text-[10px] text-amber-300 uppercase tracking-wide">
                      unresolved
                    </span>
                  )}
                </div>
                <select
                  value={row.resolvedProviderName || ""}
                  onChange={(e) => onPerWidget(row.widgetId, e.target.value)}
                  className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs min-w-[12rem]"
                >
                  <option value="">— none —</option>
                  {options.map((opt) => (
                    <option key={opt.name} value={opt.name}>
                      {opt.name}
                      {opt.isDefaultForType ? "  (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
