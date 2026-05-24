import React, { useState, useMemo } from "react";
import { REGISTRY } from "./registry";

/**
 * ComponentList — alphabetical list of every theme-aware primitive.
 *
 * The always-on entry point to the inspector: regardless of whether
 * a component is rendered in the preview canvas, the user can click
 * its row here to open the inspector and edit its tokens. Separate
 * from the preview canvas (which is now purely a visual surface).
 *
 * Variants are listed individually (Heading, Heading 2, Heading 3,
 * etc.) — each is its own theme key. A search box at the top filters
 * by label.
 *
 * Props:
 *   - selectedType: which registry type is currently selected (drives
 *     the highlight). May be null.
 *   - onSelect: ({ type, themeKey }) => void  — fired when a row is
 *     clicked.
 */

const ComponentList = ({ selectedType = null, onSelect }) => {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const list = Object.entries(REGISTRY).map(([type, entry]) => ({
      type,
      label: entry.label,
      themeKey: entry.themeKey,
      category: entry.category,
    }));
    list.sort((a, b) => a.label.localeCompare(b.label));
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.themeKey.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-2 p-3 border-b border-gray-800">
        <span className="text-xs uppercase font-bold text-gray-500 tracking-wider">
          Components
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-yellow-500"
        />
      </div>
      <div className="flex flex-col overflow-y-auto flex-1 min-h-0">
        {entries.map((e) => {
          const isSelected = selectedType === e.type;
          return (
            <button
              key={e.type}
              type="button"
              onClick={() =>
                onSelect && onSelect({ type: e.type, themeKey: e.themeKey })
              }
              className={`flex flex-col px-3 py-1.5 text-left border-l-2 ${
                isSelected
                  ? "border-l-yellow-500 bg-gray-700"
                  : "border-l-transparent hover:bg-gray-800"
              }`}
              title={e.themeKey}
            >
              <span className="text-xs text-gray-200">{e.label}</span>
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                {e.category}
              </span>
            </button>
          );
        })}
        {entries.length === 0 && (
          <div className="text-xs text-gray-500 italic p-3">
            No components match.
          </div>
        )}
      </div>
    </div>
  );
};

export default ComponentList;
