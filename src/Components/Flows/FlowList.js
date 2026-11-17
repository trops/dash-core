import React from "react";
import { Button } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { plural } from "./flowText";

/** Where a flow's jobs come from, in a few words. */
export function jobsStart(flow) {
  const starts = (flow.steps || []).some((s) => s.kind === "source");
  // Briefs written before jobs were called jobs.
  const brief = String(flow.brief || "").replace(/\bgoal(s?)\b/g, "job$1");
  if (!starts) return "you start jobs by hand";
  return brief ? `jobs start ${brief}` : "jobs start by themselves";
}

/** "1 waiting for you · 2 running", "No jobs now". */
export function jobsNow(flow) {
  const w = (flow && flow.where) || {};
  const counts = Object.values(w.counts || {});
  const waiting = counts.reduce(
    (n, c) => n + (c.ready || 0) + (c.stopped || 0),
    0,
  );
  const parts = [];
  if (waiting) parts.push(`${waiting} waiting for you`);
  if (w.running) parts.push(`${w.running} running`);
  if (!parts.length && w.total) parts.push(plural(w.total, "job"));
  return { text: parts.join(" · ") || "No jobs now", waiting: waiting > 0 };
}

/**
 * FlowList — the Flows tab's list (polish batch): every flow on the
 * dashboard, with how many steps it has, where its jobs come from and
 * where they are now. Picking one shows it, whole, beside the list.
 */
export const FlowList = ({ flows = [], value = null, onPick, onNew }) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
  return (
    <div
      data-testid="flow-list"
      className={`w-72 flex-shrink-0 min-h-0 flex flex-col gap-1.5 p-3 border-r ${hairline}`}
    >
      <div className="flex flex-row items-center gap-2 px-1 pb-2">
        <span
          className={`flex-1 text-xs font-semibold uppercase tracking-wide ${muted}`}
        >
          {`Flows · ${flows.length}`}
        </span>
        <Button title="New flow" size="sm" onClick={onNew} />
      </div>
      <div
        role="listbox"
        aria-label="Flows"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1"
      >
        {flows.map((f) => {
          const on = f.id === value;
          const now = jobsNow(f);
          return (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={on}
              data-testid={`flow-row-${f.id}`}
              onClick={() => onPick(f.id)}
              className={`w-full text-left flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border ${
                on ? `${selectedBorder} ${selectedBg}` : "border-transparent"
              }`}
            >
              <span className={`text-sm font-semibold ${strong}`}>
                {f.name}
              </span>
              <span className={`text-xs ${muted}`}>
                {`${plural((f.steps || []).length, "step")} · ${jobsStart(f)}`}
              </span>
              <span
                className={`text-xs ${now.waiting ? "font-semibold" : ""} ${now.waiting ? strong : muted}`}
              >
                {now.text}
              </span>
            </button>
          );
        })}
      </div>
      <span className={`text-xs px-1 pt-2 ${muted}`}>
        A flow is how work gets done. Each job is one piece of work going
        through it, from the first step to the last.
      </span>
    </div>
  );
};

export default FlowList;
