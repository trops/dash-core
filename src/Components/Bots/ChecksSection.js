import React from "react";
import { FontAwesomeIcon, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { TONE, cardRows } from "./checksView";

// Its height on the diagram, so every bot's box can take the tallest one:
// a divider, padding, the header, and a line per row (2 and "+N more" past
// 3). "Add checks" alone is one line.
const SECTION_PAD = 33;
const LINE_H = 20;
export function sectionHeight(bot, canEdit) {
  const { rows, more, count } = cardRows(bot && bot.checks);
  if (!count) return canEdit ? SECTION_PAD : 0;
  return SECTION_PAD + (rows.length + (more ? 1 : 0)) * LINE_H;
}

/**
 * ChecksSection — a bot's own checks inside its box on the Bots diagram
 * (bot-checks PRD CHK-002, DASH-12): under a divider, top to bottom, each
 * row with its kind mark (R rule, ›_ command, AI reviewer, You) and its
 * name on up to two lines (full name on hover), with what they're doing now (`live`, liveChecks):
 * "Checking · try 1 of 3" with a spinner on the check being run, "Sent
 * back · try 2 of 3", "Checking 2 jobs", and "N needs you".
 *
 * A click opens the job being worked on or waiting for you
 * (`onOpenJob(goalId, workspaceId)`), otherwise the checks window
 * (`onOpen(botId)`). A bot with none gets an "Add checks" row when it can
 * be changed, and nothing otherwise.
 */
export const ChecksSection = ({
  bot,
  live = null,
  canEdit = true,
  onOpen,
  onOpenJob,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { rows, more, count } = cardRows(bot && bot.checks);
  if (!count) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        data-testid={`checks-section-${bot.id}`}
        aria-label={`Add checks — ${bot.name}`}
        onClick={() => onOpen && onOpen(bot.id)}
        className={`w-full border-t px-3 py-2 flex flex-row items-center gap-2 text-xs ${hairline} ${muted}`}
      >
        <FontAwesomeIcon icon="plus" />
        <span>Add checks</span>
      </button>
    );
  }
  const header = live && live.header;
  // Waiting for a paused bot: nothing is running, so nothing spins.
  const waiting = !!(live && live.waiting);
  const needs = (live && live.needs) || 0;
  const goalId = live && live.goalId;
  // The check being run spins in its row; when it isn't shown (past "+N
  // more", or several jobs), the header spins instead.
  const running = header && live.stepId;
  const rowSpins = running && rows.some((r) => r.key === live.stepId);
  const open = () => {
    if (goalId && onOpenJob) onOpenJob(goalId, live.workspaceId);
    else if (onOpen) onOpen(bot.id);
  };
  return (
    <button
      type="button"
      data-testid={`checks-section-${bot.id}`}
      aria-label={[
        `${bot.name}'s checks`,
        header || `${count} ${count === 1 ? "check" : "checks"}`,
        needs ? `${needs} needs you` : null,
        goalId ? "open the job" : null,
      ]
        .filter(Boolean)
        .join(" — ")}
      onClick={open}
      className={`w-full border-t px-3 py-2 flex flex-col gap-1 text-left ${hairline}`}
    >
      <span className="w-full flex flex-row items-center gap-2">
        <span
          className={`flex-1 min-w-0 flex flex-row items-center gap-1.5 text-xs font-semibold uppercase tracking-wide truncate ${
            waiting ? "text-amber-300" : header ? "text-indigo-300" : muted
          }`}
        >
          {header && !rowSpins && !waiting ? (
            <FontAwesomeIcon icon="spinner" className="animate-spin" />
          ) : null}
          <span className="truncate">{header || `Checks · ${count}`}</span>
        </span>
        {needs ? (
          <StatusBadge state="warning" compact label={`${needs} needs you`} />
        ) : null}
      </span>
      {rows.map((r) => {
        const tone = TONE[r.tone];
        const spins = rowSpins && r.key === live.stepId;
        return (
          <span
            key={r.key}
            data-testid={spins ? "check-running" : undefined}
            title={r.name}
            className={`w-full flex flex-row items-start gap-1.5 ${
              header && !spins ? "opacity-50" : ""
            }`}
          >
            {spins ? (
              <span className="flex-shrink-0 h-4 w-4 flex items-center justify-center text-indigo-300">
                <FontAwesomeIcon icon="spinner" className="animate-spin" />
              </span>
            ) : (
              // The kind mark (DASH-139): R, ›_, AI or You.
              <span
                className={`flex-shrink-0 h-4 rounded px-1 flex items-center justify-center text-white font-bold ${tone.bg}`}
                style={{ minWidth: 16, fontSize: 9, marginTop: 1 }}
                title={tone.label}
                aria-label={tone.label}
              >
                {tone.short}
              </span>
            )}
            {/* Names wrap to two lines; the full name is on hover. */}
            <span className={`flex-1 min-w-0 text-xs line-clamp-2 ${strong}`}>
              {r.name}
            </span>
          </span>
        );
      })}
      {more ? (
        <span className={`text-xs ${muted}`}>{`+${more} more`}</span>
      ) : null}
    </button>
  );
};

export default ChecksSection;
