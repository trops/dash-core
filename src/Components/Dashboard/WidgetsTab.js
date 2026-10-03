import React, { useState, useMemo, useEffect } from "react";
import { Button3, FontAwesomeIcon, SectionLabel } from "@trops/dash-react";
import { forEachWidget } from "../../utils/providerResolution";
import {
  pickWidgetDisplayName,
  pickWidgetRef,
  belongsToWorkspace,
  isUserWidget,
} from "../../utils/widgetIdentity";
import { PanelEditForm } from "../../Context/Modal/Panel/PanelEditForm";
import { ConfigListRow, useConfigTokens } from "./ConfigListRow";

const ALL_WIDGETS_ID = "__ALL__";

/**
 * Build the scoped registry identifier for a widget. Surfaces the
 * `scope.packageName.component` triple in the settings UI so users
 * can verify what a widget's registry identity is — useful when
 * diagnosing dashboard-install warnings ("why didn't this widget
 * install?" → scoped id in the warning vs scoped id shown here).
 * Returns just the component name when scope/package metadata is
 * unavailable (e.g. bare built-ins).
 */
function buildScopedId(widget) {
  if (!widget?.component) return null;
  const scope = widget.scope ? String(widget.scope).replace(/^@/, "") : null;
  const pkg = widget.packageName
    ? scope
      ? String(widget.packageName).replace(new RegExp(`^@?${scope}/`), "")
      : String(widget.packageName).replace(/^@/, "")
    : null;
  if (scope && pkg) return `${scope}.${pkg}.${widget.component}`;
  if (pkg) return `${pkg}.${widget.component}`;
  return widget.component;
}

/**
 * WidgetsTab
 *
 * Renders inside DashboardConfigModal as a third tab alongside
 * Providers and Listeners. Master-detail layout — left column lists
 * every widget on the workspace, right pane renders that widget's
 * userConfig form (reuses PanelEditForm so the editor UI is identical
 * to the per-widget gear settings). A pinned "All Widgets" row at the
 * top surfaces fields shared across 2+ widgets and lets the user apply
 * one value to every matching widget at once.
 *
 * Edits are staged by the parent modal via `stagePrefField` and
 * `stagePrefFieldForAll`; this component reads the staged overlay to
 * show live values. The parent flushes on Save.
 *
 * @param {object} workspace              Current workspace.
 * @param {(componentName) => object | null} getWidgetConfig
 *                                        ComponentManager entry for the widget.
 * @param {object} stagedPrefs            { [widgetId]: { [fieldKey]: value } } — live staged overlay.
 * @param {(widgetId, key, value) => void} stagePrefField
 * @param {(widgets: Array<{id}>, key, value) => void} stagePrefFieldForAll
 */
