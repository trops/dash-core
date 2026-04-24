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

import React, { useState } from "react";
import {
  ButtonIcon2,
  DropdownPanel,
  FontAwesomeIcon,
  MenuItem2,
} from "@trops/dash-react";
import { WidgetIcon } from "./WidgetIcon";
import { ComponentManager } from "../../../../ComponentManager";
import { getUserConfigurableProviders } from "../../../../utils/providerUtils";

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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

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

  // Get widget name from config or item
  const widgetName =
    widgetConfig?.displayName ||
    widgetConfig?.name ||
    widgetItem?.name ||
    widgetItem?.component;

  // Build a scope/package subtitle so ambiguous component names like
  // `ProspectListColumn` (which might come from `@ai-built/…` or
  // `@trops/pipeline`) are disambiguated in the layout builder. Derives
  // from whatever identity the config / layout item carries:
  //   - widgetConfig.id:   e.g. "@ai-built/prospectlistcolumn.ProspectListColumn"
  //   - widgetConfig.package: e.g. "@ai-built/prospectlistcolumn"
  //   - widgetItem.workspace: fallback hint ("ai-built" / "@trops/pipeline")
  // Falls back to empty string so we can skip rendering if we have
  // nothing meaningful beyond the component name itself.
  const packageLabel = (() => {
    const dropTrailingComponent = (s) => {
      if (typeof s !== "string") return "";
      const lastDot = s.lastIndexOf(".");
      return lastDot > 0 ? s.slice(0, lastDot) : s;
    };
    const fromId = dropTrailingComponent(widgetConfig?.id || "");
    if (fromId) return fromId;
    if (widgetConfig?.package) return String(widgetConfig.package);
    const wsHint = widgetItem?.workspace;
    if (typeof wsHint === "string" && wsHint && wsHint !== "layout") {
      return wsHint.startsWith("@") ? wsHint : `@${wsHint}`;
    }
    return "";
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

  // Check if provider is configured — used only for the amber-dot
  // indicator now. Actual provider editing lives in the config
  // modal's Providers section (opened via the "Providers" menu item).
  const isProviderConfigured = (providerType) => {
    return selectedProviders[providerType] != null;
  };

  // True when any required provider lacks a selection — drives the
  // amber dot on the overflow button so the user can see unresolved
  // state at a glance without opening the menu.
  const hasUnresolvedRequiredProvider = providerRequirements.some(
    (req) => req.required && !isProviderConfigured(req.type),
  );

  // Build overflow actions list — single source of truth for the
  // dropdown items. Provider editing used to live inline in this
  // menu as dropdowns per provider; that's moved to the widget
  // config modal under a "Providers" section, so here we just show
  // a "Providers" entry (when the widget declares any) that opens
  // the modal pre-selected on that section.
  const overflowActions = [];
  if (onConfigure) {
    overflowActions.push({
      icon: "cog",
      label: "Configure",
      onClick: () => {
        onConfigure(widgetItem);
        setShowOverflowMenu(false);
      },
    });
  }
  if (onConfigure && providerRequirements.length > 0) {
    overflowActions.push({
      icon: "plug",
      label: "Providers",
      badge: hasUnresolvedRequiredProvider ? "!" : null,
      onClick: () => {
        onConfigure(widgetItem, "providers");
        setShowOverflowMenu(false);
      },
    });
  }
  if (onConfigure) {
    overflowActions.push({
      icon: "phone",
      label: "Listeners",
      onClick: () => {
        onConfigure(widgetItem, "handlers");
        setShowOverflowMenu(false);
      },
    });
  }
  if (onEditWithAI && widgetItem) {
    overflowActions.push({
      icon: "wand-magic-sparkles",
      label: "Edit with AI",
      onClick: () => {
        onEditWithAI(widgetItem);
        setShowOverflowMenu(false);
      },
    });
  }
  if (onSplitHorizontal) {
    overflowActions.push({
      icon: "arrows-left-right",
      label: "Split Horiz",
      onClick: () => {
        onSplitHorizontal();
        setShowOverflowMenu(false);
      },
    });
  }
  if (onSplitVertical) {
    overflowActions.push({
      icon: "arrows-up-down",
      label: "Split Vert",
      onClick: () => {
        onSplitVertical();
        setShowOverflowMenu(false);
      },
    });
  }
  if (handleDelete) {
    overflowActions.push({
      icon: "trash",
      label: "Remove",
      onClick: () => {
        handleDelete(widgetItem);
        setShowOverflowMenu(false);
      },
    });
  }
  if (onMoreOptions) {
    overflowActions.push({
      icon: "ellipsis-vertical",
      label: "More Options",
      onClick: () => {
        onMoreOptions(widget);
        setShowOverflowMenu(false);
      },
    });
  }

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 bg-transparent border-b border-gray-700 ${
        isSelected ? "ring-2 ring-blue-500 ring-inset" : ""
      }`}
    >
      {/* Cell selection checkbox */}
      {onToggleSelect && (
        <button
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
            isSelected
              ? "bg-blue-500 border-blue-500 text-white"
              : isSelectable
                ? "bg-gray-800/80 border-blue-400 animate-pulse"
                : "bg-gray-800/80 border-gray-500 opacity-30 cursor-not-allowed"
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
            isWidgetMissing ? "text-amber-500" : "text-white/60"
          }`}
        />
        <div className="flex flex-col min-w-0 leading-tight">
          <span className="font-medium text-sm text-gray-100 truncate">
            {widgetName || cellNumber || "Empty"}
            {isWidgetMissing && (
              <span className="text-amber-500/70 font-normal ml-1">
                (not found)
              </span>
            )}
          </span>
          {packageLabel && (
            <span
              className="text-[10px] text-gray-500 truncate"
              title={`${packageLabel} · ${widgetItem?.component || ""}`}
            >
              {packageLabel}
              {widgetItem?.component && widgetItem.component !== widgetName
                ? ` · ${widgetItem.component}`
                : ""}
            </span>
          )}
        </div>
      </div>

      {/* One overflow button for the whole header — providers +
          actions — so the widget title always gets full width.
          Amber dot indicates any unresolved required provider. */}
      {(providerRequirements.length > 0 ||
        overflowActions.length > 0 ||
        onMoreOptions) && (
        <div className="relative flex-shrink-0">
          <div className="relative inline-flex">
            <ButtonIcon2
              icon="ellipsis-vertical"
              onClick={() => setShowOverflowMenu((v) => !v)}
              title="Providers & actions"
              theme={false}
            />
            {hasUnresolvedRequiredProvider && (
              <span
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 border border-black pointer-events-none"
                title="Required provider not set"
              />
            )}
          </div>
          <DropdownPanel
            isOpen={showOverflowMenu}
            onClose={() => setShowOverflowMenu(false)}
            position="absolute top-full right-0 mt-1"
            portal={true}
            align="right"
          >
            {/* Every action opens the widget config modal or acts on
                the widget directly. Provider editing lives inside
                the config modal's Providers tab now, not inline
                here, so the menu stays short and the title has room. */}
            {overflowActions.map((action) => (
              <MenuItem2 key={action.label} onClick={action.onClick}>
                <FontAwesomeIcon
                  icon={action.icon}
                  className="w-4 text-center opacity-60"
                />
                <span className="flex-1">{action.label}</span>
                {action.badge && (
                  <span className="ml-auto text-[10px] font-bold text-amber-300">
                    {action.badge}
                  </span>
                )}
              </MenuItem2>
            ))}
          </DropdownPanel>
        </div>
      )}
    </div>
  );
};

export default WidgetCardHeader;
