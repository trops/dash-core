import React, { useEffect, useCallback, useRef, useState } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { layoutTemplates } from "../../LayoutManager/layoutTemplates";
import { widgetCountToTemplate } from "../../../../hooks/useWizardState";
import { resolveIcon } from "../../../../utils/resolveIcon";

/**
 * WizardLayoutPreviewStep
 *
 * Step 1 of the Dashboard Wizard. Two modes:
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
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-gray-200">
        Preview your layout
      </h3>
      <p className="text-sm text-gray-400">
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
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
          <FontAwesomeIcon icon="grid-2" fixedWidth />
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
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-gray-200">
          Dashboard preview
        </h3>
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
          <FontAwesomeIcon icon="box-open" fixedWidth />
          <p>No dashboard selected.</p>
        </div>
      </div>
    );
  }

  const widgets = dashboard.widgets || [];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-gray-200">Dashboard preview</h3>
      <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon
            icon={resolveIcon(dashboard.icon || "grid-2")}
            fixedWidth
            className="text-blue-400"
          />
          <span className="text-base font-semibold text-gray-200">
            {dashboard.displayName || dashboard.name}
          </span>
        </div>
        {dashboard.description && (
          <p className="text-sm text-gray-400">{dashboard.description}</p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Includes {widgets.length} widget
            {widgets.length !== 1 ? "s" : ""}:
          </span>
          <ul className="flex flex-col gap-1">
            {widgets.map((w, i) => (
              <li
                key={w.name || i}
                className="flex items-center gap-2 text-sm text-gray-300"
              >
                {w.icon && (
                  <FontAwesomeIcon
                    icon={resolveIcon(w.icon)}
                    fixedWidth
                    className="text-gray-500 text-xs"
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
      className="gap-3 p-4"
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

        const cellClasses = [
          "rounded-lg border transition-all flex items-center justify-center min-h-[60px]",
          hasWidget
            ? "border-gray-600 bg-gray-800/80 cursor-grab"
            : "border-dashed border-gray-700 bg-gray-800/30",
          isDragging ? "opacity-50 scale-95" : "",
          isDragOver ? "ring-2 ring-blue-400 border-blue-400" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={`${cell.row}-${cell.col}`}
            className={cellClasses}
            style={cellStyle}
            draggable={hasWidget}
            onDragStart={hasWidget ? (e) => handleDragStart(e, i) : undefined}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
          >
            {hasWidget ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300">
                {content.icon && (
                  <FontAwesomeIcon
                    icon={resolveIcon(content.icon)}
                    fixedWidth
                    className="text-gray-400 text-xs"
                  />
                )}
                <span className="truncate">
                  {content.displayName || content.name || content.key}
                </span>
                <FontAwesomeIcon
                  icon="grip-vertical"
                  className="text-gray-600 ml-auto"
                />
              </div>
            ) : (
              <div className="text-gray-600">
                <FontAwesomeIcon icon="plus" fixedWidth />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
