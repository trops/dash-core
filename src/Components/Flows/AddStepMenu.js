import React, { useEffect, useRef } from "react";
import { FlowKindChip, MenuItem } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

const CHOICES = [
  {
    kind: "check",
    title: "A check",
    help: "Passes or fails by rules you set. No AI.",
  },
  { kind: "bot", title: "A bot", help: "A bot works on it before it goes on" },
  {
    kind: "you",
    title: "You approve",
    help: "It waits for you before going on",
  },
];

/**
 * AddStepMenu — "Add between Writer and Sender" (frame 12): a check, a
 * bot, or you approving. Shown under the + on an arrow.
 */
export const AddStepMenu = ({ title, x = 0, y = 0, onPick, onClose }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const esc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      data-testid="add-step-menu"
      className={`absolute z-30 w-72 flex flex-col p-1.5 rounded-lg border shadow-xl ${hairline} ${fieldBg}`}
      style={{ left: Math.max(8, x - 144), top: y }}
    >
      <span
        className={`px-2.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide ${muted}`}
      >
        {title}
      </span>
      {CHOICES.map((c) => (
        <MenuItem
          key={c.kind}
          onClick={() => onPick(c.kind)}
          padding="px-2.5 py-2"
        >
          <span className="flex flex-col items-start gap-1">
            <span className="flex flex-row items-center gap-2">
              <FlowKindChip kind={c.kind} />
              <span className={`text-sm font-semibold ${strong}`}>
                {c.title}
              </span>
            </span>
            <span className={`text-xs ${muted}`}>{c.help}</span>
          </span>
        </MenuItem>
      ))}
    </div>
  );
};

export default AddStepMenu;
