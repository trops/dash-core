/**
 * WidgetCard
 *
 * Wrapper component for widgets that provides:
 * - Header with drag handle, provider controls, actions (edit mode only)
 * - Body with padding around widget content (edit mode only)
 * - Footer for future features (edit mode only)
 *
 * In preview mode (preview === true):
 * - Only renders the widget content without any wrapper
 *
 * In edit mode (preview === false):
 * - Renders header + padded content + optional footer
 */

import React from "react";
import { WidgetCardHeader } from "./WidgetCardHeader";
import { WidgetCardStatusBar } from "./WidgetCardStatusBar";
import { ComponentManager } from "../../../../ComponentManager";
import { FontAwesomeIcon, StatusBadge, ThemeContext } from "@trops/dash-react";

/**
 * WidgetCard - Main component with Header/Body/Footer subcomponents
 *
 * Usage:
 * <WidgetCard preview={preview}>
 *   <WidgetCard.Header item={item} providers={providers} ... />
 *   <WidgetCard.Body>{widgetContent}</WidgetCard.Body>
 *   <WidgetCard.Footer>{footerContent}</WidgetCard.Footer>
 * </WidgetCard>
 */

// Create context to pass preview prop to subcomponents
const WidgetCardContext = React.createContext({ preview: false });

/**
 * WidgetCard.Header - Header section with controls
 * Only renders in edit mode (preview === false)
 */
const WidgetCardHeader_Component = ({
  item,
  cellNumber = null,
  providers = [],
  selectedProviders = {},
  onProviderChange,
  onConfigure,
  onDelete,
  onSplitHorizontal = null,
  onSplitVertical = null,
  onEditWithAI,
  // Merge selection props
  isSelected = false,
  isSelectable = true,
  onToggleSelect = null,
}) => {
  const { preview } = React.useContext(WidgetCardContext);

  // Don't render header in preview mode
  if (preview === true) {
    return null;
  }

  return (
    <WidgetCardHeader
      item={item}
      cellNumber={cellNumber}
      providers={providers}
      selectedProviders={selectedProviders}
      onProviderChange={onProviderChange}
      onConfigure={onConfigure}
      onDelete={onDelete}
      onSplitHorizontal={onSplitHorizontal}
      onSplitVertical={onSplitVertical}
      onEditWithAI={onEditWithAI}
      isSelected={isSelected}
      isSelectable={isSelectable}
      onToggleSelect={onToggleSelect}
    />
  );
};

/**
 * WidgetCard.Body - Body section with widget content
 * In edit mode: adds padding around content
 * In preview mode: renders content without padding
 */
const WidgetCardBody = ({ children, padding = "p-2", className = "" }) => {
  const { preview } = React.useContext(WidgetCardContext);

  // In preview mode, render children without padding wrapper
  if (preview === true) {
    return <>{children}</>;
  }

  // In edit mode, render with padding
  return (
    <div className={`flex-1 min-h-0 overflow-auto ${padding} ${className}`}>
      {children}
    </div>
  );
};

/**
 * WidgetCard.Footer - Footer section with handler warnings
 * Only renders in edit mode (preview === false)
 * Shows amber warning when widget has eventHandlers that lack listener connections
 */
const WidgetCardFooter = ({
  children,
  item = null,
  onConfigure = null,
  className = "",
}) => {
  const { preview } = React.useContext(WidgetCardContext);
  if (preview === true) return null;

  // Compute unconfigured handlers
  const widgetConfig = item?.component
    ? ComponentManager.config(item.component, item)
    : null;
  const eventHandlers = widgetConfig?.eventHandlers || [];
  const listeners = item?.listeners || {};
  const unconfiguredCount = eventHandlers.filter(
    (h) => !listeners[h] || listeners[h].length === 0,
  ).length;

  // Don't render if no children AND no warnings
  if (!children && unconfiguredCount === 0) return null;

  // No border or fill of its own — it sits inside the cell's one frame
  // (GridCellFrame). The warning is a dash-react StatusBadge, so it reads
  // in light and dark themes alike.
  return (
    <div className={`px-3 pb-2 pt-1 ${className}`}>
      {children}
      {unconfiguredCount > 0 && (
        <button
          type="button"
          onClick={() => onConfigure && onConfigure(item, "handlers")}
          className="inline-flex rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2"
          title="Click to configure listeners"
        >
          <StatusBadge state="warning">
            <FontAwesomeIcon icon="tower-broadcast" className="h-3 w-3" />
            <span>
              {unconfiguredCount} listener
              {unconfiguredCount > 1 ? "s" : ""} not connected
            </span>
          </StatusBadge>
        </button>
      )}
    </div>
  );
};

/**
 * WidgetCard - Main wrapper component
 *
 * In preview mode: renders children without any wrapper
 * In edit mode: wraps children in a container
 */
export const WidgetCard = ({
  preview = false,
  children,
  className = "",
  // Edit mode: the selected empty cell (phase 1d) — a solid blue border.
  highlighted = false,
}) => {
  const { currentTheme = {} } = React.useContext(ThemeContext) || {};
  // In preview mode, render children without wrapper
  if (preview === true) {
    return (
      <WidgetCardContext.Provider value={{ preview }}>
        {children}
      </WidgetCardContext.Provider>
    );
  }

  // In edit mode, render with wrapper (no padding - Body handles padding).
  // Empty / not-found cells: a dashed hairline in the theme's neutral
  // border; the selected empty cell gets the theme's primary border.
  const border = highlighted
    ? `border-2 ${currentTheme["border-primary-medium"] || ""}`
    : `border border-dashed ${currentTheme["border-neutral-dark"] || ""}`;
  return (
    <WidgetCardContext.Provider value={{ preview }}>
      <div
        className={`flex flex-col w-full h-full min-h-0 overflow-hidden rounded-lg ${border} ${className}`}
      >
        {children}
      </div>
    </WidgetCardContext.Provider>
  );
};

// Attach subcomponents
WidgetCard.Header = WidgetCardHeader_Component;
WidgetCard.Body = WidgetCardBody;
WidgetCard.Footer = WidgetCardFooter;
WidgetCard.StatusBar = WidgetCardStatusBar;

export default WidgetCard;
