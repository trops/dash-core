import React, { memo, useState, useContext, useRef, useEffect } from "react";
import { useDrag, useDrop, DndContext } from "react-dnd";

// Identifies which "bucket" of the workspace a LayoutBuilder belongs
// to so drop handlers on grid cells can distinguish a same-container
// swap from a cross-container move (sidebar ↔ main dashboard). Wrap
// the sidebar's LayoutBuilder with value "sidebar"; everything else
// defaults to "main".
export const WorkspaceScopeContext = React.createContext("main");
import {
  DropComponent,
  DragComponent,
  ConfirmationModal,
  FontAwesomeIcon,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { LayoutContainer } from "../../../Components/Layout";
import { GridCellFrame } from "./GridCellFrame";
import { pickWidgetDisplayName } from "../../../utils/widgetIdentity";
import { EditSelectionContext } from "../../Dashboard/editSelection";
import { AppContext } from "../../../Context/App/AppContext";

import { WidgetCard } from "./Enhanced/WidgetCard";
import { renderComponent } from "../../../utils/layout";
import { ComponentManager } from "../../../ComponentManager";
import { WidgetNotFound } from "../../../Widget/WidgetNotFound";
import { isContainer, isWorkspace } from "../../../utils/layout";
import {
  GRID_CELL_WIDGET_TYPE,
  SIDEBAR_WIDGET_TYPE,
} from "../../../utils/dragTypes";

import { MergeCellsModal } from "./Modal";

/**
 * The body around an occupied cell's widget, in BOTH view and edit mode
 * (create-entry phase 1c) — one component type, so the widget stays mounted
 * across modes. `enabled` (edit mode) turns on drag/drop and the padded,
 * scrollable box; disabled (view mode) it's layout-neutral
 * (display: contents) so view-mode layout is unchanged.
 *
 * Grids rendered without a drag-and-drop provider (some previews) get a plain
 * body — the drag/drop hooks would throw without one.
 */
// Configure sections the edit panel shows inline (CRE-006 AC5); others
// (notifications, schedule) still open the Configure dialog.
const opensInPanel = (section) =>
  !section || ["edit", "handlers", "providers", "code"].includes(section);

const DraggableDroppableCellBody = (props) => {
  const dnd = useContext(DndContext);
  return dnd && dnd.dragDropManager ? (
    <DndCellBody {...props} />
  ) : (
    <PlainCellBody {...props} />
  );
};

const PlainCellBody = ({ enabled = true, padding = "", children }) =>
  enabled ? (
    <div className={`flex-1 min-h-0 overflow-auto relative ${padding}`}>
      {children}
    </div>
  ) : (
    <div style={{ display: "contents" }}>{children}</div>
  );

const DndCellBody = ({
  enabled = true,
  cellNumber,
  gridContainerId,
  onMoveWidgetToCell,
  onDropWidgetFromSidebar,
  hasSpan,
  children,
  padding,
}) => {
  const workspaceScope = useContext(WorkspaceScopeContext);
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: GRID_CELL_WIDGET_TYPE,
      item: { cellNumber, gridContainerId, hasSpan, workspaceScope },
      canDrag: () => enabled,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [cellNumber, gridContainerId, hasSpan, workspaceScope, enabled],
  );

  const [{ isOver, canDrop, itemType }, drop] = useDrop(
    () => ({
      accept: [GRID_CELL_WIDGET_TYPE, SIDEBAR_WIDGET_TYPE],
      canDrop: (dragItem, monitor) => {
        if (!enabled) return false;
        const itemType = monitor.getItemType();
        if (itemType === SIDEBAR_WIDGET_TYPE) return true;
        // Allow cross-scope drops (sidebar ↔ main dashboard). Same-scope
        // drops keep the old constraints: no self-drop, no span cells.
        if ((dragItem.workspaceScope || "main") !== workspaceScope) {
          if (dragItem.hasSpan || hasSpan) return false;
          return true;
        }
        if (dragItem.gridContainerId !== gridContainerId) return false;
        if (dragItem.cellNumber === cellNumber) return false;
        if (dragItem.hasSpan || hasSpan) return false;
        return true;
      },
      drop: (dragItem, monitor) => {
        const itemType = monitor.getItemType();
        if (itemType === SIDEBAR_WIDGET_TYPE) {
          if (onDropWidgetFromSidebar)
            onDropWidgetFromSidebar(
              gridContainerId,
              cellNumber,
              dragItem.widgetKey,
            );
          return;
        }
        // Cross-scope drop (sidebar ↔ main): can't handle here because
        // a LayoutBuilder only sees one bucket of the workspace. Emit
        // a window event so something up the tree (DashboardStage)
        // can mutate the FULL workspace + save atomically.
        if ((dragItem.workspaceScope || "main") !== workspaceScope) {
          window.dispatchEvent(
            new CustomEvent("dash:cross-container-widget-move", {
              detail: {
                sourceScope: dragItem.workspaceScope || "main",
                sourceGridContainerId: dragItem.gridContainerId,
                sourceCellNumber: dragItem.cellNumber,
                targetScope: workspaceScope,
                targetGridContainerId: gridContainerId,
                targetCellNumber: cellNumber,
              },
            }),
          );
          return;
        }
        if (onMoveWidgetToCell)
          onMoveWidgetToCell(gridContainerId, dragItem.cellNumber, cellNumber);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
        itemType: monitor.getItemType(),
      }),
    }),
    [
      cellNumber,
      gridContainerId,
      onMoveWidgetToCell,
      onDropWidgetFromSidebar,
      hasSpan,
      workspaceScope,
      enabled,
    ],
  );

  const isSidebarDrop = itemType === SIDEBAR_WIDGET_TYPE;

  if (!enabled) {
    return (
      <div ref={(node) => drag(drop(node))} style={{ display: "contents" }}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={`flex-1 min-h-0 overflow-auto relative ${padding} ${
        isDragging ? "opacity-30" : ""
      } ${isOver && canDrop ? (isSidebarDrop ? "ring-2 ring-green-500 ring-inset" : "ring-2 ring-blue-500 ring-inset") : ""}`}
      style={{ cursor: "grab" }}
    >
      {children}
      {isOver && canDrop && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${isSidebarDrop ? "bg-green-600/30" : "bg-blue-600/30"} rounded pointer-events-none`}
        >
          <span
            className={`text-sm font-bold ${isSidebarDrop ? "text-green-200" : "text-blue-200"}`}
          >
            {isSidebarDrop ? "Drop here" : "Swap"}
          </span>
        </div>
      )}
    </div>
  );
};

const DroppableEmptyCell = ({
  cellNumber,
  gridContainerId,
  onMoveWidgetToCell,
  onDropWidgetFromSidebar,
  children,
}) => {
  const workspaceScope = useContext(WorkspaceScopeContext);
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: [GRID_CELL_WIDGET_TYPE, SIDEBAR_WIDGET_TYPE],
      canDrop: (dragItem, monitor) => {
        const itemType = monitor.getItemType();
        if (itemType === SIDEBAR_WIDGET_TYPE) return true;
        // Cross-scope drop onto an empty cell is always allowed.
        if ((dragItem.workspaceScope || "main") !== workspaceScope) return true;
        return (
          dragItem.cellNumber !== cellNumber &&
          dragItem.gridContainerId === gridContainerId
        );
      },
      drop: (dragItem, monitor) => {
        const itemType = monitor.getItemType();
        if (itemType === SIDEBAR_WIDGET_TYPE) {
          if (onDropWidgetFromSidebar)
            onDropWidgetFromSidebar(
              gridContainerId,
              cellNumber,
              dragItem.widgetKey,
            );
          return;
        }
        if ((dragItem.workspaceScope || "main") !== workspaceScope) {
          window.dispatchEvent(
            new CustomEvent("dash:cross-container-widget-move", {
              detail: {
                sourceScope: dragItem.workspaceScope || "main",
                sourceGridContainerId: dragItem.gridContainerId,
                sourceCellNumber: dragItem.cellNumber,
                targetScope: workspaceScope,
                targetGridContainerId: gridContainerId,
                targetCellNumber: cellNumber,
              },
            }),
          );
          return;
        }
        if (onMoveWidgetToCell)
          onMoveWidgetToCell(gridContainerId, dragItem.cellNumber, cellNumber);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [
      cellNumber,
      gridContainerId,
      onMoveWidgetToCell,
      onDropWidgetFromSidebar,
      workspaceScope,
    ],
  );

  return (
    <div
      ref={drop}
      className={`flex-1 min-h-0 relative flex flex-col ${
        isOver && canDrop
          ? "ring-2 ring-green-500 ring-inset bg-green-900/20"
          : ""
      }`}
    >
      {children}
      {isOver && canDrop && (
        <div className="absolute inset-0 flex items-center justify-center bg-green-600/30 rounded pointer-events-none">
          <span className="text-sm font-bold text-green-200">Drop here</span>
        </div>
      )}
    </div>
  );
};

export const LayoutGridContainer = memo(
  ({
    item,
    workspace,
    preview = false,
    id,
    parent,
    scrollable,
    space,
    grow,
    order,
    children = null,
    onClickAdd,
    onClickQuickAdd,
    onClickRemove,
    onChangeDirection,
    onChangeOrder,
    onClickExpand,
    onClickShrink,
    onOpenConfig,
    onOpenEvents,
    onProviderSelect = null,
    onCreateProvider = null,
    width,
    height = "h-full",
    direction,
    onDropItem,
    onDragItem,
    editMode,
    uuid,
    layout,
    component,
    isDraggable,
    // Grid operation handlers
    onSplitCell = null,
    onMergeCells = null,
    onAddGridRow = null,
    onDeleteGridRow = null,
    onAddGridColumn = null,
    onDeleteGridColumn = null,
    onChangeRowHeight = null,
    onChangeRowMode = null,
    onChangeRowSizing = null,
    onChangeColMode = null,
    onMoveWidgetToCell = null,
    onDropWidgetFromSidebar = null,
    onWidgetPopout = null,
  }) => {
    // Select-to-edit (phase 1c): the editor's current selection.
    const editSelection = useContext(EditSelectionContext);
    const workspaceScope = useContext(WorkspaceScopeContext);

    // Edit-mode chrome (grid controls, empty cells) reads theme tokens so it
    // follows light and dark themes — no fixed palette classes.
    const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
    const status = useStatusTokens();
    const tokens = {
      muted: currentTheme["text-neutral-medium"] || "",
      strong: currentTheme["text-neutral-light"] || "",
      hairline: currentTheme["border-neutral-dark"] || "",
      surface: currentTheme["bg-neutral-very-dark"] || "",
      activeBg: currentTheme["bg-neutral-dark"] || "",
      hoverBg: currentTheme["hover-bg-neutral-very-dark"] || "",
      hoverText: currentTheme["hover-text-neutral-light"] || "",
    };
    // Row / column controls: 28px hit areas, 12px labels, muted until hovered.
    const gridCtrl = `h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md text-xs transition-colors ${tokens.muted} ${tokens.hoverBg} ${tokens.hoverText}`;
    const gridCtrlDelete = `h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md text-xs transition-colors ${tokens.muted} ${status.error.hoverBg} ${status.error.hoverText}`;

    // Phase 1e: a widget being moved without dragging (Move… in the panel).
    // Another cell of the same grid becomes a target: empty takes it, full
    // swaps (DashboardModel.moveWidgetToCell swaps).
    const moving =
      editSelection.selection?.kind === "widget" &&
      editSelection.selection.moving &&
      editSelection.selection.gridItemId === item.id &&
      (editSelection.selection.scope || "main") === workspaceScope
        ? editSelection.selection
        : null;
    const moveTarget = (cellNumber) =>
      moving && moving.cellNumber !== cellNumber && onMoveWidgetToCell
        ? () => {
            onMoveWidgetToCell(item.id, moving.cellNumber, cellNumber);
            editSelection.select({ ...moving, cellNumber, moving: false });
          }
        : null;

    // Get providers from AppContext (not DashboardContext, which has a structural
    // issue where providers from AppWrapper don't flow through DashboardWrapper)
    const appCtx = useContext(AppContext);
    const providersObj = appCtx?.providers || {};

    // Convert providers object to array format expected by WidgetCardHeader
    // Providers from context are stored as: { "provider-name": { name, type, credentials, ... }, ... }
    const availableProviders =
      providersObj && typeof providersObj === "object"
        ? Object.entries(providersObj).map(([id, provider]) => ({
            id,
            ...provider,
          }))
        : [];

    // Grid Detection: Check if this item has grid layout configuration
    const hasGrid = item?.grid && item.grid.rows && item.grid.cols;
    const useGridLayout =
      hasGrid && (item.type === "grid" || item.grid !== null);

    // Gutter layout constants (match main grid's p-4 and gap-5)
    const GUTTER_WIDTH = 40; // px — width of the left row gutter
    const GUTTER_HEIGHT = 36; // px — height of the top column gutter
    const GRID_PAD = 16; // px — matches p-4 (1rem)
    const GRID_GAP = 20; // px — matches gap-5 (1.25rem)

    // Compute row template tracks respecting rowModes and rowHeights
    function getRowTemplate(grid) {
      const unit = grid.rowUnit || 300;
      const heights = grid.rowHeights || {};
      const modes = grid.rowModes || {};
      const tracks = [];
      for (let r = 1; r <= grid.rows; r++) {
        const mode = modes[String(r)] || "fixed";
        switch (mode) {
          case "shrink":
            tracks.push("auto");
            break;
          case "grow":
            tracks.push("minmax(0, 1fr)");
            break;
          default: {
            const mult = heights[String(r)] || 1;
            tracks.push(`${unit * mult}px`);
            break;
          }
        }
      }
      return tracks.join(" ");
    }

    // Check if any row has an explicit mode set
    function hasExplicitRowModes() {
      if (!hasGrid) return false;
      const modes = item.grid.rowModes;
      return modes && Object.keys(modes).length > 0;
    }

    // Get the current multiplier for a row
    function getRowMultiplier(row) {
      if (!hasGrid) return 1;
      return item.grid.rowHeights?.[String(row)] || 1;
    }

    // Get the current mode for a row
    function getRowMode(row) {
      if (!hasGrid) return "fixed";
      return item.grid.rowModes?.[String(row)] || "fixed";
    }

    // Unified cycle: shrink → grow → fixed 1x → fixed 2x → fixed 3x → shrink
    function handleCycleRowSizing(row) {
      const mode = getRowMode(row);
      const mult = getRowMultiplier(row);

      if (onChangeRowSizing) {
        if (mode === "shrink") {
          onChangeRowSizing(id, row, "grow");
        } else if (mode === "grow") {
          onChangeRowSizing(id, row, "fixed", 1);
        } else {
          if (mult >= 3) {
            onChangeRowSizing(id, row, "shrink");
          } else {
            onChangeRowSizing(id, row, "fixed", mult + 1);
          }
        }
      }
    }

    // Get display label and color for current row sizing
    function getRowSizingDisplay(row) {
      // The default (1x) is muted; any other sizing reads strong.
      const mode = getRowMode(row);
      if (mode === "shrink") return { label: "S", changed: true };
      if (mode === "grow") return { label: "G", changed: true };
      const mult = getRowMultiplier(row);
      return { label: `${mult}x`, changed: mult > 1 };
    }

    // Compute column template tracks respecting colModes
    function getColTemplate(grid) {
      const modes = grid.colModes || {};
      const tracks = [];
      for (let c = 1; c <= grid.cols; c++) {
        const mode = modes[String(c)] || "grow";
        switch (mode) {
          case "shrink":
            tracks.push("auto");
            break;
          case "1/4":
            tracks.push("25%");
            break;
          case "1/3":
            tracks.push("33.333%");
            break;
          case "1/2":
            tracks.push("50%");
            break;
          case "2/3":
            tracks.push("66.667%");
            break;
          default:
            tracks.push("minmax(0, 1fr)");
            break;
        }
      }
      return tracks.join(" ");
    }

    function hasExplicitColModes() {
      if (!hasGrid) return false;
      const modes = item.grid.colModes;
      return modes && Object.keys(modes).length > 0;
    }

    function getColMode(col) {
      if (!hasGrid) return "grow";
      return item.grid.colModes?.[String(col)] || "grow";
    }

    function getColSizingDisplay(col) {
      // The default (grow) is muted; any other sizing reads strong.
      const mode = getColMode(col);
      if (mode === "shrink") return { label: "S", changed: true };
      if (["1/4", "1/3", "1/2", "2/3"].includes(mode))
        return { label: mode, changed: true };
      return { label: "G", changed: false };
    }

    // Sizing popover state
    const [sizingPopover, setSizingPopover] = useState(null); // { type: "row"|"col", index: number }
    const popoverRef = useRef(null);
    const popoverTriggerRef = useRef(null);

    useEffect(() => {
      if (!sizingPopover) return;
      function handleClickOutside(e) {
        if (
          popoverRef.current &&
          !popoverRef.current.contains(e.target) &&
          popoverTriggerRef.current &&
          !popoverTriggerRef.current.contains(e.target)
        ) {
          setSizingPopover(null);
        }
      }
      function handleEscape(e) {
        if (e.key === "Escape") setSizingPopover(null);
      }
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [sizingPopover]);

    const ROW_OPTIONS = [
      { mode: "shrink", label: "S" },
      { mode: "grow", label: "G" },
      { mode: "fixed-1", label: "1x" },
      { mode: "fixed-2", label: "2x" },
      { mode: "fixed-3", label: "3x" },
    ];

    const COL_OPTIONS = [
      { mode: "grow", label: "G" },
      { mode: "shrink", label: "S" },
      { mode: "1/4", label: "1/4" },
      { mode: "1/3", label: "1/3" },
      { mode: "1/2", label: "1/2" },
      { mode: "2/3", label: "2/3" },
    ];

    function getActiveRowOption(row) {
      const mode = getRowMode(row);
      const mult = getRowMultiplier(row);
      if (mode === "shrink") return "shrink";
      if (mode === "grow") return "grow";
      return `fixed-${mult}`;
    }

    function handleRowOptionSelect(row, optionMode) {
      if (onChangeRowSizing) {
        if (optionMode === "shrink" || optionMode === "grow") {
          onChangeRowSizing(id, row, optionMode);
        } else if (optionMode.startsWith("fixed-")) {
          const mult = Number(optionMode.split("-")[1]);
          onChangeRowSizing(id, row, "fixed", mult);
        }
      }
    }

    function handleColOptionSelect(col, optionMode) {
      if (onChangeColMode) onChangeColMode(id, col, optionMode);
    }

    function renderSizingPopover(type, index, triggerEl) {
      if (
        !sizingPopover ||
        sizingPopover.type !== type ||
        sizingPopover.index !== index
      )
        return null;

      const options = type === "row" ? ROW_OPTIONS : COL_OPTIONS;
      const activeMode =
        type === "row" ? getActiveRowOption(index) : getColMode(index);
      const isRow = type === "row";

      return (
        <div
          ref={popoverRef}
          className={`absolute z-50 border rounded-lg shadow-xl p-1 flex flex-row gap-0.5 ${tokens.surface} ${tokens.hairline}`}
          style={
            isRow
              ? {
                  left: "100%",
                  top: "50%",
                  transform: "translateY(-50%)",
                  marginLeft: 4,
                }
              : {
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  marginTop: 4,
                }
          }
        >
          {options.map((opt) => {
            const isActive = opt.mode === activeMode;
            return (
              <button
                key={opt.mode}
                aria-pressed={isActive}
                className={`h-7 px-2 rounded-md text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? `${tokens.strong} ${tokens.activeBg}`
                    : `${tokens.muted} ${tokens.hoverBg} ${tokens.hoverText}`
                }`}
                onClick={() => {
                  if (type === "row") handleRowOptionSelect(index, opt.mode);
                  else handleColOptionSelect(index, opt.mode);
                }}
                title={opt.label}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }

    // Modal state for grid operations
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [selectedCellsForMerge, setSelectedCellsForMerge] = useState([]);
    const [contextMenuCell, setContextMenuCell] = useState(null);
    const [contextMenuPosition, setContextMenuPosition] = useState({
      x: 0,
      y: 0,
    });

    // Grid operation handlers
    function handleInstantSplit(cellNumber, direction) {
      if (onSplitCell) {
        onSplitCell({
          cellNumber,
          direction, // "horizontal" or "vertical"
          count: 2,
          gridContainer: item,
        });
      }
    }

    // Given a hidden cell's position, find the visible cell whose span covers it
    function findSpanOwner(grid, row, col) {
      for (let r = row; r >= 1; r--) {
        for (let c = col; c >= 1; c--) {
          const cell = grid[`${r}.${c}`];
          if (cell && cell.span) {
            const spanRows = cell.span.row || 1;
            const spanCols = cell.span.col || 1;
            if (r + spanRows - 1 >= row && c + spanCols - 1 >= col) {
              return `${r}.${c}`;
            }
          }
        }
      }
      return null;
    }

    // Compute which cells can be added to the current selection
    // while maintaining a contiguous rectangle
    function getSelectableCells() {
      if (selectedCellsForMerge.length === 0 || !hasGrid) return null; // null = all selectable

      // Build bounding box accounting for cell spans
      let minRow = Infinity,
        maxRow = -Infinity;
      let minCol = Infinity,
        maxCol = -Infinity;
      selectedCellsForMerge.forEach((cn) => {
        const [r, c] = cn.split(".").map(Number);
        const cellDef = item.grid[cn];
        const spanRow = cellDef?.span?.row || 1;
        const spanCol = cellDef?.span?.col || 1;
        minRow = Math.min(minRow, r);
        maxRow = Math.max(maxRow, r + spanRow - 1);
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c + spanCol - 1);
      });

      const { rows, cols } = item.grid;
      const selectable = new Set();

      // Expand up: entire row above bounding box
      if (minRow > 1)
        for (let c = minCol; c <= maxCol; c++)
          selectable.add(`${minRow - 1}.${c}`);
      // Expand down
      if (maxRow < rows)
        for (let c = minCol; c <= maxCol; c++)
          selectable.add(`${maxRow + 1}.${c}`);
      // Expand left
      if (minCol > 1)
        for (let r = minRow; r <= maxRow; r++)
          selectable.add(`${r}.${minCol - 1}`);
      // Expand right
      if (maxCol < cols)
        for (let r = minRow; r <= maxRow; r++)
          selectable.add(`${r}.${maxCol + 1}`);

      // Exclude already-selected, then resolve hidden cells to their span owners
      selectedCellsForMerge.forEach((cn) => selectable.delete(cn));
      const resolved = new Set();
      for (const cn of selectable) {
        if (item.grid[cn]?.hide) {
          const [r, c] = cn.split(".").map(Number);
          const owner = findSpanOwner(item.grid, r, c);
          if (owner && !selectedCellsForMerge.includes(owner)) {
            resolved.add(owner);
          }
        } else {
          resolved.add(cn);
        }
      }
      return resolved;
    }

    function handleToggleCellSelection(cellNumber) {
      setSelectedCellsForMerge((prev) => {
        if (prev.includes(cellNumber)) {
          return []; // Deselecting any cell clears entire selection
        }
        const allCells = [...prev, cellNumber];
        // Build bounding box accounting for cell spans
        let minRow = Infinity,
          maxRow = -Infinity;
        let minCol = Infinity,
          maxCol = -Infinity;
        allCells.forEach((cn) => {
          const [r, c] = cn.split(".").map(Number);
          const cellDef = item.grid[cn];
          const spanRow = cellDef?.span?.row || 1;
          const spanCol = cellDef?.span?.col || 1;
          minRow = Math.min(minRow, r);
          maxRow = Math.max(maxRow, r + spanRow - 1);
          minCol = Math.min(minCol, c);
          maxCol = Math.max(maxCol, c + spanCol - 1);
        });
        // Fill bounding box, resolving hidden cells to span owners
        const result = [];
        const added = new Set();
        for (let r = minRow; r <= maxRow; r++)
          for (let c = minCol; c <= maxCol; c++) {
            const key = `${r}.${c}`;
            if (item.grid[key]?.hide) {
              const owner = findSpanOwner(item.grid, r, c);
              if (owner && !added.has(owner)) {
                result.push(owner);
                added.add(owner);
              }
            } else if (!added.has(key)) {
              result.push(key);
              added.add(key);
            }
          }
        return result;
      });
    }

    function handleOpenMergeModal(cellNumbers) {
      setSelectedCellsForMerge(cellNumbers);
      setMergeModalOpen(true);
    }

    function handleMergeCellsConfirm(mergeData) {
      if (onMergeCells) {
        onMergeCells(mergeData);
      }
      setMergeModalOpen(false);
      setSelectedCellsForMerge([]);
    }

    // Compute real conflicting components for merge modal
    function getConflictingComponents(cellNumbers) {
      if (!item?.grid) return [];
      return cellNumbers
        .filter((cn) => item.grid[cn]?.component)
        .map((cn) => item.grid[cn].component);
    }

    function handleCellRightClick(e, cellNumber) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenuCell(cellNumber);
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    }

    function handleCloseContextMenu() {
      setContextMenuCell(null);
    }

    function handleAddRow(afterRow) {
      if (onAddGridRow) {
        onAddGridRow(id, afterRow);
      }
    }

    function handleDeleteRow(rowNumber) {
      if (onDeleteGridRow) {
        onDeleteGridRow(id, rowNumber);
      }
    }

    function handleAddColumn(afterCol) {
      if (onAddGridColumn) {
        onAddGridColumn(id, afterCol);
      }
    }

    function handleDeleteColumn(colNumber) {
      if (onDeleteGridColumn) {
        onDeleteGridColumn(id, colNumber);
      }
    }

    // Check if a row has any visible (non-hidden) cells starting in it
    function rowHasVisibleCells(row) {
      if (!hasGrid) return true;
      const { cols } = item.grid;
      for (let col = 1; col <= cols; col++) {
        const cellDef = item.grid[`${row}.${col}`];
        if (!cellDef || !cellDef.hide) return true;
      }
      return false;
    }

    // Get the gutter span for this column label. Only spans into
    // consecutive hidden columns (where no row has a visible cell).
    // Cell spans are visualized by the cells themselves and should
    // not affect the gutter label positioning.
    function getColGutterSpan(col) {
      if (!hasGrid) return 1;
      const { cols } = item.grid;
      let hiddenAfter = 0;
      for (let c = col + 1; c <= cols; c++) {
        if (!colHasVisibleCells(c)) hiddenAfter++;
        else break;
      }
      return 1 + hiddenAfter;
    }

    // Get the gutter span for this row label. Only spans into
    // consecutive hidden rows (where no column has a visible cell).
    function getRowGutterSpan(row) {
      if (!hasGrid) return 1;
      const { rows } = item.grid;
      let hiddenAfter = 0;
      for (let r = row + 1; r <= rows; r++) {
        if (!rowHasVisibleCells(r)) hiddenAfter++;
        else break;
      }
      return 1 + hiddenAfter;
    }

    // Check if a column has any visible (non-hidden) cells starting in it
    function colHasVisibleCells(col) {
      if (!hasGrid) return true;
      const { rows } = item.grid;
      for (let row = 1; row <= rows; row++) {
        const cellDef = item.grid[`${row}.${col}`];
        if (!cellDef || !cellDef.hide) return true;
      }
      return false;
    }

    // Render left gutter with row controls (always-visible, CSS Grid aligned)
    function renderRowGutter() {
      if (!hasGrid || preview) return null;

      const { rows } = item.grid;
      const rowItems = [];

      const visibleRowCount = Array.from(
        { length: rows },
        (_, i) => i + 1,
      ).filter(rowHasVisibleCells).length;

      for (let row = 1; row <= rows; row++) {
        const hasVisible = rowHasVisibleCells(row);
        const rowSpan = hasVisible ? getRowGutterSpan(row) : 1;
        rowItems.push(
          <div
            key={`row-gutter-${row}`}
            className="flex w-full items-center justify-center group"
            style={
              rowSpan > 1 ? { gridRow: `${row} / span ${rowSpan}` } : undefined
            }
          >
            {hasVisible && (
              <div className="flex flex-col items-center gap-0.5 py-1">
                <button
                  className={gridCtrl}
                  onClick={() => handleAddRow(row - 1)}
                  title={`Add row above row ${row}`}
                >
                  <FontAwesomeIcon icon="plus" />
                </button>
                <span
                  className={`text-xs select-none font-mono font-medium ${tokens.muted}`}
                >
                  R{row}
                </span>
                {(() => {
                  const { label, changed } = getRowSizingDisplay(row);
                  return (
                    <div className="relative">
                      <button
                        ref={
                          sizingPopover?.type === "row" &&
                          sizingPopover?.index === row
                            ? popoverTriggerRef
                            : undefined
                        }
                        aria-expanded={
                          sizingPopover?.type === "row" &&
                          sizingPopover?.index === row
                        }
                        className={`${gridCtrl} font-mono font-semibold select-none ${
                          changed ||
                          (sizingPopover?.type === "row" &&
                            sizingPopover?.index === row)
                            ? tokens.strong
                            : ""
                        }`}
                        onClick={() =>
                          setSizingPopover(
                            sizingPopover?.type === "row" &&
                              sizingPopover?.index === row
                              ? null
                              : { type: "row", index: row },
                          )
                        }
                        title="Row sizing (click to change)"
                      >
                        {label}
                      </button>
                      {renderSizingPopover("row", row)}
                    </div>
                  );
                })()}
                <button
                  className={gridCtrl}
                  onClick={() => handleAddRow(row)}
                  title={`Add row below row ${row}`}
                >
                  <FontAwesomeIcon icon="plus" />
                </button>
                {visibleRowCount > 1 && (
                  <button
                    className={gridCtrlDelete}
                    onClick={() => handleDeleteRow(row)}
                    title={`Delete row ${row}`}
                  >
                    <FontAwesomeIcon icon="trash" />
                  </button>
                )}
              </div>
            )}
          </div>,
        );
      }

      return (
        <div
          className="flex flex-col flex-shrink-0 pl-1.5"
          style={{ width: GUTTER_WIDTH }}
        >
          {/* Top spacer */}
          <div style={{ height: GRID_PAD }} />
          {/* CSS Grid matching main grid's row template */}
          <div
            className={`grid ${scrollable ? "" : "flex-1"}`}
            style={{
              gridTemplateRows: scrollable
                ? getRowTemplate(item.grid)
                : hasExplicitRowModes()
                  ? getRowTemplate(item.grid)
                  : `repeat(${rows}, minmax(0, 1fr))`,
              gap: GRID_GAP,
            }}
          >
            {rowItems}
          </div>
          {/* Bottom spacer */}
          <div style={{ height: GRID_PAD }} />
        </div>
      );
    }

    // Render top gutter with column controls (always-visible, CSS Grid aligned)
    function renderColumnGutter() {
      if (!hasGrid || preview) return null;

      const { cols } = item.grid;
      const colItems = [];

      const visibleColCount = Array.from(
        { length: cols },
        (_, i) => i + 1,
      ).filter(colHasVisibleCells).length;

      for (let col = 1; col <= cols; col++) {
        const hasVisible = colHasVisibleCells(col);
        const colSpan = hasVisible ? getColGutterSpan(col) : 1;
        colItems.push(
          <div
            key={`col-gutter-${col}`}
            className="flex h-full items-center justify-center group"
            style={
              colSpan > 1
                ? { gridColumn: `${col} / span ${colSpan}` }
                : undefined
            }
          >
            {hasVisible && (
              <div className="flex items-center gap-0.5 px-1">
                <button
                  className={gridCtrl}
                  onClick={() => handleAddColumn(col - 1)}
                  title={`Add column before column ${col}`}
                >
                  <FontAwesomeIcon icon="plus" />
                </button>
                <span
                  className={`text-xs select-none font-mono font-medium ${tokens.muted}`}
                >
                  C{col}
                </span>
                {(() => {
                  const { label, changed } = getColSizingDisplay(col);
                  return (
                    <div className="relative">
                      <button
                        ref={
                          sizingPopover?.type === "col" &&
                          sizingPopover?.index === col
                            ? popoverTriggerRef
                            : undefined
                        }
                        aria-expanded={
                          sizingPopover?.type === "col" &&
                          sizingPopover?.index === col
                        }
                        className={`${gridCtrl} font-mono font-semibold select-none ${
                          changed ||
                          (sizingPopover?.type === "col" &&
                            sizingPopover?.index === col)
                            ? tokens.strong
                            : ""
                        }`}
                        onClick={() =>
                          setSizingPopover(
                            sizingPopover?.type === "col" &&
                              sizingPopover?.index === col
                              ? null
                              : { type: "col", index: col },
                          )
                        }
                        title="Column sizing (click to change)"
                      >
                        {label}
                      </button>
                      {renderSizingPopover("col", col)}
                    </div>
                  );
                })()}
                <button
                  className={gridCtrl}
                  onClick={() => handleAddColumn(col)}
                  title={`Add column after column ${col}`}
                >
                  <FontAwesomeIcon icon="plus" />
                </button>
                {visibleColCount > 1 && (
                  <button
                    className={gridCtrlDelete}
                    onClick={() => handleDeleteColumn(col)}
                    title={`Delete column ${col}`}
                  >
                    <FontAwesomeIcon icon="trash" />
                  </button>
                )}
              </div>
            )}
          </div>,
        );
      }

      return (
        <div
          className="flex flex-row flex-shrink-0"
          style={{
            height: GUTTER_HEIGHT,
            marginLeft: GUTTER_WIDTH,
          }}
        >
          {/* Left spacer */}
          <div style={{ width: GRID_PAD }} />
          {/* CSS Grid matching main grid's column template */}
          <div
            className="grid flex-1"
            style={{
              gridTemplateColumns: hasExplicitColModes()
                ? getColTemplate(item.grid)
                : `repeat(${cols}, 1fr)`,
              gap: GRID_GAP,
            }}
          >
            {colItems}
          </div>
          {/* Right spacer */}
          <div style={{ width: GRID_PAD }} />
        </div>
      );
    }

    // Render individual grid cells
    function renderGridCells() {
      if (!hasGrid) return null;

      const cells = [];
      const { rows, cols } = item.grid;
      const selectableSet = getSelectableCells();

      for (let row = 1; row <= rows; row++) {
        for (let col = 1; col <= cols; col++) {
          const cellNumber = `${row}.${col}`;
          const cellDef = item.grid[cellNumber] || {
            component: null,
            hide: false,
          };

          // Skip hidden cells
          if (cellDef.hide) continue;

          // Build explicit grid position + span styles for every cell
          const spanStyle = {
            gridColumn: col,
            gridRow: row,
          };
          if (cellDef.span) {
            if (typeof cellDef.span === "object") {
              if (cellDef.span.col > 1)
                spanStyle.gridColumn = `${col} / span ${cellDef.span.col}`;
              if (cellDef.span.row > 1)
                spanStyle.gridRow = `${row} / span ${cellDef.span.row}`;
            } else if (typeof cellDef.span === "string") {
              const match = cellDef.span.match(/(col|row)-span-(\d+)/);
              if (match) {
                const [, dir, count] = match;
                if (dir === "col")
                  spanStyle.gridColumn = `${col} / span ${count}`;
                if (dir === "row") spanStyle.gridRow = `${row} / span ${count}`;
              }
            }
          }

          const isCellSelected = selectedCellsForMerge.includes(cellNumber);

          const rowModes = item.grid.rowModes || {};
          const rowMode = rowModes[String(row)] || "fixed";
          const heightClass = rowMode === "shrink" ? "" : "h-full";

          cells.push(
            <div
              key={cellNumber}
              className={`flex w-full ${heightClass} min-h-0 min-w-0 overflow-hidden relative ${
                isCellSelected ? "ring-2 ring-blue-500 ring-inset rounded" : ""
              }`}
              data-cell={cellNumber}
              style={spanStyle}
            >
              {preview
                ? cellDef.component
                  ? renderCellComponent(
                      cellDef.component,
                      cellNumber,
                      selectableSet,
                    )
                  : renderPreviewEmptyCell(cellNumber)
                : renderEditCell(cellNumber, cellDef, selectableSet)}
            </div>,
          );
        }
      }

      return cells;
    }

    // Render component inside a grid cell (preview mode only)
    function renderCellComponent(componentId, cellNumber, selectableSet) {
      if (!layout || !workspace) {
        console.error("[LayoutGridContainer] Missing layout or workspace");
        return null;
      }

      const cellComponent = layout.find((c) => c.id === componentId);

      if (!cellComponent) {
        console.error(
          "[LayoutGridContainer] Component not found:",
          componentId,
        );
        return null;
      }

      const rendered = renderComponent(
        cellComponent.component,
        cellComponent.id,
        cellComponent,
        null,
      );

      // Prefer uuid over id — uuid is `${dashboardId}-${component}-${id}`
      // which is globally unique, while id is only unique within a
      // single page/container. Passing bare id causes WidgetPopoutStage
      // to find-first-match across layout/pages and render the wrong
      // widget when two pages share the same numeric id.
      const popoutKey = cellComponent.uuid || cellComponent.id;
      const onPopout =
        onWidgetPopout && cellComponent.component
          ? () => onWidgetPopout(popoutKey)
          : null;

      // Same frame and body types as edit mode (renderEditCell), so the
      // widget stays mounted across view ↔ edit (phase 1c).
      return (
        <GridCellFrame editing={false} onPopout={onPopout}>
          <DraggableDroppableCellBody
            enabled={false}
            cellNumber={cellNumber}
            gridContainerId={id}
          >
            {rendered}
          </DraggableDroppableCellBody>
        </GridCellFrame>
      );
    }

    // Render empty cell in preview mode
    function renderPreviewEmptyCell(cellNumber) {
      return (
        <div className="w-full h-full border-2 border-dashed border-gray-800 rounded flex items-center justify-center">
          <span className="text-xs text-gray-600">{cellNumber}</span>
        </div>
      );
    }

    // Render empty cell body content (used inside WidgetCard.Body in edit mode)
    function renderEmptyCellContent(cellNumber) {
      return (
        <div
          className="w-full h-full min-h-16 flex flex-col items-center justify-center gap-2"
          onContextMenu={(e) => handleCellRightClick(e, cellNumber)}
        >
          <button
            type="button"
            className={`flex flex-col items-center cursor-pointer rounded-lg px-4 py-2 transition-colors ${tokens.muted} ${tokens.hoverBg} ${tokens.hoverText}`}
            onClick={() => {
              const move = moveTarget(cellNumber);
              if (move) return move();
              // In the editor (phase 1d): select the cell; the panel's Add
              // tab places the next widget picked. Elsewhere: the pop-up.
              if (editSelection.available) {
                return editSelection.select({
                  kind: "cell",
                  gridItemId: item.id,
                  cellNumber,
                  scope: workspaceScope,
                  label: `Empty cell ${cellNumber}`,
                });
              }
              handleClickAdd(cellNumber);
            }}
          >
            <FontAwesomeIcon
              icon={moving ? "arrow-down" : "plus"}
              className="h-4 w-4"
            />
            <span className="text-xs mt-1">
              {moving ? "Move here" : "Add widget"}
            </span>
          </button>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("dash:open-widget-builder", {
                  detail: {
                    cellNumber,
                    gridItemId: item.id,
                    workspaceId: workspace?.id,
                  },
                }),
              )
            }
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors ${tokens.muted} ${tokens.hoverBg} ${tokens.hoverText}`}
          >
            <FontAwesomeIcon
              icon="wand-magic-sparkles"
              className="h-2.5 w-2.5"
            />
            Build with AI
          </button>
        </div>
      );
    }

    // Unified edit mode cell renderer — wraps ALL cells in WidgetCard
    function renderEditCell(cellNumber, cellDef, selectableSet) {
      const isCellSelected = selectedCellsForMerge.includes(cellNumber);
      const isCellSelectable =
        selectableSet === null || selectableSet.has(cellNumber);

      // Find component if cell is occupied
      let cellComponent = null;
      let renderedWidget = null;

      if (cellDef.component && layout) {
        cellComponent = layout.find((c) => c.id === cellDef.component);
        if (cellComponent) {
          renderedWidget = renderComponent(
            cellComponent.component,
            cellComponent.id,
            cellComponent,
            null,
          );
        }
      }

      // Select this cell's widget in the editor (phase 1c/1d). openTab "ask"

      // opens the panel on Ask AI.

      // section: open this inline settings section (edit / handlers /
      // providers / code) in the edit panel.
      const selectWidget = (openTab, section = null) => {
        if (!editSelection.available || !cellComponent) return;
        // A plain click on the widget that's already selected keeps the
        // selection — React bubbles clicks from the header menu (a portal)
        // up to the frame, and that would replace a section request.
        if (
          !openTab &&
          !section &&
          editSelection.selection?.kind === "widget" &&
          editSelection.selection.uuid === cellComponent.uuid
        ) {
          return;
        }

        editSelection.select({
          kind: "widget",

          uuid: cellComponent.uuid,

          id: cellComponent.id,

          component: cellComponent.component,

          gridItemId: item.id,

          cellNumber,

          scope: workspaceScope,

          label: pickWidgetDisplayName(
            cellComponent,

            ComponentManager.config(cellComponent.component, cellComponent),
          ),

          ...(openTab ? { openTab } : {}),

          // A fresh marker per request, so asking again for the section
          // that's already set still switches the panel to it.
          ...(section ? { section, sectionRequest: Date.now() } : {}),
        });
      };

      const isSelectedEmptyCell =
        !cellComponent &&
        editSelection.selection?.kind === "cell" &&
        editSelection.selection.gridItemId === item.id &&
        editSelection.selection.cellNumber === cellNumber &&
        (editSelection.selection.scope || "main") === workspaceScope;

      const header = (
        <WidgetCard.Header
          item={cellComponent}
          cellNumber={cellNumber}
          providers={cellComponent ? availableProviders || [] : []}
          selectedProviders={cellComponent?.selectedProviders || {}}
          isSelected={isCellSelected}
          isSelectable={isCellSelectable}
          onToggleSelect={() => handleToggleCellSelection(cellNumber)}
          onSplitHorizontal={() => handleInstantSplit(cellNumber, "horizontal")}
          onSplitVertical={() => handleInstantSplit(cellNumber, "vertical")}
          onProviderChange={
            cellComponent
              ? (providerType, providerId, isCreateNew) => {
                  if (isCreateNew) {
                    if (onCreateProvider) {
                      onCreateProvider(cellComponent.id, providerType, true);
                    }
                  } else {
                    if (onProviderSelect) {
                      onProviderSelect(
                        cellComponent.id,
                        providerType,
                        providerId,
                      );
                    }
                  }
                }
              : undefined
          }
          onConfigure={
            cellComponent
              ? (widgetItem, section) => {
                  // Editing: the panel shows the settings inline
                  // (CRE-006 AC5). Sections it doesn't show inline still
                  // open the Configure dialog.
                  if (editSelection.available && opensInPanel(section)) {
                    selectWidget("widget", section || "edit");
                    return;
                  }
                  selectWidget();
                  if (onOpenConfig) onOpenConfig(cellComponent, section);
                }
              : undefined
          }
          onDelete={
            cellComponent
              ? () => {
                  if (onClickRemove) onClickRemove(cellComponent.id);
                }
              : undefined
          }
          onEditWithAI={
            cellComponent
              ? () => {
                  selectWidget("ask");
                  window.dispatchEvent(
                    new CustomEvent("dash:edit-widget-with-ai", {
                      detail: {
                        cellNumber,
                        gridItemId: item.id,
                        workspaceId: workspace?.id,
                        widgetComponentName: cellComponent.component,
                        widgetId: cellComponent.id,
                        selectedProviders:
                          cellComponent.selectedProviders || null,
                        // Pass the live widget's userPrefs so the
                        // preview renders the same configured state
                        // the user sees on the dashboard (titles,
                        // defaults, etc.) instead of blank values.
                        userPrefs: cellComponent.userPrefs || null,
                        sourcePackage:
                          ComponentManager.config(
                            cellComponent.component,
                            cellComponent,
                          )?._sourcePackage || null,
                      },
                    }),
                  );
                }
              : undefined
          }
        />
      );
      const footer = cellComponent ? (
        <WidgetCard.Footer
          item={cellComponent}
          onConfigure={(item, section) => {
            if (editSelection.available && opensInPanel(section)) {
              selectWidget("widget", section || "edit");
              return;
            }
            if (onOpenConfig) onOpenConfig(item, section);
          }}
        />
      ) : null;

      // An occupied cell uses GridCellFrame — the same element tree as view
      // mode — so its widget stays mounted across view ↔ edit (phase 1c).
      if (
        cellComponent &&
        ComponentManager.config(cellComponent.component, cellComponent)
      ) {
        return (
          <GridCellFrame
            editing
            header={header}
            footer={footer}
            label={pickWidgetDisplayName(
              cellComponent,
              ComponentManager.config(cellComponent.component, cellComponent),
            )}
            onSelect={() => {
              // Phase 1e: while another widget is moving, choosing this one swaps them.
              const move = moveTarget(cellNumber);
              if (move) move();
              else selectWidget();
            }}
            selected={
              editSelection.selection?.kind === "widget" &&
              editSelection.selection.uuid === cellComponent.uuid
            }
            related={editSelection.related.widgets.has(cellComponent.uuid)}
            dimmed={
              editSelection.selection?.kind === "bot" &&
              !editSelection.related.widgets.has(cellComponent.uuid)
            }
          >
            <DraggableDroppableCellBody
              enabled
              cellNumber={cellNumber}
              gridContainerId={id}
              onMoveWidgetToCell={onMoveWidgetToCell}
              onDropWidgetFromSidebar={onDropWidgetFromSidebar}
              hasSpan={
                !!(
                  cellDef.span &&
                  ((cellDef.span.row && cellDef.span.row > 1) ||
                    (cellDef.span.col && cellDef.span.col > 1))
                )
              }
              padding="px-2 pb-2"
            >
              {renderedWidget}
            </DraggableDroppableCellBody>
          </GridCellFrame>
        );
      }

      return (
        <WidgetCard preview={false} highlighted={isSelectedEmptyCell}>
          {header}
          <DroppableEmptyCell
            cellNumber={cellNumber}
            gridContainerId={id}
            onMoveWidgetToCell={onMoveWidgetToCell}
            onDropWidgetFromSidebar={onDropWidgetFromSidebar}
          >
            {cellComponent ? (
              <div className="flex-1 flex flex-col min-h-[120px]">
                <WidgetNotFound component={cellComponent.component} />
              </div>
            ) : (
              <WidgetCard.Body padding="p-0">
                {renderEmptyCellContent(cellNumber)}
              </WidgetCard.Body>
            )}
          </DroppableEmptyCell>
          {footer}
        </WidgetCard>
      );
    }

    function handleClickAdd(cellNumber = null) {
      // Pass item and optionally cell number for grid layouts
      if (cellNumber && onClickAdd) {
        onClickAdd(item, cellNumber);
      } else if (onClickAdd) {
        onClickAdd(item);
      }
    }

    function handleDropItem(item) {
      if (onDropItem) {
        onDropItem(item);
      }
    }

    function handleDragItem(item) {}

    function renderComponentContainer(children) {
      if (!item) return null;

      // Extract widget-specific provider selections from workspace
      // selectedProviders structure: { "widget-id-123": { "algolia": "Provider Name", ... }, ... }
      const widgetSpecificSelections = workspace?.selectedProviders?.[id] || {};

      // Add provider-related props from workspace
      const itemWithProviders = {
        ...item,
        selectedProviders: widgetSpecificSelections,
        onProviderSelect: onProviderSelect,
      };

      return renderComponent(
        itemWithProviders["component"],
        id,
        itemWithProviders,
        children,
      );
    }

    function getAllWorkspaceNames() {
      if (workspace !== null) {
        const names = workspace.layout.map((layout) => {
          return "workspace" in layout ? layout.workspace : null;
        });
        return names
          .filter((value, index, array) => array.indexOf(value) === index)
          .filter((i) => i !== null);
      }
      return null;
    }

    function dropType(item) {
      // if item is a Workspace, and NOT a container, can only drop into a Container (layout)
      if (isWorkspace(item) === true) {
        return ["layout", item["parentWorkspaceName"]];
      }
      // if a container, we can place this into ANY other container or workspace
      if (isContainer(item) === true) {
        return getAllWorkspaceNames();
      }
      return ["layout", item["parentWorkspaceName"]];
    }

    function dragType(item) {
      if (isWorkspace(item) === true) {
        return item["parentWorkspaceName"];
      }
      if (isContainer(item)) {
        return "layout";
      }
      return item["parentWorkspaceName"];
    }

    // Grid layout: ONE element tree for view and edit (create-entry phase
    // 1c), so widgets stay mounted across modes. Edit-only parts (gutters,
    // merge/split UI, modals) render only while editing; edit-only wrappers
    // become display: contents in view mode, leaving view layout unchanged.
    const editing = preview === false;
    const hidden = editing ? undefined : { display: "contents" };
    const viewGridStyle = (overflow, rows) => ({
      gridTemplateRows: rows,
      gridTemplateColumns: hasExplicitColModes()
        ? getColTemplate(item.grid)
        : `repeat(${item.grid.cols}, 1fr)`,
      overflow,
    });
    const viewGap = `${!item.grid?.gap || item.grid?.gap === "gap-2" ? "dr-grid-gap" : ""} ${item.grid?.gap || "gap-2"}`;
    return useGridLayout ? (
      <LayoutContainer
        style={hidden}
        id={`grid-container-parent-${id}`}
        direction={"col"}
        width={"w-full"}
        height={"h-full"}
        scrollable={false}
        className={
          editing
            ? `rounded-lg overflow-x-clip border ${currentTheme["border-neutral-dark"] || ""} min-h-24 z-10`
            : ""
        }
        space={false}
      >
        <div
          className={editing ? "flex flex-col flex-1 min-h-0 pt-2" : undefined}
          style={hidden}
        >
          {/* Merge confirmation modal */}
          {editing && (
            <ConfirmationModal
              isOpen={selectedCellsForMerge.length >= 2}
              setIsOpen={() => setSelectedCellsForMerge([])}
              title="Merge Cells"
              message={`Merge ${selectedCellsForMerge.length} selected cells into one? This action cannot be undone.`}
              confirmLabel="Merge"
              variant="default"
              onConfirm={() => {
                const conflicts = getConflictingComponents(
                  selectedCellsForMerge,
                );
                if (conflicts.length > 1) {
                  handleOpenMergeModal(selectedCellsForMerge);
                } else {
                  handleMergeCellsConfirm({
                    cellNumbers: selectedCellsForMerge,
                    gridContainer: item,
                    keepComponent: conflicts.length === 1 ? conflicts[0] : null,
                  });
                }
              }}
              onCancel={() => setSelectedCellsForMerge([])}
            />
          )}

          {/* Top column gutter */}
          {editing ? renderColumnGutter() : null}

          {/* Row gutter + main grid side by side */}
          {scrollable ? (
            <div
              className={editing ? "relative flex-1 min-h-0" : undefined}
              style={hidden}
            >
              <div
                className={
                  editing
                    ? "absolute inset-0 flex flex-row overflow-y-auto items-start"
                    : undefined
                }
                style={hidden}
              >
                {editing ? renderRowGutter() : null}
                <div
                  id={`grid-container-${id}`}
                  className={
                    editing
                      ? "grid flex-1 min-h-24 p-4 gap-5"
                      : `dr-grid ${viewGap} grid w-full min-h-24 p-3`
                  }
                  style={
                    editing
                      ? {
                          gridTemplateRows: getRowTemplate(item.grid),
                          gridTemplateColumns: hasExplicitColModes()
                            ? getColTemplate(item.grid)
                            : `repeat(${item.grid.cols}, 1fr)`,
                        }
                      : viewGridStyle("auto", getRowTemplate(item.grid))
                  }
                >
                  {renderGridCells()}
                </div>
              </div>
            </div>
          ) : (
            <div
              className={
                editing
                  ? "relative flex-1 min-h-0"
                  : `relative w-full ${height} min-h-24`
              }
            >
              <div
                className={
                  editing
                    ? "absolute inset-0 flex flex-row overflow-hidden"
                    : undefined
                }
                style={hidden}
              >
                {editing ? renderRowGutter() : null}
                <div
                  id={`grid-container-${id}`}
                  className={
                    editing
                      ? "grid flex-1 p-4 gap-5"
                      : `dr-grid ${viewGap} absolute inset-0 grid p-3`
                  }
                  style={
                    editing
                      ? {
                          gridTemplateRows: hasExplicitRowModes()
                            ? getRowTemplate(item.grid)
                            : `repeat(${item.grid.rows}, minmax(0, 1fr))`,
                          gridTemplateColumns: hasExplicitColModes()
                            ? getColTemplate(item.grid)
                            : `repeat(${item.grid.cols}, 1fr)`,
                          overflow: "hidden",
                        }
                      : viewGridStyle(
                          "hidden",
                          hasExplicitRowModes()
                            ? getRowTemplate(item.grid)
                            : `repeat(${item.grid.rows}, minmax(0, 1fr))`,
                        )
                  }
                >
                  {renderGridCells()}
                </div>
              </div>
            </div>
          )}
        </div>

        {editing && (
          <>
            {/* Grid operation modals */}
            <MergeCellsModal
              open={mergeModalOpen}
              setIsOpen={setMergeModalOpen}
              cellNumbers={selectedCellsForMerge}
              gridContainer={item}
              conflictingComponents={getConflictingComponents(
                selectedCellsForMerge,
              )}
              onConfirm={handleMergeCellsConfirm}
            />

            {/* Context menu for cell operations */}
            {contextMenuCell && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={handleCloseContextMenu}
                />
                <div
                  className="fixed z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-48"
                  style={{
                    left: `${contextMenuPosition.x}px`,
                    top: `${contextMenuPosition.y}px`,
                  }}
                >
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center"
                    onClick={() => {
                      handleInstantSplit(contextMenuCell, "horizontal");
                      handleCloseContextMenu();
                    }}
                  >
                    <FontAwesomeIcon
                      icon="arrows-left-right"
                      className="mr-2"
                    />
                    Split Horizontal
                  </button>
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center"
                    onClick={() => {
                      handleInstantSplit(contextMenuCell, "vertical");
                      handleCloseContextMenu();
                    }}
                  >
                    <FontAwesomeIcon icon="arrows-up-down" className="mr-2" />
                    Split Vertical
                  </button>
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center"
                    onClick={() => {
                      handleClickAdd();
                      handleCloseContextMenu();
                    }}
                  >
                    <FontAwesomeIcon icon="plus" className="mr-2" />
                    Add Widget
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </LayoutContainer>
    ) : preview === false ? (
      // Flexbox layout mode — keep outer DragComponent/DropComponent
      <DropComponent
        item={item}
        id={id}
        type={dropType(item)}
        onDropItem={handleDropItem}
        width={item.width}
        height={item.height}
      >
        <DragComponent
          id={id}
          type={dragType(item)}
          onDropItem={handleDropItem}
          onDragItem={handleDragItem}
          width={"w-full"}
          height={"h-full"}
        >
          <LayoutContainer
            id={`grid-container-parent-${id}`}
            direction={"col"}
            width={"w-full"}
            height={"h-full"}
            scrollable={false}
            className={`rounded-lg overflow-x-clip border ${currentTheme["border-neutral-dark"] || ""} min-h-24 z-10`}
            space={false}
          >
            <LayoutContainer
              id={`grid-container-${id}`}
              direction={direction}
              scrollable={scrollable}
              width={"w-full"}
              height={`${height} min-h-24`}
              space={false}
              grow={grow}
              className={`p-3 ${
                direction === "row" ? "my-4 space-x-4" : "space-y-4"
              } ${item.hasChildren === true ? "justify-between" : ""}`}
            >
              {children !== null && children}
            </LayoutContainer>
          </LayoutContainer>
        </DragComponent>
      </DropComponent>
    ) : (
      renderComponentContainer(children)
    );
  },
);
