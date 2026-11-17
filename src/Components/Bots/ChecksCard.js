import React from "react";
import { FontAwesomeIcon, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { TONE, cardRows } from "./checksView";

/**
 * ChecksCard — a bot's own checks on the Bots diagram (bot-checks PRD
 * CHK-002, version B): a list right after the bot, top to bottom, each row
 * coloured by kind. A click opens the checks window. A bot with none gets a
 * dashed "+ Add checks" card (when it can be changed).
 *
 * @param {object} bot
 * @param {number} waiting  its jobs waiting for you
 * @param {boolean} canEdit
 * @param {(botId) => void} onOpen
 * @param {object} style    { left, top, width, height }
 */
export const ChecksCard = ({
  bot,
  waiting = 0,
  canEdit = true,
  onOpen,
  style,
}) => {
  const { muted, strong, hairline, fieldBg, selectedBorder } =
    useConfigTokens();
  const { rows, more, count } = cardRows(bot && bot.checks);
  if (!count) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        data-testid={`checks-card-${bot.id}`}
        aria-label={`Add checks — ${bot.name}`}
        onClick={() => onOpen && onOpen(bot.id)}
        className={`absolute rounded-xl border border-dashed px-3 flex flex-row items-center gap-2 text-xs ${hairline} ${muted}`}
        style={style}
      >
        <FontAwesomeIcon icon="plus" />
        <span>Add checks</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid={`checks-card-${bot.id}`}
      aria-label={`${bot.name}'s checks`}
      onClick={() => onOpen && onOpen(bot.id)}
      className={`absolute rounded-xl border px-2 py-1.5 flex flex-col gap-1 text-left ${fieldBg} ${
        waiting ? selectedBorder : hairline
      }`}
      style={style}
    >
      <span className="w-full flex flex-row items-center gap-2">
        <span
          className={`flex-1 text-xs font-semibold uppercase tracking-wide ${muted}`}
        >
          {`Checks · ${count}`}
        </span>
        {waiting ? (
          <StatusBadge state="info" compact label={`${waiting} waiting`} />
        ) : null}
      </span>
      {rows.map((r) => {
        const tone = TONE[r.tone];
        return (
          <span
            key={r.key}
            className="w-full flex flex-row items-center gap-1.5"
          >
            <span
              className={`flex-shrink-0 h-4 w-4 rounded flex items-center justify-center text-white ${tone.bg}`}
              title={tone.label}
            >
              <FontAwesomeIcon icon={tone.icon} size="2xs" />
            </span>
            <span className={`flex-1 min-w-0 text-xs truncate ${strong}`}>
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

export default ChecksCard;
