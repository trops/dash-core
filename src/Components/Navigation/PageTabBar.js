import React, { useState, useRef, useContext } from "react";
import { ThemeContext, FontAwesomeIcon, Toggle } from "@trops/dash-react";

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
      className={`flex flex-row items-center shrink-0 overflow-x-auto gap-1 px-2 py-1.5 border-b ${
        currentTheme["border-primary-dark"] || "border-gray-700"
      } ${currentTheme["bg-primary-medium"] || "bg-gray-800/50"} scrollbar-none`}
    >
      {sortedPages.map((page) => {
        const isActive = page.id === activePageId;
        const isDragOver = page.id === dragOverId;

        return (
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
            className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-md whitespace-nowrap transition-all duration-100 cursor-pointer ${
              isActive
                ? "bg-white/15 text-white"
                : "text-gray-400 hover:bg-white/10 hover:text-gray-200"
            } ${isDragOver ? "ring-1 ring-blue-400" : ""} ${
              editMode ? "cursor-grab active:cursor-grabbing" : ""
            }`}
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
                className="bg-transparent border-b border-blue-400 text-xs text-white outline-none w-20"
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
                className={`flex items-center justify-center h-4 w-4 rounded-sm hover:bg-white/10 ${
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
      })}

      {editMode && onAddPage && (
        <button
          type="button"
          onClick={onAddPage}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-gray-500 hover:bg-white/10 hover:text-gray-300 transition-colors"
        >
          <FontAwesomeIcon icon="plus" className="h-2.5 w-2.5" />
          <span>Add Page</span>
        </button>
      )}

      {editMode && onScrollableChange && (
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
