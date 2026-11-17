import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowCount, flowLine } from "./flowText";

/**
 * FlowSwitcher — "Flow: Ticket to PR ▾" (frame 15). Lists the dashboard's
 * flows, each with its steps, what starts it and how many goals are in it
 * now; "+ New flow" at the bottom.
 */
export const FlowSwitcher = ({ flows = [], value = null, onChange, onNew }) => {
  const { muted, strong, hairline, selectedBg, fieldBg, accent } =
    useConfigTokens();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = flows.find((f) => f.id === value) || flows[0] || null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        data-testid="flow-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex flex-row items-center gap-2 px-3 py-1.5 rounded-md border ${hairline} ${fieldBg}`}
      >
        <span className={`text-xs ${muted}`}>Flow</span>
        <span className={`text-sm font-semibold ${strong}`}>
          {current ? current.name : "No flows"}
        </span>
        <FontAwesomeIcon icon="caret-down" className={`h-3 w-3 ${muted}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Flows"
          className={`absolute z-30 mt-1 w-80 flex flex-col p-1.5 rounded-lg border shadow-xl ${hairline} ${fieldBg}`}
        >
          {flows.map((f) => {
            const active = current && f.id === current.id;
            const count = flowCount(f);
            return (
              <button
                key={f.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  onChange(f.id);
                }}
                className={`flex flex-row items-start gap-2 text-left px-2.5 py-2 rounded-md ${active ? selectedBg : ""}`}
              >
                <span className="w-4 pt-0.5 flex-shrink-0">
                  {active ? (
                    <FontAwesomeIcon
                      icon="check"
                      className={`h-3.5 w-3.5 ${accent}`}
                    />
                  ) : null}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm font-semibold ${strong}`}>
                    {f.name}
                  </span>
                  <span className={`text-xs ${muted}`}>{flowLine(f)}</span>
                </span>
                {count ? (
                  <StatusBadge state={count.state} label={count.label} />
                ) : null}
              </button>
            );
          })}
          <div
            className={`mt-1 pt-2 border-t ${hairline} flex flex-col gap-1.5 px-2.5 pb-2`}
          >
            <button
              type="button"
              className={`text-sm font-semibold text-left ${accent}`}
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              + New flow
            </button>
            <span className={`text-xs ${muted}`}>
              Each goal follows one flow. A goal starts in the flow whose first
              step started it.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FlowSwitcher;
