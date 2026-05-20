import { useContext, useEffect, useState } from "react";
import { deepCopy } from "@trops/dash-react";
import deepEqual from "deep-equal";
import { AppContext } from "../../../../../Context";
import { ComponentManager } from "../../../../../ComponentManager";
import { replaceItemInLayout } from "../../../../../utils/layout";
import { getUserConfigurableProviders } from "../../../../../utils/providerUtils";

/**
 * PanelEditItemProviders
 *
 * Provider editing for a single widget instance. Renders a row per
 * user-configurable provider declared by the widget's `.dash.js`
 * config, with a `<select>` listing every provider of the matching
 * type that's currently configured at the app level.
 *
 * This replaces the inline provider dropdowns that used to live in
 * the widget card header's overflow menu — pulling them into the
 * config modal gives more space for labels, instructions, and
 * future per-provider editing UX (credentials inspection, test-
 * connection buttons, etc.) without crowding the dashboard header.
 */
export const PanelEditItemProviders = ({
  workspace,
  onUpdate,
  item = null,
}) => {
  const appCtx = useContext(AppContext);
  const appProviders = appCtx?.providers || {};

  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);

  useEffect(() => {
    if (!deepEqual(item, itemSelected)) setItemSelected(() => item);
    if (!deepEqual(workspace, workspaceSelected))
      setWorkspaceSelected(() => workspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, item]);

  if (!itemSelected || !workspaceSelected) return null;

  const widgetConfig = ComponentManager.config(
    itemSelected.component,
    itemSelected,
  );

  const declaredProviders = Array.isArray(widgetConfig?.providers)
    ? widgetConfig.providers
    : Array.isArray(itemSelected?.providers)
      ? itemSelected.providers
      : [];
  const providerRequirements = getUserConfigurableProviders(declaredProviders);

  const selectedProviders = itemSelected.selectedProviders || {};

  function handleProviderChange(providerType, providerName) {
    const updatedItem = deepCopy(itemSelected);
    const nextProviders = { ...(updatedItem.selectedProviders || {}) };
    if (providerName) {
      nextProviders[providerType] = providerName;
    } else {
      delete nextProviders[providerType];
    }
    updatedItem.selectedProviders = nextProviders;

    const updatedWorkspace = deepCopy(workspaceSelected);
    updatedWorkspace.layout = replaceItemInLayout(
      updatedWorkspace.layout,
      updatedItem.id,
      updatedItem,
    );

    // Write through to layer 2 (workspace.selectedProviders[widgetId])
    // so the bulk-edit modal — which reads via resolveProviderName,
    // which falls back from layer 1 to layer 2 — sees the change. If
    // we only write layer 1, an unset here clears layer 1 but leaves
    // a stale layer-2 value, and the bulk modal renders the OLD
    // provider as still set (resolveProviderName falls through empty
    // layer 1 to find layer 2). Matches the canonical-key chain
    // `applyBulkProviderBindings` uses on the bulk path.
    const widgetId =
      updatedItem.uuidString || updatedItem.uuid || updatedItem.id;
    if (widgetId != null) {
      const wsKey = String(widgetId);
      const nextSelectedProviders = {
        ...(updatedWorkspace.selectedProviders || {}),
      };
      const prevForWidget = nextSelectedProviders[wsKey]
        ? { ...nextSelectedProviders[wsKey] }
        : {};
      if (providerName) {
        prevForWidget[providerType] = providerName;
      } else {
        delete prevForWidget[providerType];
      }
      if (Object.keys(prevForWidget).length === 0) {
        delete nextSelectedProviders[wsKey];
      } else {
        nextSelectedProviders[wsKey] = prevForWidget;
      }
      updatedWorkspace.selectedProviders = nextSelectedProviders;
    }

    setItemSelected(() => updatedItem);
    setWorkspaceSelected(() => updatedWorkspace);
    onUpdate(updatedItem, updatedWorkspace);
  }

  if (providerRequirements.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm opacity-60 text-center px-6">
        This widget doesn't declare any providers.
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
      <div className="text-sm opacity-70">
        Bind each required provider so the widget can connect to its data
        source. Changes save immediately.
      </div>

      <div className="space-y-3">
        {providerRequirements.map((req) => {
          const type = req.type;
          const current = selectedProviders[type] || "";
          const options = Object.entries(appProviders)
            .filter(([, p]) => p && p.type === type)
            .map(([name, p]) => ({ name, ...p }));
          const isConfigured = !!current;
          // Detect the global default for this type. If one exists,
          // the runtime resolution chain (widget → workspace → app
          // default → null, see useMcpProvider.js + providerResolution.js)
          // will use it even when no per-instance override is set —
          // so the user isn't actually missing anything.
          //
          // Without this fallback awareness the UI flagged every
          // widget with no per-instance pick as "REQUIRED" in red,
          // even though the widget worked fine at runtime via the
          // default. Three states now drive the styling instead of
          // two:
          //   - overridden: user explicitly picked a per-instance
          //     provider → neutral panel + "override" tag
          //   - using-default: per-instance empty but a global
          //     default exists → neutral panel + "using default
          //     <name>" hint
          //   - missing: per-instance empty AND no global default
          //     for this type → red panel + "REQUIRED" tag
          const defaultOption = options.find((o) => o.isDefaultForType);
          const isUsingDefault = !isConfigured && !!defaultOption;
          const isMissing = req.required && !isConfigured && !defaultOption;
          // resolvedName is what runtime will actually use — either
          // the per-instance override, or the global default if one
          // exists. Surfaced in the "using default" hint so the user
          // can see which provider is actually wired in without
          // opening Settings → Providers.
          const resolvedName = isConfigured
            ? current
            : isUsingDefault
              ? defaultOption.name
              : null;

          return (
            <div
              key={type}
              className={`rounded border px-3 py-2 ${
                isMissing
                  ? "bg-red-900 border-red-500"
                  : "bg-gray-800 border-gray-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-medium ${
                    isMissing ? "text-red-100" : "text-gray-100"
                  }`}
                >
                  {type}
                </span>
                <span
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${
                    isMissing
                      ? "bg-red-600 text-white"
                      : req.required
                        ? "bg-indigo-800 text-indigo-100"
                        : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {req.required ? "required" : "optional"}
                </span>
                {isUsingDefault && (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold bg-emerald-800 text-emerald-100"
                    title={`No per-widget override set — runtime resolves to the global default "${resolvedName}" (Settings → Providers).`}
                  >
                    using default
                  </span>
                )}
                {isConfigured && (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold bg-indigo-900 text-indigo-200"
                    title="A per-widget provider is set; overrides the global default."
                  >
                    override
                  </span>
                )}
              </div>
              {req.description && (
                <div className="text-xs opacity-60 mt-1">{req.description}</div>
              )}
              {isUsingDefault && (
                <div className="mt-1 text-[11px] text-emerald-300">
                  Using global default:{" "}
                  <span className="font-mono">{resolvedName}</span>. Pick a
                  specific provider below to override.
                </div>
              )}
              <div className="mt-2">
                <select
                  value={current}
                  onChange={(e) => handleProviderChange(type, e.target.value)}
                  className={`w-full bg-gray-900 border rounded px-2 py-1.5 text-sm ${
                    isMissing ? "border-red-500" : "border-gray-700"
                  }`}
                >
                  <option value="">
                    {isUsingDefault
                      ? `— use default (${resolvedName}) —`
                      : req.required
                        ? "— select a provider —"
                        : "— none —"}
                  </option>
                  {options.map((opt) => (
                    <option key={opt.name} value={opt.name}>
                      {opt.name}
                      {opt.isDefaultForType ? "  (default)" : ""}
                    </option>
                  ))}
                </select>
                {options.length === 0 && (
                  <div className="mt-1 text-[11px] text-amber-300">
                    No {type} providers configured. Add one in Settings &gt;
                    Providers.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PanelEditItemProviders;
