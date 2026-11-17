import React from "react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { FIELD_KIND_LABELS } from "./flowText";

const INTRO = {
  command:
    "Your command gets this as JSON on standard input, and as a file at $DASH_INPUT. It comes from the steps before this one.",
  script:
    "Your function gets this as its argument. It comes from the steps before this one.",
  rules:
    "The rules read these fields. They come from the steps before this one.",
  tool: "The tool's inputs can come from these fields.",
};

const clip = (s, n = 900) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

/**
 * WhatItGets — the column left of a check's setup (frames 18, 19, 28):
 * every field the check receives, its kind and a real value; click one to
 * use it. Highlighted fields are the ones the check uses.
 */
export const WhatItGets = ({ data, kind = "command", used = [], onPick }) => {
  const {
    muted,
    strong,
    hairline,
    fieldBg,
    selectedBg,
    selectedBorder,
    accent,
  } = useConfigTokens();
  const rows = (data && data.rows) || [];
  const input = data && data.input;
  return (
    <aside
      data-testid="what-it-gets"
      aria-label="What it gets"
      className={`w-80 flex-shrink-0 min-h-0 overflow-y-auto flex flex-col gap-2 p-4 border-l ${hairline}`}
    >
      <span className={`text-sm font-semibold ${strong}`}>What it gets</span>
      <span className={`text-xs ${muted}`}>{INTRO[kind] || INTRO.command}</span>
      <div className="flex flex-col gap-1.5" role="list">
        {rows.map((r) => {
          const on = used.includes(r.path);
          return (
            <button
              key={r.path}
              type="button"
              role="listitem"
              onClick={() => onPick && onPick(r.path)}
              className={`text-left flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md border ${
                on ? `${selectedBg} ${selectedBorder}` : "border-transparent"
              }`}
            >
              <span className="flex flex-row items-center gap-2">
                <span
                  className={`flex-1 min-w-0 truncate font-mono text-xs ${on ? accent : strong}`}
                >
                  {r.path}
                </span>
                <span className={`text-xs px-1.5 rounded ${fieldBg} ${muted}`}>
                  {FIELD_KIND_LABELS[r.kind] || r.kind}
                </span>
              </span>
              <span className={`text-xs truncate ${muted}`}>{r.sample}</span>
            </button>
          );
        })}
        {!rows.length ? (
          <span className={`text-xs ${muted}`}>
            The steps before this one don't say what they make yet. Give them
            fields, and they show here.
          </span>
        ) : null}
      </div>
      {input ? (
        <div className="flex flex-col gap-1 pt-1">
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
          >
            {data.real
              ? `Last real record${data.from ? ` · ${data.from}` : ""}`
              : "A sample (nothing has reached this step yet)"}
          </span>
          <pre
            className={`m-0 p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all ${fieldBg} ${muted}`}
          >
            {clip(JSON.stringify(input, null, 1))}
          </pre>
        </div>
      ) : null}
      <span className={`text-xs ${muted}`}>
        Click a field to use it. Highlighted fields are the ones it uses.
      </span>
    </aside>
  );
};

export default WhatItGets;
