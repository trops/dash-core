import React, { useState, useRef, useContext } from "react";
import { createPortal } from "react-dom";
import { useDrop } from "react-dnd";
import { ThemeContext, FontAwesomeIcon, Toggle } from "@trops/dash-react";
import { GRID_CELL_WIDGET_TYPE } from "../../utils/dragTypes";

/**
 * A page tab a widget can be dropped on (approved mockup "Move a widget to
 * another page", frame 3): it lights up and says "Drop to move to Home".
 * Only while editing, never the page it's on. Needs the dashboard's
 * DndProvider, so it's only used when the bar is given onDropWidget.
 */
const TabDropTarget = ({ page, enabled, onDropWidget, children }) => {
  const { currentTheme } = useContext(ThemeContext);
  const [{ over }, drop] = useDrop(
    () => ({
      accept: GRID_CELL_WIDGET_TYPE,
      canDrop: (item) => enabled && (item.workspaceScope || "main") === "main",
      drop: (item) => {
        onDropWidget(page.id, item);
      },
      collect: (monitor) => ({
        over: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [enabled, page.id, onDropWidget],
  );
  const boxRef = useRef(null);
  const setRefs = (el) => {
    boxRef.current = el;
    drop(el);
  };
  // The tab bar scrolls sideways (it clips what hangs below it): the hint
  // goes on the page, under the tab.
  const at =
    over && boxRef.current && boxRef.current.getBoundingClientRect
      ? boxRef.current.getBoundingClientRect()
      : null;
  const hint = over ? (
    <span
      role="status"
      style={
        at
          ? {
              position: "fixed",
              left: Math.round(at.left),
              top: Math.round(at.bottom + 6),
            }
          : undefined
      }
      className={`z-50 whitespace-nowrap px-2.5 py-1.5 rounded-md border-2 border-dashed text-xs shadow-lg ${
        currentTheme["bg-neutral-very-dark"] || ""
      } ${currentTheme["border-primary-medium"] || ""} ${
        currentTheme["text-neutral-light"] || ""
      }`}
    >
      ↪ Drop to move to {page.name}
    </span>
  ) : null;
  return (
    <span
      ref={setRefs}
      className="relative inline-flex"
      data-testid={`page-drop-${page.id}`}
    >
      {children(over)}
      {hint && typeof document !== "undefined"
        ? createPortal(hint, document.body)
        : hint}
    </span>
  );
};

/**
 * PageTabBar — tabbed navigation for pages within a workspace.
 *
 * Supports:
 * - Click to switch pages
 * - Double-click to rename (edit mode)
 * - Drag-to-reorder tabs (edit mode)
 * - "+" button to add page (edit mode)
 * - "×" button to delete page (edit mode, min 1 page)
 */
export const PageTabBar = ({
  pages = [],
  activePageId = null,
  onSwitchPage = null,
  onAddPage = null,
  onRenamePage = null,
  onDeletePage = null,
  onReorderPages = null,
  // A widget dragged onto a tab moves to that page: (pageId, dragItem).
  onDropWidget = null,
  editMode = false,
  scrollableEnabled = false,
  onScrollableChange = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const inputRef = useRef(null);

  if (pages.length <= 1 && !editMode) return null;

  const sortedPages = [...pages].sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );

  const startRename = (page) => {
    if (!editMode) return;
    setEditingId(page.id);
    setEditValue(page.name);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (editingId && editValue.trim() && onRenamePage) {
      onRenamePage(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDragStart = (e, pageId) => {
    if (!editMode) return;
    setDragId(pageId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, pageId) => {
    if (!editMode || !dragId || dragId === pageId) return;
    e.preventDefault();
    setDragOverId(pageId);
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (!dragId || dragId === targetId || !onReorderPages) return;

    const dragIndex = sortedPages.findIndex((p) => p.id === dragId);
    const targetIndex = sortedPages.findIndex((p) => p.id === targetId);
    if (dragIndex === -1 || targetIndex === -1) return;

    const reordered = [...sortedPages];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    // Update order values
    const updated = reordered.map((p, i) => ({ ...p, order: i }));
    onReorderPages(updated);

    setDragId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div
      className={`dr-tabs flex flex-row items-center shrink-0 overflow-x-auto gap-1 px-2 py-1.5 border-b ${
        currentTheme["border-neutral-dark"] || "border-neutral-800"
      } ${currentTheme["bg-none"] || "bg-transparent"} scrollbar-none`}
    >
      {/* Only show page tabs when there are 2+ pages.
          With a lone page, the tab is hidden but the page still
          renders normally — adding a 2nd page reveals both tabs. */}
      {pages.length > 1 &&
        sortedPages.map((page) => {
          const isActive = page.id === activePageId;
          const isDragOver = page.id === dragOverId;

          const tab = (dropOver = false) => (
            <button
              key={page.id}
              type="button"
              onClick={() => onSwitchPage && onSwitchPage(page.id)}
              onDoubleClick={() => startRename(page)}
              draggable={editMode}
              onDragStart={(e) => handleDragStart(e, page.id)}
              onDragOver={(e) => handleDragOver(e, page.id)}
              onDrop={(e) => handleDrop(e, page.id)}
              onDragEnd={handleDragEnd}
              className={`dr-tab ${isActive ? "dr-tab-active" : ""} group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-all duration-100 cursor-pointer ${
                isActive
                  ? `${currentTheme["bg-neutral-very-dark"] || ""} ${currentTheme["text-neutral-light"] || ""}`
                  : `${currentTheme["text-neutral-medium"] || ""} ${currentTheme["hover-bg-neutral-very-dark"] || ""}`
              } ${isDragOver ? `ring-1 ${currentTheme["ring-primary-medium"] || ""}` : ""} ${
                dropOver
                  ? `ring-2 ring-inset ${currentTheme["ring-primary-medium"] || ""} ${currentTheme["bg-primary-dark"] || ""} ${currentTheme["text-neutral-light"] || ""}`
                  : ""
              } ${editMode ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {editingId === page.id ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className={`bg-transparent border-b text-sm outline-none w-24 ${currentTheme["border-primary-medium"] || ""} ${currentTheme["text-neutral-light"] || ""}`}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[140px]">{page.name}</span>
              )}

              {editMode && pages.length > 1 && editingId !== page.id && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePage && onDeletePage(page.id);
                  }}
                  aria-label={`Delete ${page.name}`}
                  role="button"
                  className={`flex items-center justify-center h-6 w-6 rounded ${currentTheme["hover-bg-neutral-very-dark"] || ""} ${
                    isActive ? "opacity-60" : "opacity-0 group-hover:opacity-60"
                  }`}
                >
                  <svg
                    className="h-2.5 w-2.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </span>
              )}
            </button>
          );
          return onDropWidget ? (
            <TabDropTarget
              key={page.id}
              page={page}
              enabled={editMode && !isActive}
              onDropWidget={onDropWidget}
            >
              {(over) => tab(over)}
            </TabDropTarget>
          ) : (
            tab()
          );
        })}

      {editMode && onAddPage && (
        <button
          type="button"
          onClick={onAddPage}
          className={`dr-tab flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${currentTheme["text-neutral-medium"] || ""} ${currentTheme["hover-bg-neutral-very-dark"] || ""}`}
        >
          <FontAwesomeIcon icon="plus" className="h-3 w-3" />
          <span>Add page</span>
        </button>
      )}

      {/* Scrollable toggle only appears here in multi-page mode.
          In single-page mode, the toggle lives in DashboardHeader. */}
      {editMode && pages.length > 1 && onScrollableChange && (
        <div className="ml-auto flex items-center shrink-0">
          <Toggle
            text="Scrollable"
            enabled={scrollableEnabled}
            setEnabled={onScrollableChange}
          />
        </div>
      )}
    </div>
  );
};
