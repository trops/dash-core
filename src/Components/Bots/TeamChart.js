import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ButtonIcon } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { STATUS_DOT, triggerSummary } from "./teamUtils";
import {
  diagramEdges,
  diagramLayout,
  eventText,
  loopEdges,
  parseBotEventType,
} from "./teamDiagram";
import { TriggerPopover } from "./TriggerPopover";

const CARD_H = 80;
const POP_W = 320;
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
 * dashed: failed). Cards select a bot and open its Conversation / Activity /
 * Settings.
 *
 * Wiring (slice 2, when `canWire`): drag from a bot's bottom handle onto
 * another team bot (not the lead, not itself) to add a trigger; click a
 * line's label to change or remove it. Saving goes through `onSaveTrigger` /
 * `onRemoveTrigger` (the host saves the bot).
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
  canWire = false,
  choicesFor = () => [],
  onSaveTrigger = null,
  onRemoveTrigger = null,
  width: fixedWidth = 0,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder, fieldBg } =
    useConfigTokens();
  const ref = useRef(null);
  const width = useWidth(ref, fixedWidth);
  const [hovered, setHovered] = useState(null);
  // Dragging from a bot's handle: { from, x, y } (pointer, in chart space).
  const [drag, setDrag] = useState(null);
  // The open popover: { mode, from, to, oldEventType, event, note }.
  const [pop, setPop] = useState(null);
  const [popError, setPopError] = useState(null);
  const [saving, setSaving] = useState(false);

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
  const byId = new Map(
    [lead, ...members].filter(Boolean).map((b) => [b.id, b]),
  );
  const isMember = (id) => members.some((b) => b.id === id);

  const edges = diagramEdges(members, lead);
  const loops = loopEdges(edges);
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

  // ── Wiring ────────────────────────────────────────────────────────────
  const canDrop = (id) => !!drag && id !== drag.from && isMember(id);
  const pointIn = (e) => {
    const r = ref.current ? ref.current.getBoundingClientRect() : null;
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
  };
  // Follow the pointer; a release anywhere that isn't a bot ends the drag.
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const p = pointIn(e);
      if (p) setDrag((d) => (d ? { ...d, ...p } : d));
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const openPop = (next) => {
    setPopError(null);
    setPop(next);
  };
  const dropOn = (id) => {
    if (!canDrop(id)) return;
    openPop({
      mode: "add",
      from: drag.from,
      to: id,
      oldEventType: null,
      event: null,
      note: "",
    });
    setDrag(null);
  };
  const editLine = (e) => {
    if (!canWire) return;
    openPop({
      mode: "edit",
      from: e.from,
      to: e.to,
      oldEventType: e.eventType,
      event: e.event,
      note: e.note || "",
    });
  };
  const savePop = async ({ event, label, note }) => {
    if (!pop || !onSaveTrigger) return;
    setSaving(true);
    try {
      await onSaveTrigger({
        mode: pop.mode,
        sourceId: pop.from,
        targetId: pop.to,
        oldEventType: pop.oldEventType,
        event,
        label,
        note,
      });
      setPop(null);
    } catch (err) {
      setPopError(`Couldn't save: ${(err && err.message) || String(err)}`);
    } finally {
      setSaving(false);
    }
  };
  const removePop = async () => {
    if (!pop || !onRemoveTrigger) return;
    setSaving(true);
    try {
      await onRemoveTrigger({ targetId: pop.to, eventType: pop.oldEventType });
      setPop(null);
    } catch (err) {
      setPopError(`Couldn't remove: ${(err && err.message) || String(err)}`);
    } finally {
      setSaving(false);
    }
  };
  // Would the new / changed trigger close a loop?
  const popLoop = (() => {
    if (!pop) return false;
    if (pop.mode === "edit") {
      return loops.has(`${pop.to}|${pop.oldEventType}`);
    }
    return loopEdges([
      ...edges,
      { key: "new", from: pop.from, to: pop.to },
    ]).has("new");
  })();
  const popStyle = (() => {
    if (!pop || !pos[pop.to]) return null;
    const t = pos[pop.to];
    const left = Math.max(
      8,
      Math.min(t.x + t.w / 2 - POP_W / 2, layout.width - POP_W - 8),
    );
    return { left, top: t.y + CARD_H + 16 };
  })();

  const card = (bot) => {
    const p = pos[bot.id];
    if (!p) return null;
    const isLead = bot.role === "lead";
    const active = bot.id === selectedId;
    const status = statusOf(bot.id);
    const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
    const waiting = (approvalsFor(bot.id) || []).length > 0;
    const showActions = !drag && (active || hovered === bot.id);
    const dropping = !!drag;
    const droppable = canDrop(bot.id);
    const actions = [
      ["conversation", isLead ? "Ask the lead" : "Conversation", "comment"],
      ["activity", "Activity", "wave-square"],
      ["settings", "Settings", "gear"],
    ];
    const frame = droppable
      ? hovered === bot.id
        ? "border-green-400"
        : selectedBorder
      : active
        ? selectedBorder
        : hairline;
    return (
      <div
        key={bot.id}
        data-testid={`diagram-card-${bot.id}`}
        className="absolute"
        style={{
          left: p.x,
          top: p.y,
          width: p.w,
          height: CARD_H,
          opacity: dropping && !droppable ? 0.45 : 1,
        }}
        onMouseEnter={() => setHovered(bot.id)}
        onMouseLeave={() => setHovered((h) => (h === bot.id ? null : h))}
        onPointerEnter={() => setHovered(bot.id)}
        onPointerUp={() => dropOn(bot.id)}
      >
        <button
          type="button"
          aria-label={bot.name}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect && onSelect(bot.id)}
          className={`w-full h-full text-left rounded-xl border p-3 flex flex-row items-start gap-3 ${frame} ${
            active ? selectedBg : fieldBg
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
        {canWire && !isLead && isMember(bot.id) ? (
          <button
            type="button"
            aria-label={`Drag to wire ${bot.name}`}
            title="Drag to another bot to add a trigger"
            className={`absolute h-4 w-4 rounded-full border-2 border-indigo-400 ${fieldBg}`}
            style={{
              left: p.w / 2 - 8,
              top: CARD_H - 8,
              touchAction: "none",
              cursor: "crosshair",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPop(null);
              const pt = pointIn(e) || {
                x: p.x + p.w / 2,
                y: p.y + CARD_H,
              };
              setDrag({ from: bot.id, ...pt });
            }}
          />
        ) : null}
      </div>
    );
  };

  const ghost = (() => {
    if (!drag || !pos[drag.from]) return null;
    const a = pos[drag.from];
    const sx = a.x + a.w / 2;
    const sy = a.y + CARD_H;
    const tx = drag.x == null ? sx : drag.x;
    const ty = drag.y == null ? sy : drag.y;
    return `M${sx},${sy} C${sx},${sy + 80} ${tx},${ty + 80} ${tx},${ty}`;
  })();

  // An open popover makes room for itself below the cards (the view scrolls).
  const POP_ROOM = 480;
  const height = popStyle
    ? Math.max(layout.height, popStyle.top + POP_ROOM)
    : layout.height;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
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
        {ghost ? (
          <path
            d={ghost}
            className="text-indigo-400"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 4"
            fill="none"
          />
        ) : null}
      </svg>
      {drawn.map((e) => {
        const looped = loops.has(e.key);
        return (
          <button
            type="button"
            key={`label-${e.key}`}
            data-testid={`edge-label-${e.key}`}
            title={
              looped
                ? "Part of a loop — loops stop after 5 runs"
                : e.note || e.label || undefined
            }
            onClick={() => editLine(e)}
            disabled={!canWire}
            className={`absolute rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${fieldBg} ${
              looped ? "border-amber-400" : hairline
            } ${touches(e) ? strong : muted}`}
            style={{
              left: e.mx,
              top: e.my,
              transform: "translate(-50%, -50%)",
            }}
          >
            {`${eventText(e.event)}${looped ? " · loop" : ""}`}
          </button>
        );
      })}
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
      {pop && byId.get(pop.from) && byId.get(pop.to) ? (
        <TriggerPopover
          key={`${pop.mode}-${pop.from}-${pop.to}-${pop.oldEventType || ""}`}
          source={byId.get(pop.from)}
          target={byId.get(pop.to)}
          choices={choicesFor(pop.from)}
          mode={pop.mode}
          initialEvent={
            pop.oldEventType
              ? (parseBotEventType(pop.oldEventType) || {}).event
              : null
          }
          initialNote={pop.note}
          loop={popLoop}
          error={popError}
          saving={saving}
          style={popStyle}
          onSave={savePop}
          onRemove={removePop}
          onCancel={() => setPop(null)}
        />
      ) : null}
    </div>
  );
};

export default TeamChart;
