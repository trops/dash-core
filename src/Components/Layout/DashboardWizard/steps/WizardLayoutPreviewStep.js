import React, { useEffect, useCallback, useRef, useState } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { layoutTemplates } from "../../LayoutManager/layoutTemplates";
import { widgetCountToTemplate } from "../../../../hooks/useWizardState";
import { resolveIcon } from "../../../../utils/resolveIcon";

/**
 * WizardLayoutPreviewStep
 *
 * Step 3 of the Dashboard Wizard. Two modes:
 *   - Custom path: auto-selects a layout template based on widget count,
 *     renders a visual grid with widget names in cells and drag-reorder.
 *   - Pre-built path: shows a read-only preview of the selected dashboard.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 */
export const WizardLayoutPreviewStep = ({ state, dispatch }) => {
  const isPrebuilt = state.path === "prebuilt";

  // Auto-select template and populate widget order on mount / widget change
  useEffect(() => {
    if (isPrebuilt) return;

    const templateKey = widgetCountToTemplate(state.selectedWidgets.length);
    const template = layoutTemplates.find((t) => t.id === templateKey);
    if (!template) return;

    // Only update if template changed or widget order is empty
    if (
      state.layout.templateKey !== templateKey ||
      state.layout.widgetOrder.length === 0
    ) {
      const widgetOrder = state.selectedWidgets.map((w) => w.name || w.key);
      dispatch({
        type: "SET_LAYOUT",
        payload: { templateKey, widgetOrder },
      });
    }
  }, [
    isPrebuilt,
    state.selectedWidgets,
    state.layout.templateKey,
    state.layout.widgetOrder.length,
    dispatch,
  ]);

  if (isPrebuilt) {
    return <PrebuiltPreview dashboard={state.selectedDashboard} />;
  }

  const template = layoutTemplates.find(
    (t) => t.id === state.layout.templateKey,
  );

  return (
    <div className="wizard-layout-step">
      <h3 className="wizard-step-header">Preview your layout</h3>
      <p className="wizard-step-description">
        Drag widgets to rearrange their placement in the grid.
      </p>
      {template ? (
        <LayoutGrid
          template={template}
          widgetOrder={state.layout.widgetOrder}
          widgets={state.selectedWidgets}
          dispatch={dispatch}
        />
      ) : (
        <div className="wizard-empty">
          <FontAwesomeIcon
            icon="grid-2"
            fixedWidth
            className="wizard-empty-icon"
          />
          <p>No layout template available.</p>
        </div>
      )}
    </div>
  );
};

// --- Pre-built dashboard preview ---

const PrebuiltPreview = ({ dashboard }) => {
  if (!dashboard) {
    return (
      <div className="wizard-layout-step">
        <h3 className="wizard-step-header">Dashboard preview</h3>
        <div className="wizard-empty">
          <FontAwesomeIcon
            icon="box-open"
            fixedWidth
            className="wizard-empty-icon"
          />
          <p>No dashboard selected.</p>
        </div>
      </div>
    );
  }

  const widgets = dashboard.widgets || [];

  return (
    <div className="wizard-layout-step">
      <h3 className="wizard-step-header">Dashboard preview</h3>
      <div className="wizard-prebuilt-preview">
        <div className="wizard-prebuilt-header">
          <FontAwesomeIcon
            icon={resolveIcon(dashboard.icon || "grid-2")}
            fixedWidth
            className="wizard-prebuilt-icon"
          />
          <span className="wizard-prebuilt-name">
            {dashboard.displayName || dashboard.name}
          </span>
        </div>
        {dashboard.description && (
          <p className="wizard-prebuilt-desc">{dashboard.description}</p>
        )}
        <div className="wizard-prebuilt-widgets">
          <span className="wizard-prebuilt-widgets-label">
            Includes {widgets.length} widget
            {widgets.length !== 1 ? "s" : ""}:
          </span>
          <ul className="wizard-prebuilt-widget-list">
            {widgets.map((w, i) => (
              <li key={w.name || i}>
                {w.icon && (
                  <FontAwesomeIcon
                    icon={resolveIcon(w.icon)}
                    fixedWidth
                    className="wizard-prebuilt-widget-icon"
                  />
                )}
                <span>{w.displayName || w.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

// --- Drag-reorder grid ---

const LayoutGrid = ({ template, widgetOrder, widgets, dispatch }) => {
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const dragRef = useRef(null);

  const totalCells = template.previewCells.length;

  // Build cell contents: widget names for filled cells, null for empty
  const cellContents = template.previewCells.map((_, i) => {
    const widgetId = widgetOrder[i] || null;
    if (!widgetId) return null;
    const widget = widgets.find((w) => (w.name || w.key) === widgetId);
    return widget || { name: widgetId };
  });

  const handleDragStart = useCallback((e, index) => {
    setDragIndex(index);
    dragRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e, dropIndex) => {
      e.preventDefault();
      const fromIndex = dragRef.current;
      setDragIndex(null);
      setDragOverIndex(null);
      dragRef.current = null;

      if (fromIndex === null || fromIndex === dropIndex) return;

      // Swap the two positions in widgetOrder
      const newOrder = [...widgetOrder];
      // Pad array to cover all cells
      while (newOrder.length < totalCells) {
        newOrder.push(null);
      }
      const temp = newOrder[fromIndex];
      newOrder[fromIndex] = newOrder[dropIndex];
      newOrder[dropIndex] = temp;

      // Trim trailing nulls
      while (newOrder.length > 0 && newOrder[newOrder.length - 1] === null) {
        newOrder.pop();
      }

      dispatch({ type: "REORDER_WIDGETS", payload: newOrder });
    },
    [widgetOrder, totalCells, dispatch],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragRef.current = null;
  }, []);

  return (
    <div
      className="wizard-layout-grid"
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${template.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${template.cols}, 1fr)`,
      }}
    >
      {template.previewCells.map((cell, i) => {
        const content = cellContents[i];
        const isDragging = dragIndex === i;
        const isDragOver = dragOverIndex === i;
        const hasWidget = content !== null;

        const cellStyle = {};
        if (cell.rowSpan) cellStyle.gridRow = `span ${cell.rowSpan}`;
        if (cell.colSpan) cellStyle.gridColumn = `span ${cell.colSpan}`;

        const classNames = [
          "wizard-layout-cell",
          hasWidget
            ? "wizard-layout-cell--filled"
            : "wizard-layout-cell--empty",
          isDragging ? "wizard-layout-cell--dragging" : "",
          isDragOver ? "wizard-layout-cell--drag-over" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={`${cell.row}-${cell.col}`}
            className={classNames}
            style={cellStyle}
            draggable={hasWidget}
            onDragStart={hasWidget ? (e) => handleDragStart(e, i) : undefined}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
          >
            {hasWidget ? (
              <div className="wizard-layout-cell-content">
                {content.icon && (
                  <FontAwesomeIcon
                    icon={resolveIcon(content.icon)}
                    fixedWidth
                    className="wizard-layout-cell-icon"
                  />
                )}
                <span className="wizard-layout-cell-name">
                  {content.displayName || content.name || content.key}
                </span>
                <FontAwesomeIcon
                  icon="grip-vertical"
                  className="wizard-layout-cell-grip"
                />
              </div>
            ) : (
              <div className="wizard-layout-cell-placeholder">
                <FontAwesomeIcon icon="plus" fixedWidth />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
