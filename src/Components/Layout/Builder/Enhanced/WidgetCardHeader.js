/**
 * WidgetCardHeader
 *
 * Enhanced card header for widgets in the layout builder.
 * Features:
 * - Widget name and icon
 * - Provider selectors (inline)
 * - Action buttons (configure, duplicate, delete)
 * - More menu (three-dot)
 */

import React, { useContext } from "react";
import {
  ActionMenu,
  FontAwesomeIcon,
  StatusBadge,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { WidgetIcon } from "./WidgetIcon";
import { ComponentManager } from "../../../../ComponentManager";
import { getUserConfigurableProviders } from "../../../../utils/providerUtils";
import { pickWidgetDisplayName } from "../../../../utils/widgetIdentity";
import { AppContext } from "../../../../Context";
import { cardFixPill } from "../../../Dashboard/widgetPanelText";
import { providerLabel } from "../../../Create/planChecklist";

// ComponentConfigModel's fallback `name` for a config that sets none.
const DEFAULT_CONFIG_NAME = "My Workspace";

// "ComposedWidget3" → "Composed Widget 3", "MCPServer" → "MCP Server".
const splitWords = (s) =>
  String(s)
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");

export const WidgetCardHeader = ({
  item, // Widget/component item
  widget, // Alias for item
  cellNumber = null, // Shown as label when no widget
  providers = [],
  selectedProviders = {},
  onProviderChange,
  onConfigure,
  onDelete, // Handler for delete
  onRemove, // Alias for onDelete
  onSplitHorizontal = null,
  onSplitVertical = null,
  onMoreOptions,
  onEditWithAI,
  // Move it to another cell without dragging (consolidation Phase 3P).
  onMove = null,
  // Why Change waits (unsaved edits) — the panel's rule, here too.
  changeBlocked = "",
  // Merge selection props
  isSelected = false,
  isSelectable = true,
  onToggleSelect = null,
}) => {
  // One overflow menu holds both provider pickers AND action items,
  // so the widget title always gets the full header width regardless
  // of cell size. Previous design kept provider badges + action
  // buttons inline (both flex-shrink-0) which cropped the title on
  // narrow cells and made the config button unreachable.

  // Support both 'item' and 'widget' props
  const widgetItem = item || widget;
  // Support both 'onDelete' and 'onRemove' props
  const handleDelete = onDelete || onRemove;

  // Get widget configuration from ComponentManager
  const widgetConfig = ComponentManager.config(
    widgetItem?.component,
    widgetItem,
  );

  // Detect missing widgets (component key exists but not in ComponentManager)
  const isWidgetMissing = widgetItem?.component && !widgetConfig;

  // Display name + scope.package.Component subtitle. Single source of
  // truth: `pickWidgetDisplayName` so the same widget shows the same
  // name in WidgetsTab, Listeners tab, Providers tab, and the layout
  // footer.
  // A widget config without its own `name` gets the model default "My
  // Workspace" — not the widget's name — so skip it and fall through to
  // the component name.
  // A bare component name ("ComposedWidget3") reads as words.
  const pickedName = pickWidgetDisplayName(
    widgetItem,
    widgetConfig && widgetConfig.name === DEFAULT_CONFIG_NAME
      ? { ...widgetConfig, name: null }
      : widgetConfig,
  );
  const componentTail =
    typeof widgetItem?.component === "string"
      ? widgetItem.component.split(".").pop()
      : "";
  const widgetName =
    pickedName && pickedName === componentTail
      ? splitWords(pickedName)
      : pickedName;

  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const status = useStatusTokens();

  // Show the full scoped registry id (`scope.package.Component`) as
  // the subtitle. The friendly title on line 1 may be a custom user
  // title that doesn't reveal which widget is mounted; the subtitle
  // pins down the underlying identity. Strict — the layout item is
  // the source of truth.
  const packageLabel = (() => {
    const scopedId = widgetItem?.component || widgetConfig?.id || "";
    if (typeof scopedId !== "string") return "";
    const parts = scopedId.split(".");
    return parts.length === 3 ? scopedId : "";
  })();

  // Get provider requirements from widget config (not from item directly)
  // Filter out providerClass: "api" so only user-configurable providers show badges
  const getProviderRequirements = () => {
    let providers = [];
    // Check config first (correct source)
    if (widgetConfig?.providers) {
      providers = Array.isArray(widgetConfig.providers)
        ? widgetConfig.providers
        : [];
    } else if (widgetItem?.providers) {
      // Fallback to item (legacy)
      providers = Array.isArray(widgetItem.providers)
        ? widgetItem.providers
        : [];
    }
    return getUserConfigurableProviders(providers);
  };

  const providerRequirements = getProviderRequirements();

  // App providers — needed to detect when a global default
  // (`isDefaultForType: true`) exists for a required provider type.
  // The runtime resolution chain in useMcpProvider / useWebSocketProvider
  // falls through to the default when no per-instance pick is set, so
  // the amber-dot indicator should respect that fallback: a widget
  // whose required type has a default ISN'T actually unresolved.
  // Without this, the dot fires on every widget the user hasn't
  // explicitly bound, even though the runtime is happy.
  const appCtx = useContext(AppContext);
  const appProviders = appCtx?.providers || {};

  // Check if a required provider has a resolved provider for it —
  // either a per-instance pick OR a global `isDefaultForType: true`
  // provider of the matching type. Mirrors the resolution chain in
  // `utils/providerResolution.js` so the indicator agrees with what
  // the runtime hook actually does.
  const isProviderResolved = (providerType) => {
    if (selectedProviders[providerType] != null) return true;
    // Walk appProviders looking for a default of this type.
    const entries =
      appProviders && typeof appProviders === "object"
        ? Object.values(appProviders)
        : [];
    return entries.some(
      (p) => p && p.type === providerType && p.isDefaultForType === true,
    );
  };

  // True when any required provider has neither a per-instance pick
  // nor a global default — drives the amber dot on the overflow
  // button + the "!" badge on the Providers menu item so the user
  // can see truly-unresolved state at a glance. Widgets relying on
  // a global default no longer trip this.
  const missingConnections = [
    ...new Set(
      providerRequirements
        .filter((req) => req.required && !isProviderResolved(req.type))
        .map((req) => req.type),
    ),
  ];
  const hasUnresolvedRequiredProvider = missingConnections.length > 0;

  // Listeners it has but nothing wired to them (moved up from the card's
  // footer, consolidation Phase 4c).
  const eventHandlers = widgetConfig?.eventHandlers || [];
  const listeners = widgetItem?.listeners || {};
  const unconnectedListeners = eventHandlers.filter(
    (h) => !listeners[h] || listeners[h].length === 0,
  ).length;
  // One pill for what's missing; it opens the panel at the fix.
  const fixPill = cardFixPill({
    missingConnections,
    unconnectedListeners,
    label: providerLabel,
  });

  // The ⋮ menu (consolidation Phase 3P): Edit in panel (every setting —
  // its connections and listeners too — is in the edit panel), one Change
  // (Create, where you pick AI or by hand), then Move, Split and Remove. No
  // dialogs. A "!" marks Edit in panel when a required connection isn't set,
  // and it then opens at Connections (Phase 4c).
  const menuItems = [];
  if (onConfigure) {
    menuItems.push({
      label: "Edit in panel",
      description: "Its settings, connections and listeners",
      badge: hasUnresolvedRequiredProvider ? "!" : null,
      onSelect: () =>
        onConfigure(
          widgetItem,
          hasUnresolvedRequiredProvider ? "providers" : "edit",
        ),
    });
  }
  // Built-in widgets ship with Dash: nothing to change.
  const builtIn =
    typeof widgetItem?.component === "string" &&
    widgetItem.component.startsWith("dash.");
  if (onEditWithAI && widgetItem && !builtIn) {
    menuItems.push({
      label: `Change ${widgetName || "this widget"}`,
      disabled: !!changeBlocked,
      description: changeBlocked || null,
      onSelect: () => onEditWithAI(widgetItem),
    });
  }
  const layoutActions = [
    ...(onMove
      ? [{ label: "Move to another cell", onSelect: () => onMove(widgetItem) }]
      : []),
    ...(onSplitHorizontal
      ? [{ label: "Split side by side", onSelect: () => onSplitHorizontal() }]
      : []),
    ...(onSplitVertical
      ? [{ label: "Split top and bottom", onSelect: () => onSplitVertical() }]
      : []),
  ];
  if (layoutActions.length) {
    if (menuItems.length) menuItems.push("separator");
    menuItems.push(...layoutActions);
  }
  if (onMoreOptions) {
    menuItems.push({
      label: "More options",
      onSelect: () => onMoreOptions(widget),
    });
  }
  if (handleDelete) {
    if (menuItems.length) menuItems.push("separator");
    menuItems.push({
      label: "Remove",
      danger: true,
      onSelect: () => handleDelete(widgetItem),
    });
  }

  // Theme tokens (light + dark). The header has no border or fill of its
  // own — it sits inside the cell's one frame (GridCellFrame); the merge
  // selection ring lives on the grid cell.
  const strong = currentTheme["text-neutral-light"] || "";
  const muted = currentTheme["text-neutral-medium"] || "";
  const hairline = currentTheme["border-neutral-dark"] || "";
  const accentBorder = currentTheme["border-primary-medium"] || "";

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {/* Cell selection checkbox */}
      {onToggleSelect && (
        <button
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
            isSelected
              ? `${currentTheme["bg-primary-medium"] || ""} ${accentBorder} ${
                  currentTheme["text-primary-very-light"] || ""
                }`
              : isSelectable
                ? `bg-transparent ${accentBorder} animate-pulse`
                : `bg-transparent ${hairline} opacity-30 cursor-not-allowed`
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (isSelected || isSelectable) {
              onToggleSelect();
            }
          }}
          title={
            isSelected
              ? "Deselect cell"
              : isSelectable
                ? "Select cell for merge"
                : "Not adjacent to selection"
          }
        >
          {isSelected && <FontAwesomeIcon icon="check" className="text-xs" />}
        </button>
      )}

      {/* Widget Icon & Name */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <WidgetIcon
          icon={isWidgetMissing ? "triangle-exclamation" : widgetConfig?.icon}
          className={`h-4 w-4 flex-shrink-0 ${
            isWidgetMissing ? status.warning.icon : muted
          }`}
        />
        <div className="flex flex-col min-w-0 leading-tight">
          <span className={`font-medium text-sm truncate ${strong}`}>
            {widgetName || cellNumber || "Empty"}
            {isWidgetMissing && (
              <span className={`font-normal ml-1 ${status.warning.icon}`}>
                (not found)
              </span>
            )}
          </span>
          {packageLabel && (
            <span
              className={`text-xs font-mono truncate ${muted}`}
              title={packageLabel}
            >
              {packageLabel}
            </span>
          )}
          {fixPill && onConfigure ? (
            <button
              type="button"
              data-testid="widget-fix-pill"
              onClick={(e) => {
                e.stopPropagation();
                onConfigure(widgetItem, fixPill.section);
              }}
              className="mt-1 self-start inline-flex rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2"
              title="Fix it in the panel"
            >
              <StatusBadge state="warning">
                <FontAwesomeIcon icon={fixPill.icon} className="h-3 w-3" />
                <span>{fixPill.text}</span>
              </StatusBadge>
            </button>
          ) : null}
        </div>
      </div>

      {/* One ⋮ for the whole header, so the title gets the full width; a
          warning dot marks a required connection that isn't set. */}
      {menuItems.length > 0 && (
        <ActionMenu
          label={`${widgetName || cellNumber || "Widget"} options`}
          icon="ellipsis-vertical"
          items={menuItems}
          dot={hasUnresolvedRequiredProvider}
          portal
          className="flex-shrink-0"
        />
      )}
    </div>
  );
};

export default WidgetCardHeader;
