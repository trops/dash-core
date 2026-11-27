import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/**
 * A bot's Settings tab as accordion sections (DASH-127, screen 7b): each
 * expands in place to show the settings in it, more than one can be open,
 * and they start collapsed except one with something to fill in.
 */

// The sections, in their order.
export const SETTINGS_SECTIONS = [
  { id: "instructions", title: "Instructions, model and engine" },
  { id: "access", title: "Approval policy, folders and shell commands" },
  { id: "sends", title: "Sends its work to" },
  { id: "budget", title: "Budget and schedule" },
  { id: "job", title: "Settings for its job" },
];

// Where a focused field (BotDetail's `focus`, DASH-115) lives.
const FOCUS_SECTION = {
  commands: "access",
  folders: "access",
  tools: "access",
  providers: "access",
};

/**
 * Which sections start open: the one a focused field is in, else the first
 * with something still to fill in (`needs`: { [id]: boolean }), else none.
 * @returns {string[]}
 */
export function startOpen({ focus = null, needs = {} } = {}) {
  if (focus && FOCUS_SECTION[focus]) return [FOCUS_SECTION[focus]];
  const first = SETTINGS_SECTIONS.find((s) => needs && needs[s.id]);
  return first ? [first.id] : [];
}

/** The open list with `id` opened or closed. */
export function toggleOpen(open, id) {
  const list = Array.isArray(open) ? open : [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * One section: its title row toggles it. Closed, its settings stay mounted
 * (nothing typed is lost) but aren't shown.
 */
export const SettingsSection = ({
  id,
  title,
  open = false,
  onToggle,
  note = null,
  children,
}) => {
  const { muted, strong, hairline, selectedBorder } = useConfigTokens();
  const bodyId = `settings-section-${id}-body`;
  return (
    <section
      aria-label={title}
      className={`flex flex-col rounded-lg border ${open ? selectedBorder : hairline}`}
      data-testid={`settings-section-${id}`}
    >
      <button
        type="button"
        className="flex flex-row items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle && onToggle(id)}
      >
        <span className={`flex-1 min-w-0 text-sm font-semibold ${strong}`}>
          {title}
        </span>
        {note ? <span className={`text-xs ${muted}`}>{note}</span> : null}
        <FontAwesomeIcon
          icon={open ? "chevron-up" : "chevron-down"}
          className={muted}
        />
      </button>
      <div
        id={bodyId}
        className={open ? "flex flex-col gap-4 px-4 pb-4" : "hidden"}
        data-open={open ? "true" : "false"}
      >
        {children}
      </div>
    </section>
  );
};

export default SettingsSection;
