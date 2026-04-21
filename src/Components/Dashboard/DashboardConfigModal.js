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
import {
  getEmitters,
  getReceivers,
  getCurrentWiring,
  getOrphanedListeners,
  formatEventString,
} from "../../utils/listenerResolution";

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
 * @param {(componentName: string) => object | null} getWidgetConfig
 *                                      Called per widget instance. Returns the full ComponentManager
 *                                      entry (events, eventHandlers, displayName, …). Used by the
 *                                      Listeners tab to discover what each widget emits/handles.
 * @param {(changes: Array<{widgetId, providerType, providerName}>) => void} onSaveBindings
 *                                      Called with the staged provider changes on Save. The parent persists
 *                                      by forwarding to its existing `handleProviderSelect` /
 *                                      `saveWorkspace` plumbing.
 * @param {(changes: {adds: Array, removes: Array}) => void} onSaveListeners
 *                                      Called with the staged listener changes on Save. Each entry is
 *                                      `{ receiverItemId, handlerName, sourceComponent, sourceItemId, eventName }`.
 *                                      Parent uses `applyWiringChanges` + saveWorkspace.
 * @param {"providers"|"listeners"} initialTab  Which tab to focus when the modal opens.
 */
export const DashboardConfigModal = ({
  isOpen,
  setIsOpen,
  workspace,
  appProviders,
  getWidgetRequirements,
  getWidgetConfig = null,
  onSaveBindings,
  onSaveListeners,
  initialTab = "providers",
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  // Active tab. Defaults to whatever the parent requested via
  // `initialTab`. Resets on each open via the modal's mount cycle.
  const [activeTab, setActiveTab] = useState(initialTab);

  // Staged changes: widgetId -> { [providerType]: providerName }. Empty
  // until the user picks something; applied on Save via onSaveBindings.
  const [staged, setStaged] = useState({});

  // Staged listener changes — collected in the Listeners tab's UI and
  // committed alongside provider changes when the user clicks Save.
  // Shape: { adds: [...], removes: [...] } where each item is
  // { receiverItemId, handlerName, sourceComponent, sourceItemId, eventName, raw? }.
  const [stagedListeners, setStagedListeners] = useState({
    adds: [],
    removes: [],
  });

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

  // Listeners tab data — emitter list, receiver list, current wiring,
  // orphans. All recompute when the workspace or staged delta changes
  // so the UI reflects pending edits without saving first.
  const wConfig = useMemo(
    () => (typeof getWidgetConfig === "function" ? getWidgetConfig : () => null),
    [getWidgetConfig],
  );
  const emitters = useMemo(
    () => getEmitters(workspace, wConfig),
    [workspace, wConfig],
  );
  const receivers = useMemo(
    () => getReceivers(workspace, wConfig),
    [workspace, wConfig],
  );
  const persistedWiring = useMemo(
    () => getCurrentWiring(workspace),
    [workspace],
  );
  const effectiveWiring = useMemo(() => {
    // Apply staged removes/adds to the persisted wiring for an
    // accurate "what will be there after save" view.
    let next = persistedWiring;
    if (stagedListeners.removes.length > 0) {
      next = next.filter(
        (w) => !stagedListeners.removes.some((r) => sameWiringEntry(r, w)),
      );
    }
    if (stagedListeners.adds.length > 0) {
      // Append; avoid duplicates against current state.
      for (const a of stagedListeners.adds) {
        if (!next.some((w) => sameWiringEntry(w, a))) {
          next = [
            ...next,
            { ...a, raw: formatEventString(a.sourceComponent, a.sourceItemId, a.eventName) },
          ];
        }
      }
    }
    return next;
  }, [persistedWiring, stagedListeners]);
  const orphans = useMemo(
    () => getOrphanedListeners(workspace, wConfig),
    [workspace, wConfig],
  );
  // Orphans reduced by what the user has already staged for removal.
  const visibleOrphans = useMemo(
    () =>
      orphans.filter(
        (o) =>
          !stagedListeners.removes.some((r) => sameWiringEntry(r, o)),
      ),
    [orphans, stagedListeners.removes],
  );

  const hasStagedChanges =
    Object.keys(staged).some(
      (wid) => Object.keys(staged[wid] || {}).length > 0,
    ) ||
    stagedListeners.adds.length > 0 ||
    stagedListeners.removes.length > 0;

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

  // Listener tab staging helpers. We treat add/remove as queue
  // operations so the user can build up several edits before
  // committing. Toggling a binding that's already staged in the
  // opposite direction cancels the staged change rather than queuing
  // both — keeps the diff minimal and the save predictable.
  const stageListenerAdd = (entry) => {
    setStagedListeners((prev) => {
      const removeIdx = prev.removes.findIndex((r) =>
        sameWiringEntry(r, entry),
      );
      if (removeIdx >= 0) {
        return {
          adds: prev.adds,
          removes: prev.removes.filter((_, i) => i !== removeIdx),
        };
      }
      if (prev.adds.some((a) => sameWiringEntry(a, entry))) return prev;
      return { adds: [...prev.adds, entry], removes: prev.removes };
    });
  };
  const stageListenerRemove = (entry) => {
    setStagedListeners((prev) => {
      const addIdx = prev.adds.findIndex((a) => sameWiringEntry(a, entry));
      if (addIdx >= 0) {
        return {
          adds: prev.adds.filter((_, i) => i !== addIdx),
          removes: prev.removes,
        };
      }
      if (prev.removes.some((r) => sameWiringEntry(r, entry))) return prev;
      return { adds: prev.adds, removes: [...prev.removes, entry] };
    });
  };

  function handleSave() {
    // Provider changes
    const providerChanges = [];
    for (const [widgetId, byType] of Object.entries(staged)) {
      for (const [providerType, providerName] of Object.entries(byType)) {
        providerChanges.push({
          widgetId,
          providerType,
          providerName: providerName || null,
        });
      }
    }
    if (
      providerChanges.length > 0 &&
      typeof onSaveBindings === "function"
    ) {
      onSaveBindings(providerChanges);
    }

    // Listener changes
    if (
      (stagedListeners.adds.length > 0 ||
        stagedListeners.removes.length > 0) &&
      typeof onSaveListeners === "function"
    ) {
      onSaveListeners(stagedListeners);
    }

    setStaged({});
    setStagedListeners({ adds: [], removes: [] });
    setIsOpen(false);
  }

  function handleCancel() {
    setStaged({});
    setStagedListeners({ adds: [], removes: [] });
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

        {/* Tabs */}
        <div className="flex-shrink-0 flex flex-row items-center gap-2 px-4 pt-3 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("providers")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "providers"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Providers
            {unresolvedCount > 0 && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("listeners")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "listeners"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Listeners
            {visibleOrphans.length > 0 && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
            )}
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {activeTab === "listeners" ? (
            <ListenersTab
              emitters={emitters}
              receivers={receivers}
              wiring={effectiveWiring}
              orphans={visibleOrphans}
              onAdd={stageListenerAdd}
              onRemove={stageListenerRemove}
            />
          ) : (
            <>
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
            </>
          )}
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

// ─── Listeners tab ──────────────────────────────────────────────────────────

/**
 * Match two wiring entries on the four fields that uniquely identify
 * a listener binding (receiver + handler + source + event). Used to
 * dedupe stages, cancel opposite-direction stages, and detect "is
 * this binding already there".
 */
function sameWiringEntry(a, b) {
  if (!a || !b) return false;
  return (
    String(a.receiverItemId) === String(b.receiverItemId) &&
    a.handlerName === b.handlerName &&
    a.sourceComponent === b.sourceComponent &&
    String(a.sourceItemId) === String(b.sourceItemId) &&
    a.eventName === b.eventName
  );
}

const ORPHAN_REASON_LABEL = {
  "source-missing": "source widget no longer exists",
  "source-component-mismatch": "source id now belongs to a different widget",
  "event-not-emitted": "source widget no longer emits this event",
  "handler-not-declared": "receiver no longer declares this handler",
};

function ListenersTab({
  emitters,
  receivers,
  wiring,
  orphans,
  onAdd,
  onRemove,
}) {
  // Build a lookup so we can render receiver labels in the rows
  // without re-walking the workspace each render.
  const receiverById = useMemo(() => {
    const m = new Map();
    for (const r of receivers) m.set(String(r.itemId), r);
    return m;
  }, [receivers]);

  if (emitters.length === 0 && receivers.length === 0) {
    return (
      <div className="text-sm opacity-60 text-center py-6">
        No widgets in this dashboard emit or handle events.
      </div>
    );
  }

  return (
    <>
      {orphans.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon="triangle-exclamation"
              className="h-4 w-4 text-amber-300"
            />
            <span className="text-sm font-semibold text-amber-200">
              {orphans.length} orphaned listener
              {orphans.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => orphans.forEach(onRemove)}
              className="ml-auto text-xs text-amber-300 hover:text-amber-100"
            >
              Remove all
            </button>
          </div>
          <ul className="space-y-1 text-xs">
            {orphans.map((o, idx) => (
              <li
                key={`${o.receiverItemId}:${o.handlerName}:${o.raw}:${idx}`}
                className="flex items-center gap-2"
              >
                <code className="opacity-80">
                  {o.receiverComponent || "?"}.{o.handlerName}
                </code>
                <span className="opacity-50">←</span>
                <code className="opacity-60">{o.raw}</code>
                <span className="opacity-50">·</span>
                <span className="opacity-70">
                  {ORPHAN_REASON_LABEL[o.reason] || o.reason}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(o)}
                  className="ml-auto text-amber-300 hover:text-amber-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {emitters.length === 0 ? (
        <div className="text-sm opacity-60 text-center py-6">
          No widgets in this dashboard emit events. Add a widget that
          declares <code>events</code> in its config to wire up
          listeners.
        </div>
      ) : (
        emitters.map((e) => (
          <EmitterEventsRow
            key={e.itemId}
            emitter={e}
            wiring={wiring}
            receivers={receivers}
            receiverById={receiverById}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        ))
      )}
    </>
  );
}

function EmitterEventsRow({
  emitter,
  wiring,
  receivers,
  receiverById,
  onAdd,
  onRemove,
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
      <div className="text-sm font-semibold">
        {emitter.label}
        <span className="ml-2 text-xs opacity-50 font-normal">
          {emitter.component}
        </span>
      </div>
      {emitter.events.map((eventName) => {
        // Wiring entries listening to THIS specific (emitter, event)
        const listeningHere = wiring.filter(
          (w) =>
            String(w.sourceItemId) === String(emitter.itemId) &&
            w.eventName === eventName,
        );
        // Receivers eligible to be added: any with at least one
        // handler declaration. Self-loop allowed; the host runtime
        // doesn't enforce a same-component exclusion.
        const eligibleReceivers = receivers.filter(
          (r) => r.eventHandlers.length > 0,
        );
        return (
          <div
            key={eventName}
            className="pl-3 border-l border-white/10 space-y-2"
          >
            <div className="text-xs font-mono opacity-80">
              {eventName}
            </div>
            {listeningHere.length === 0 ? (
              <div className="text-xs opacity-50">No receivers wired</div>
            ) : (
              <ul className="space-y-1">
                {listeningHere.map((w) => {
                  const r = receiverById.get(String(w.receiverItemId));
                  return (
                    <li
                      key={`${w.receiverItemId}:${w.handlerName}:${w.raw}`}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="opacity-60">→</span>
                      <span>
                        {r?.label || w.receiverComponent || "?"}
                      </span>
                      <span className="opacity-50">·</span>
                      <code className="opacity-80">{w.handlerName}</code>
                      <button
                        type="button"
                        onClick={() => onRemove(w)}
                        className="ml-auto opacity-60 hover:opacity-100 text-red-300"
                        title="Remove listener"
                      >
                        <FontAwesomeIcon icon="xmark" className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {eligibleReceivers.length > 0 && (
              <AddReceiverPicker
                emitter={emitter}
                eventName={eventName}
                receivers={eligibleReceivers}
                onAdd={onAdd}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddReceiverPicker({ emitter, eventName, receivers, onAdd }) {
  const [open, setOpen] = useState(false);
  const [receiverId, setReceiverId] = useState("");
  const [handlerName, setHandlerName] = useState("");

  const selectedReceiver = useMemo(
    () => receivers.find((r) => String(r.itemId) === String(receiverId)) || null,
    [receivers, receiverId],
  );

  // Pre-select handler when receiver chosen — pick the one matching
  // event name if present, else first handler.
  const handlerOptions = selectedReceiver?.eventHandlers || [];
  const effectiveHandler =
    handlerName ||
    (handlerOptions.includes(eventName) ? eventName : handlerOptions[0] || "");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
      >
        <FontAwesomeIcon icon="plus" className="h-3 w-3" />
        Add receiver
      </button>
    );
  }

  function commit() {
    if (!selectedReceiver || !effectiveHandler) return;
    onAdd({
      receiverItemId: selectedReceiver.itemId,
      receiverComponent: selectedReceiver.component,
      handlerName: effectiveHandler,
      sourceComponent: emitter.component,
      sourceItemId: emitter.itemId,
      eventName,
    });
    setOpen(false);
    setReceiverId("");
    setHandlerName("");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={receiverId}
        onChange={(e) => {
          setReceiverId(e.target.value);
          setHandlerName("");
        }}
        className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs"
      >
        <option value="">— Receiver —</option>
        {receivers.map((r) => (
          <option key={r.itemId} value={r.itemId}>
            {r.label}
          </option>
        ))}
      </select>
      <select
        value={effectiveHandler}
        onChange={(e) => setHandlerName(e.target.value)}
        disabled={!selectedReceiver}
        className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs disabled:opacity-40"
      >
        <option value="">— Handler —</option>
        {handlerOptions.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={commit}
        disabled={!selectedReceiver || !effectiveHandler}
        className="px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setReceiverId("");
          setHandlerName("");
        }}
        className="text-xs opacity-60 hover:opacity-100"
      >
        Cancel
      </button>
    </div>
  );
}
