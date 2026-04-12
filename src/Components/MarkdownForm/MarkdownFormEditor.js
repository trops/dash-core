/**
 * MarkdownFormEditor.js
 *
 * Renders parsed markdown blocks as an editable form.
 * Tables become editable grids with type-appropriate inputs.
 * Free text becomes editable textareas.
 *
 * Usage:
 *   import { MarkdownFormEditor } from "@trops/dash-core";
 *   <MarkdownFormEditor content={md} onChange={setMd} />
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { parse, serialize } from "../../utils/markdownFormParser";

// ─── Table Cell Editor ───────────────────────────────────────────────────────

function cellMatches(value, query) {
  if (!query || !query.trim() || !value) return false;
  return value.toLowerCase().includes(query.toLowerCase());
}

function CellEditor({
  value,
  columnType,
  onChange,
  onChangeWithNewOption,
  searchQuery = "",
}) {
  const [enteringCustom, setEnteringCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const customInputRef = useRef(null);

  const matches = cellMatches(value, searchQuery);
  const matchClass = matches
    ? "search-match-cell border-yellow-400 bg-yellow-800 text-yellow-100"
    : "";

  useEffect(() => {
    if (enteringCustom && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [enteringCustom]);

  if (columnType.type === "rownum") {
    return <span className="text-xs text-gray-500 px-1">{value}</span>;
  }

  if (columnType.type === "enum") {
    if (enteringCustom) {
      const submitCustom = () => {
        if (customValue.trim()) {
          onChangeWithNewOption(customValue.trim());
        }
        setEnteringCustom(false);
        setCustomValue("");
      };

      return (
        <div className="flex items-center gap-0.5">
          <input
            ref={customInputRef}
            type="text"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCustom();
              if (e.key === "Escape") {
                setEnteringCustom(false);
                setCustomValue("");
              }
            }}
            onBlur={submitCustom}
            placeholder="Type custom value..."
            className={`flex-1 px-2 py-1.5 bg-gray-800 border border-indigo-500 rounded text-sm text-gray-200 focus:outline-none ${matchClass}`}
          />
        </div>
      );
    }

    return (
      <select
        value={
          columnType.options.includes(value)
            ? value
            : value
              ? "__show_custom__"
              : ""
        }
        onChange={(e) => {
          if (e.target.value === "__other__") {
            setEnteringCustom(true);
            setCustomValue("");
          } else if (e.target.value === "__show_custom__") {
            // no-op
          } else {
            onChange(e.target.value);
          }
        }}
        className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700/50 rounded text-sm text-gray-200 focus:outline-none focus:border-indigo-500 ${matchClass}`}
      >
        <option value="">—</option>
        {columnType.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        {value && !columnType.options.includes(value) && (
          <option value="__show_custom__">{value}</option>
        )}
        <option value="__other__">Other...</option>
      </select>
    );
  }

  if (columnType.type === "longtext") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700/50 rounded text-sm text-gray-200 focus:outline-none focus:border-indigo-500 resize-none ${matchClass}`}
      />
    );
  }

  // text, date, default
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={columnType.type === "date" ? "YYYY-MM-DD" : ""}
      className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700/50 rounded text-sm text-gray-200 focus:outline-none focus:border-indigo-500 ${matchClass}`}
    />
  );
}

// ─── Table Block Editor ──────────────────────────────────────────────────────

function rowMatchesQuery(row, query) {
  if (!query || !query.trim()) return true;
  const q = query.toLowerCase();
  return row.some((cell) => cell && String(cell).toLowerCase().includes(q));
}

function TableEditor({ block, blockIndex, onBlockChange, searchQuery = "" }) {
  const handleCellChange = useCallback(
    (rowIdx, colIdx, value) => {
      const newRows = block.rows.map((row, ri) =>
        ri === rowIdx
          ? row.map((cell, ci) => (ci === colIdx ? value : cell))
          : [...row],
      );
      onBlockChange(blockIndex, { ...block, rows: newRows });
    },
    [block, blockIndex, onBlockChange],
  );

  const handleCellChangeWithNewOption = useCallback(
    (rowIdx, colIdx, value) => {
      const newRows = block.rows.map((row, ri) =>
        ri === rowIdx
          ? row.map((cell, ci) => (ci === colIdx ? value : cell))
          : [...row],
      );
      const ct = block.columnTypes[colIdx];
      let newColumnTypes = block.columnTypes;
      if (ct?.type === "enum" && value && !ct.options.includes(value)) {
        newColumnTypes = block.columnTypes.map((t, i) =>
          i === colIdx ? { ...t, options: [...t.options, value] } : t,
        );
      }
      onBlockChange(blockIndex, {
        ...block,
        rows: newRows,
        columnTypes: newColumnTypes,
      });
    },
    [block, blockIndex, onBlockChange],
  );

  const handleAddRow = useCallback(() => {
    const newRow = block.columns.map((_, colIdx) => {
      const ct = block.columnTypes[colIdx];
      if (ct.type === "rownum") {
        return String(block.rows.length + 1);
      }
      return "";
    });
    onBlockChange(blockIndex, {
      ...block,
      rows: [...block.rows, newRow],
    });
  }, [block, blockIndex, onBlockChange]);

  const handleDeleteRow = useCallback(
    (rowIdx) => {
      const newRows = block.rows.filter((_, i) => i !== rowIdx);
      const rownumCols = block.columnTypes
        .map((ct, i) => (ct.type === "rownum" ? i : -1))
        .filter((i) => i >= 0);
      if (rownumCols.length > 0) {
        newRows.forEach((row, i) => {
          rownumCols.forEach((colIdx) => {
            row[colIdx] = String(i + 1);
          });
        });
      }
      onBlockChange(blockIndex, { ...block, rows: newRows });
    },
    [block, blockIndex, onBlockChange],
  );

  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {block.columns.map((col, ci) => (
              <th
                key={ci}
                className="text-left px-2 py-2 border-b border-gray-600 text-gray-400 font-medium text-xs uppercase tracking-wider"
              >
                {col}
              </th>
            ))}
            <th className="w-6 border-b border-gray-600" />
          </tr>
        </thead>
        <tbody>
          {block.rows
            .map((row, ri) => ({ row, ri }))
            .filter(({ row }) => rowMatchesQuery(row, searchQuery))
            .map(({ row, ri }) => (
              <tr key={ri} className="group hover:bg-gray-800/30">
                {block.columns.map((_, ci) => (
                  <td key={ci} className="px-0.5 py-0.5">
                    <CellEditor
                      value={row[ci] || ""}
                      columnType={
                        block.columnTypes[ci] || {
                          type: "text",
                        }
                      }
                      onChange={(val) => handleCellChange(ri, ci, val)}
                      onChangeWithNewOption={(val) =>
                        handleCellChangeWithNewOption(ri, ci, val)
                      }
                      searchQuery={searchQuery}
                    />
                  </td>
                ))}
                <td className="px-0.5 py-0.5">
                  <button
                    onClick={() => handleDeleteRow(ri)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1"
                    title="Delete row"
                  >
                    <FontAwesomeIcon icon="times" className="h-2.5 w-2.5" />
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <button
        onClick={handleAddRow}
        className="mt-1 px-2 py-1 text-[10px] text-gray-500 hover:text-indigo-400 hover:bg-gray-800/50 rounded transition-colors flex items-center gap-1"
      >
        <FontAwesomeIcon icon="plus" className="h-2.5 w-2.5" />
        Add Row
      </button>
    </div>
  );
}

// ─── Section with collapse ───────────────────────────────────────────────────

function Section({ level, text, children }) {
  const [open, setOpen] = useState(true);

  const sizeClass =
    level === 1
      ? "text-lg font-bold text-gray-100"
      : level === 2
        ? "text-base font-semibold text-gray-200"
        : "text-sm font-semibold text-gray-300";

  return (
    <div className={level === 2 ? "mt-4" : level === 3 ? "mt-2 ml-1" : "mt-4"}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full text-left py-1 ${sizeClass} hover:text-indigo-300 transition-colors`}
      >
        <FontAwesomeIcon
          icon={open ? "chevron-down" : "chevron-right"}
          className="h-2.5 w-2.5 text-gray-500"
        />
        {text}
      </button>
      {open && <div className="ml-1">{children}</div>}
    </div>
  );
}

// ─── Paragraph Editor ────────────────────────────────────────────────────────

function ParagraphEditor({ block, blockIndex, onBlockChange }) {
  return (
    <textarea
      value={block.text}
      onChange={(e) =>
        onBlockChange(blockIndex, { ...block, text: e.target.value })
      }
      rows={Math.max(2, block.text.split("\n").length)}
      className="w-full px-2 py-1.5 bg-gray-800/50 border border-gray-700/30 rounded text-sm text-gray-300 focus:outline-none focus:border-indigo-500 resize-y font-mono"
    />
  );
}

// ─── List Editor ─────────────────────────────────────────────────────────────

function ListEditor({ block, blockIndex, onBlockChange }) {
  const handleItemChange = useCallback(
    (itemIdx, value) => {
      const newItems = block.items.map((item, i) =>
        i === itemIdx ? value : item,
      );
      onBlockChange(blockIndex, { ...block, items: newItems });
    },
    [block, blockIndex, onBlockChange],
  );

  const handleAddItem = useCallback(() => {
    onBlockChange(blockIndex, {
      ...block,
      items: [...block.items, ""],
    });
  }, [block, blockIndex, onBlockChange]);

  const handleDeleteItem = useCallback(
    (itemIdx) => {
      onBlockChange(blockIndex, {
        ...block,
        items: block.items.filter((_, i) => i !== itemIdx),
      });
    },
    [block, blockIndex, onBlockChange],
  );

  return (
    <div className="my-1 space-y-0.5">
      {block.items.map((item, i) => (
        <div key={i} className="flex items-center gap-1 group">
          <span className="text-gray-500 text-xs w-3 flex-shrink-0">
            &bull;
          </span>
          <input
            type="text"
            value={item}
            onChange={(e) => handleItemChange(i, e.target.value)}
            className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700/50 rounded text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => handleDeleteItem(i)}
            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1"
          >
            <FontAwesomeIcon icon="times" className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
      <button
        onClick={handleAddItem}
        className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-indigo-400 hover:bg-gray-800/50 rounded transition-colors flex items-center gap-1"
      >
        <FontAwesomeIcon icon="plus" className="h-2.5 w-2.5" />
        Add item
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function MarkdownFormEditor({
  content,
  onChange,
  readOnly = false,
  searchQuery = "",
}) {
  const [blocks, setBlocks] = useState([]);
  const debounceRef = useRef(null);
  const internalChangeRef = useRef(false);
  const lastContentRef = useRef("");

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      setBlocks(parse(content || ""));
    }
  }, [content]);

  const emitChange = useCallback(
    (updatedBlocks) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (onChange) {
          const md = serialize(updatedBlocks);
          lastContentRef.current = md;
          internalChangeRef.current = true;
          onChange(md);
        }
      }, 800);
    },
    [onChange],
  );

  const handleBlockChange = useCallback(
    (blockIndex, updatedBlock) => {
      const newBlocks = blocks.map((b, i) =>
        i === blockIndex ? updatedBlock : b,
      );
      setBlocks(newBlocks);
      emitChange(newBlocks);
    },
    [blocks, emitChange],
  );

  const renderBlocks = useMemo(() => {
    const elements = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      switch (block.type) {
        case "heading": {
          const children = [];
          let j = i + 1;
          while (j < blocks.length) {
            if (
              blocks[j].type === "heading" &&
              blocks[j].level <= block.level
            ) {
              break;
            }
            children.push(j);
            j++;
          }

          if (block.level >= 2) {
            elements.push(
              <Section key={i} level={block.level} text={block.text}>
                {children.map((ci) => renderBlock(blocks[ci], ci))}
              </Section>,
            );
            i = j - 1;
          } else {
            elements.push(
              <h1 key={i} className="text-lg font-bold text-gray-100 mt-2 mb-2">
                {block.text}
              </h1>,
            );
          }
          break;
        }

        default:
          elements.push(renderBlock(block, i));
          break;
      }
    }

    return elements;
  }, [blocks, handleBlockChange, searchQuery]);

  function renderBlock(block, index) {
    switch (block.type) {
      case "table":
        return (
          <TableEditor
            key={index}
            block={block}
            blockIndex={index}
            onBlockChange={handleBlockChange}
            searchQuery={searchQuery}
          />
        );
      case "paragraph":
        return (
          <ParagraphEditor
            key={index}
            block={block}
            blockIndex={index}
            onBlockChange={handleBlockChange}
          />
        );
      case "list":
        return (
          <ListEditor
            key={index}
            block={block}
            blockIndex={index}
            onBlockChange={handleBlockChange}
          />
        );
      case "blockquote":
        return (
          <div key={index} className="border-l-2 border-gray-600 pl-3 my-1">
            <textarea
              value={block.text}
              onChange={(e) =>
                handleBlockChange(index, {
                  ...block,
                  text: e.target.value,
                })
              }
              rows={2}
              className="w-full px-2 py-1.5 bg-gray-800/30 text-sm text-gray-400 italic focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>
        );
      case "hr":
        return <hr key={index} className="border-gray-700 my-3" />;
      case "comment":
      case "empty":
        return null;
      default:
        return null;
    }
  }

  if (!blocks.length) {
    return (
      <p className="text-xs text-gray-500 italic">No content to display</p>
    );
  }

  return <div className="space-y-0.5">{renderBlocks}</div>;
}