export const WidgetsTab = ({
  workspace,
  getWidgetConfig,
  stagedPrefs,
  stagePrefField,
  stagePrefFieldForAll,
}) => {
  const { muted, hairline } = useConfigTokens();
  // Flatten every widget on the workspace, preserving which layout
  // section each came from (Main / Page N / Sidebar) so the left
  // column can group them cleanly. forEachWidget already dedupes.
  const widgets = useMemo(() => {
    if (!workspace) return [];
    const seen = new Set();
    const result = [];
    const pushFromSection = (section) => (item) => {
      // Skip framework chrome (LayoutGridContainer / Container) —
      // the WidgetsTab is for user-configurable widgets only.
      if (!isUserWidget(item)) return;
      // Cross-dashboard isolation: skip items whose dashboardId
      // stamp doesn't match this workspace. Closes the same leak
      // the Listeners tab already filters against.
      if (!belongsToWorkspace(item, workspace)) return;
      const id = item.uuidString || item.uuid || item.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const cfg = getWidgetConfig ? getWidgetConfig(item.component) || {} : {};
      result.push({
        id,
        component: item.component,
        displayName: pickWidgetDisplayName(item, cfg),
        widgetRef: pickWidgetRef(item),
        section,
        userConfig: cfg.userConfig || {},
        userPrefs: item.userPrefs || {},
        scope: cfg.scope || item.scope || null,
        packageName: cfg.packageName || cfg.name || item.packageName || null,
      });
    };
    const walkWithSection = (items, section) => {
      if (!Array.isArray(items)) return;
      forEachWidget({ layout: items }, pushFromSection(section));
    };
    walkWithSection(workspace.layout, "Main");
    if (Array.isArray(workspace.pages)) {
      workspace.pages.forEach((page, idx) => {
        walkWithSection(page?.layout, page?.name || `Page ${idx + 1}`);
      });
    }
    walkWithSection(workspace.sidebarLayout, "Sidebar");
    return result;
  }, [workspace, getWidgetConfig]);

  // Fields declared by ≥ 2 widgets with matching type. Secrets are
  // excluded from bulk edit — credentials shouldn't be spread across
  // widgets from a single input.
  const sharedFields = useMemo(() => {
    const byKey = new Map();
    for (const w of widgets) {
      for (const [key, schema] of Object.entries(w.userConfig)) {
        if (!schema || schema.type === "secret") continue;
        const bucketKey = `${key}::${schema.type}`;
        const bucket = byKey.get(bucketKey) || { key, schema, widgets: [] };
        bucket.widgets.push(w);
        byKey.set(bucketKey, bucket);
      }
    }
    return [...byKey.values()].filter((b) => b.widgets.length >= 2);
  }, [widgets]);

  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    // Prefer "All Widgets" when shared fields exist (the bulk-edit use
    // case that motivated this feature). Otherwise select the first
    // widget.
    if (sharedFields.length > 0) setSelectedId(ALL_WIDGETS_ID);
    else if (widgets.length > 0) setSelectedId(widgets[0].id);
    else setSelectedId(null);
  }, [sharedFields.length, widgets.length]);

  const groupedWidgets = useMemo(() => {
    const groups = new Map();
    for (const w of widgets) {
      if (!groups.has(w.section)) groups.set(w.section, []);
      groups.get(w.section).push(w);
    }
    return [...groups.entries()];
  }, [widgets]);

  const isAllMode = selectedId === ALL_WIDGETS_ID;
  const selectedWidget =
    !isAllMode && selectedId ? widgets.find((w) => w.id === selectedId) : null;

  function effectivePrefs(widget) {
    return { ...widget.userPrefs, ...(stagedPrefs?.[widget.id] || {}) };
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left column — the Bots view's team-list rows. */}
      <div
        className={`w-64 border-r overflow-y-auto flex-shrink-0 p-3 flex flex-col gap-1 ${hairline}`}
      >
        {sharedFields.length > 0 && (
          <ConfigListRow
            title={
              <span className="flex flex-row items-center gap-2">
                <FontAwesomeIcon icon="layer-group" className="h-3.5 w-3.5" />
                All Widgets
              </span>
            }
            meta={`${sharedFields.length} shared field${
              sharedFields.length === 1 ? "" : "s"
            } · bulk edit`}
            active={isAllMode}
            onClick={() => setSelectedId(ALL_WIDGETS_ID)}
          />
        )}
        {groupedWidgets.map(([section, sectionWidgets]) => (
          <div key={section} className="flex flex-col gap-1">
            <SectionLabel className="px-3 pt-3 pb-1">{section}</SectionLabel>
            {sectionWidgets.map((w) => {
              const fieldCount = Object.keys(w.userConfig).length;
              const stagedForWidget = stagedPrefs?.[w.id]
                ? Object.keys(stagedPrefs[w.id]).length
                : 0;
              return (
                <ConfigListRow
                  key={w.id}
                  title={w.displayName}
                  subtitle={w.widgetRef || null}
                  meta={
                    fieldCount === 0
                      ? "No configurable fields"
                      : `${fieldCount} field${fieldCount === 1 ? "" : "s"}`
                  }
                  badge={
                    stagedForWidget > 0 ? (
                      <span
                        className="flex flex-row items-center gap-1.5 text-xs text-amber-400 flex-shrink-0"
                        title="Unsaved changes"
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                        {stagedForWidget}
                      </span>
                    ) : null
                  }
                  active={selectedId === w.id}
                  onClick={() => setSelectedId(w.id)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Right pane */}
      <div className="flex-1 overflow-y-auto p-5 min-w-0">
        {!selectedId && (
          <div className={`text-sm italic ${muted}`}>
            Select a widget from the list.
          </div>
        )}
        {isAllMode && (
          <BulkEditPane
            sharedFields={sharedFields}
            stagedPrefs={stagedPrefs}
            onApplyAll={stagePrefFieldForAll}
          />
        )}
        {selectedWidget && (
          <SingleWidgetPane
            widget={selectedWidget}
            effectivePrefs={effectivePrefs(selectedWidget)}
            onFieldChange={(key, value) =>
              stagePrefField(selectedWidget.id, key, value)
            }
          />
        )}
      </div>
    </div>
  );
};

function SingleWidgetPane({ widget, effectivePrefs, onFieldChange }) {
  const { muted, strong } = useConfigTokens();
  const hasFields = Object.keys(widget.userConfig).length > 0;
  return (
    <div>
      <div className="mb-3">
        <div className={`font-semibold ${strong}`}>{widget.displayName}</div>
        {widget.widgetRef && (
          <div
            className={`text-xs font-mono truncate mt-0.5 ${muted}`}
            title={widget.widgetRef}
          >
            {widget.widgetRef}
          </div>
        )}
        <div className={`text-xs mt-0.5 ${muted}`}>{widget.section}</div>
      </div>
      {hasFields ? (
        <PanelEditForm
          userConfig={widget.userConfig}
          userPrefs={effectivePrefs}
          onFieldChange={onFieldChange}
        />
      ) : (
        <div className={`text-sm italic ${muted}`}>
          This widget has no configurable fields. It may be event-driven — pair
          it with a widget that publishes the events it listens for.
        </div>
      )}
    </div>
  );
}

function BulkEditPane({ sharedFields, stagedPrefs, onApplyAll }) {
  const { muted, strong } = useConfigTokens();
  return (
    <div>
      <div className="mb-3">
        <div className={`font-semibold ${strong}`}>All Widgets</div>
        <div className={`text-xs ${muted}`}>
          Fields declared by 2+ widgets on this dashboard. Apply once to update
          every matching widget.
        </div>
      </div>
      <div className="space-y-3">
        {sharedFields.map((field) => (
          <SharedFieldRow
            key={`${field.key}::${field.schema.type}`}
            field={field}
            stagedPrefs={stagedPrefs}
            onApplyAll={onApplyAll}
          />
        ))}
        {sharedFields.length === 0 && (
          <div className={`text-sm italic ${muted}`}>
            No shared fields across widgets on this dashboard.
          </div>
        )}
      </div>
    </div>
  );
}

function SharedFieldRow({ field, stagedPrefs, onApplyAll }) {
  // Per-widget values = persisted + staged overlay. Used to decide
  // whether the field is "converged" and to show a distinct-values hint.
  const currentValues = field.widgets.map((w) => {
    const eff = { ...w.userPrefs, ...(stagedPrefs?.[w.id] || {}) };
    return eff[field.key] ?? "";
  });
  const distinctValues = [...new Set(currentValues)];
  const allSame = distinctValues.length === 1;
  const [draft, setDraft] = useState(allSame ? distinctValues[0] : "");
  useEffect(() => {
    if (allSame) setDraft(distinctValues[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSame, distinctValues[0]]);

  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const fieldClass = `w-full px-2 py-1.5 rounded-lg border text-sm ${fieldBg} ${hairline} ${strong}`;

  return (
    <div className={`rounded-lg border p-3 ${hairline}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${strong}`}>
            {field.schema.displayName || field.key}
          </div>
          <div className={`text-xs ${muted}`}>
            Applies to {field.widgets.length} widgets
            {allSame
              ? ""
              : ` · ${distinctValues.length} distinct values in use`}
          </div>
        </div>
        <Button3
          title="Apply to all"
          size="sm"
          onClick={() => onApplyAll(field.widgets, field.key, draft)}
        />
      </div>
      {field.schema.type === "select" ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={fieldClass}
        >
          {(field.schema.options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.displayName}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={allSame ? "" : "(multiple values — set one for all)"}
          className={fieldClass}
        />
      )}
    </div>
  );
}

export default WidgetsTab;
