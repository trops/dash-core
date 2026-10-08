import React, { useLayoutEffect, useRef, useState } from "react";
import { ButtonIcon } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { STATUS_DOT, triggerSummary } from "./teamUtils";
import { diagramEdges, diagramLayout, eventText } from "./teamDiagram";

const CARD_H = 80;
// Line colours: after failed → red, otherwise indigo (classes in the prebuilt CSS).
const lineClass = (kind) =>
  kind === "failed" ? "text-red-400" : "text-indigo-400";

/** The container's width, kept up to date (a fixed `width` wins — tests). */
function useWidth(ref, fixed) {
  const [width, setWidth] = useState(fixed || 0);
  useLayoutEffect(() => {
    if (fixed) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fixed]);
  return fixed || width;
}

/**
 * TeamChart — a dashboard's team as an org chart (bot-teams PRD TEAM-014):
 * the lead on top, the team's bots in rows below, and a line from a bot to
 * each bot that runs after one of its events (solid: completed / a tool;
 * dashed: failed). Read-only wiring; cards select a bot and open its
 * Conversation / Activity / Settings.
 *
 * Card positions come from the measured width (inline styles — the prebuilt
 * CSS has no arbitrary sizes); colours from theme tokens and colour classes.
 * (Named TeamChart: teamDiagram.js holds the pure helpers, and macOS file
 * names ignore case.)
 */
export const TeamChart = ({
  lead = null,
  members = [],
  selectedId = null,
  statusOf = () => "Idle",
  approvalsFor = () => [],
  onSelect,
  onOpen,
  width: fixedWidth = 0,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder, fieldBg } =
    useConfigTokens();
  const ref = useRef(null);
  const width = useWidth(ref, fixedWidth);
  const [hovered, setHovered] = useState(null);

  const layout = diagramLayout({
    width,
    count: members.length,
    cardH: CARD_H,
  });
  const pos = {};
  members.forEach((b, i) => {
    pos[b.id] = { ...layout.cards[i], w: layout.cardW };
  });
  if (lead) pos[lead.id] = { ...layout.lead };

  const edges = diagramEdges(members, lead);
  // Lines between the same two bots get their own curve depth.
  const pairCount = {};
  const drawn = edges.map((e) => {
    const pair = [e.from, e.to].sort().join("|");
    const nth = (pairCount[pair] = (pairCount[pair] || 0) + 1) - 1;
    const a = pos[e.from];
    const b = pos[e.to];
    const sx = a.x + a.w / 2;
    const sy = a.y + CARD_H;
    const tx = b.x + b.w / 2;
    const ty = b.y + CARD_H;
    const dip = 60 + Math.abs(tx - sx) * 0.12 + nth * 26;
    return {
      ...e,
      d: `M${sx},${sy} C${sx},${sy + dip} ${tx},${ty + dip} ${tx},${ty}`,
      mx: (sx + tx) / 2,
      my: Math.max(sy, ty) + dip * 0.75,
    };
  });
  // Lines of the selected bot stand out and the rest fade — only when it
  // has lines (selecting the lead, or a bot with none, fades nothing).
  const focusId =
    selectedId &&
    edges.some((e) => e.from === selectedId || e.to === selectedId)
      ? selectedId
      : null;
  const touches = (e) => !focusId || e.from === focusId || e.to === focusId;

  // Team lines: lead → a bar → each bot in the first row.
  const firstRow = members.slice(0, layout.cols);
  const teamLines = [];
  if (lead && firstRow.length) {
    const lx = layout.lead.x + layout.lead.w / 2;
    teamLines.push(`M${lx},${layout.lead.y + CARD_H} V${layout.busY}`);
    const xs = firstRow.map((b) => pos[b.id].x + layout.cardW / 2);
    teamLines.push(
      `M${Math.min(...xs, lx)},${layout.busY} H${Math.max(...xs, lx)}`,
    );
    for (const b of firstRow) {
      teamLines.push(
        `M${pos[b.id].x + layout.cardW / 2},${layout.busY} V${pos[b.id].y}`,
      );
    }
  }

  const card = (bot) => {
    const p = pos[bot.id];
    if (!p) return null;
    const isLead = bot.role === "lead";
    const active = bot.id === selectedId;
    const status = statusOf(bot.id);
    const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
    const waiting = (approvalsFor(bot.id) || []).length > 0;
    const showActions = active || hovered === bot.id;
    const actions = [
      ["conversation", isLead ? "Ask the lead" : "Conversation", "comment"],
      ["activity", "Activity", "wave-square"],
      ["settings", "Settings", "gear"],
    ];
    return (
      <div
        key={bot.id}
        data-testid={`diagram-card-${bot.id}`}
        className="absolute"
        style={{ left: p.x, top: p.y, width: p.w, height: CARD_H }}
        onMouseEnter={() => setHovered(bot.id)}
        onMouseLeave={() => setHovered((h) => (h === bot.id ? null : h))}
      >
        <button
          type="button"
          aria-label={bot.name}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect && onSelect(bot.id)}
          className={`w-full h-full text-left rounded-xl border p-3 flex flex-row items-start gap-3 ${
            active
              ? `${selectedBg} ${selectedBorder}`
              : `${fieldBg} ${hairline}`
          }`}
        >
          <BotAvatar bot={bot} />
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="flex flex-row items-start gap-2">
              <span
                className={`flex-1 min-w-0 text-sm font-semibold line-clamp-2 ${strong}`}
              >
                {bot.name}
              </span>
              <span
                role="img"
                aria-label={status}
                title={status}
                className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${dot}`}
              />
            </span>
            <span className={`text-xs truncate ${muted}`}>
              {isLead ? "Lead" : triggerSummary(bot)}
            </span>
          </span>
        </button>
        {waiting ? (
          <button
            type="button"
            onClick={() => onOpen && onOpen(bot.id, "activity")}
            className="absolute left-3 rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-400 text-amber-950"
            style={{ top: -9 }}
          >
            Needs approval
          </button>
        ) : null}
        {showActions ? (
          <span
            className="absolute right-2 flex flex-row gap-1"
            style={{ top: -13 }}
          >
            {actions.map(([tab, label, icon]) => (
              <ButtonIcon
                key={tab}
                icon={icon}
                size="xs"
                ariaLabel={`${label} — ${bot.name}`}
                onClick={() => onOpen && onOpen(bot.id, tab)}
              />
            ))}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height: layout.height }}
    >
      <svg
        className="absolute inset-0 pointer-events-none"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        {teamLines.map((d) => (
          <path
            key={d}
            d={d}
            className={muted}
            stroke="currentColor"
            strokeOpacity="0.45"
            fill="none"
          />
        ))}
        {drawn.map((e) => (
          <path
            key={e.key}
            data-testid="diagram-edge"
            data-kind={e.kind}
            d={e.d}
            className={lineClass(e.kind)}
            stroke="currentColor"
            strokeWidth={touches(e) && focusId ? 2.5 : 1.75}
            strokeOpacity={touches(e) ? 1 : 0.3}
            strokeDasharray={e.kind === "failed" ? "6 5" : undefined}
            fill="none"
          />
        ))}
      </svg>
      {drawn.map((e) => (
        <span
          key={`label-${e.key}`}
          data-testid={`edge-label-${e.key}`}
          title={e.label || undefined}
          className={`absolute rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${fieldBg} ${hairline} ${
            touches(e) ? strong : muted
          }`}
          style={{
            left: e.mx,
            top: e.my,
            transform: "translate(-50%, -50%)",
          }}
        >
          {eventText(e.event)}
        </span>
      ))}
      {lead ? card(lead) : null}
      {members.map(card)}
      {!members.length ? (
        <div
          className={`absolute text-sm text-center ${muted}`}
          style={{ left: 0, right: 0, top: layout.lead.y + CARD_H + 40 }}
        >
          No bots yet — + Add bot.
        </div>
      ) : null}
    </div>
  );
};

export default TeamChart;
