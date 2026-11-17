import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ButtonIcon } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { ChecksCard } from "./ChecksCard";
import { STATUS_DOT, triggerSummary } from "./teamUtils";
import {
  PILL_H,
  arrowHead,
  diagramEdges,
  diagramLayout,
  eventText,
  loopEdges,
  neighbourLine,
  parseBotEventType,
} from "./teamDiagram";
import { TriggerPopover } from "./TriggerPopover";
import { WidgetWirePopover } from "./WidgetWirePopover";
import { LANE, routeWidgets, widgetEdges, widgetSub } from "./widgetDiagram";

const CARD_H = 80;
// Room between bots side by side for a line and its label.
const BOT_GAP = 80;
const BOT_MIN_W = 184;
const BOT_MAX_W = 240;
// Each bot's checks card sits right after it (bot-checks CHK-002): a slot
// is the bot, a short arrow, and its checks. A bot with none gets a narrower
// "+ Add checks" card in the same place.
const CHK_W = 150;
const CHK_GAP = 28;
const ADD_W = 120;
const ADD_H = 36;
const POP_W = 320;
// Widget cards (TD-009): in a column right of the team when it's this wide.
const W_CARD_H = 64;
const W_COL = 260;
const W_SIDE_MIN = 900;
const W_POP_W = 384;
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
 * Widgets (team-dashboards TD-009, when `widgets` are given): the
 * dashboard's widgets, beside the team or below it, with a line from a bot
 * to each widget that shows what it sends. Drag a bot onto a widget to
 * connect it (`onConnectWidget`, `onShowHere`) or to ask the Dash team to
 * make the widget show it (`onAskWidget`); click such a line's label to
 * change or remove it (`onRemoveWidgetLine`). Lines only go from a bot to a
 * widget.
 *
 * Checks (bot-checks CHK-002): each bot's own checks are a list card right
 * after it, and its lines leave from there — its work goes on only once it
 * passes them. A click opens the checks window (`onOpenChecks`); a bot with
 * none gets "+ Add checks" while it can be changed. `waitingFor(id)`: its
 * jobs waiting for you.
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
  widgets = [],
  nameOf = () => null,
  onConnectWidget = null,
  onShowHere = null,
  onAskWidget = null,
  onRemoveWidgetLine = null,
  findWidgetTarget = null,
  waitingFor = () => 0,
  onOpenChecks = null,
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
  // The open bot → widget dialog: { mode, from, widget (key), edge }.
  const [wpop, setWpop] = useState(null);

  const hasWidgets = widgets.length > 0;
  const side = hasWidgets && width >= W_SIDE_MIN;
  const teamWidth = side ? width - W_COL - 40 : width;
  const edges = diagramEdges(members, lead);
  const loops = loopEdges(edges);
  const labelText = (e) =>
    `${eventText(e.event)}${loops.has(e.key) ? " · loop" : ""}`;
  const widgetLabel = (e) =>
    e.kind === "results" ? "shows answers" : eventText(e.event);
  const allWEdges = hasWidgets ? widgetEdges(widgets, members) : [];
  const checkCount = (b) => ((b && b.checks && b.checks.steps) || []).length;
  // A bot shows a checks card when it has checks, or "+ Add checks" when
  // they can be changed.
  const hasChecksCard = (b) => checkCount(b) > 0 || !!(canWire && onOpenChecks);

  /** Cards, bot lines and widget lines for one row height. */
  // Room for checks only when some bot shows a card.
  const room = members.some(hasChecksCard) ? CHK_GAP + CHK_W : 0;
  const build = (rowH) => {
    const layout = diagramLayout({
      width: teamWidth,
      count: members.length,
      cardH: CARD_H,
      gap: BOT_GAP,
      minW: BOT_MIN_W + room,
      maxW: BOT_MAX_W + room,
      ...(rowH ? { rowH } : {}),
    });
    // A member's slot: the bot (botW) then its checks card at chkX. `w`
    // ends at its checks card when it has one, so lines across to the next
    // bot leave from there; `outX` is where its lines leave from below.
    const slotW = layout.cardW;
    const botW = slotW - room;
    const pos = {};
    members.forEach((b, i) => {
      const c = layout.cards[i];
      const chkX = c.x + botW + CHK_GAP;
      const card = hasChecksCard(b);
      pos[b.id] = {
        ...c,
        w: !card ? botW : checkCount(b) ? slotW : botW + CHK_GAP + ADD_W,
        botW,
        slotW,
        chkX,
        outX: card
          ? chkX + (checkCount(b) ? CHK_W : ADD_W) / 2
          : c.x + botW / 2,
      };
    });
    if (lead) pos[lead.id] = { ...layout.lead };
    const botMid = (p) => p.x + (p.botW || p.w) / 2;
    const outMid = (p) => (p.outX != null ? p.outX : p.x + p.w / 2);
    // Lines between the same two bots: how many, and which this one is.
    const pairTotal = {};
    for (const e of edges) {
      const pair = [e.from, e.to].sort().join("|");
      pairTotal[pair] = (pairTotal[pair] || 0) + 1;
    }
    const pairCount = {};
    const drawn = edges.map((e) => {
      const pair = [e.from, e.to].sort().join("|");
      const nth = (pairCount[pair] = (pairCount[pair] || 0) + 1) - 1;
      const a = pos[e.from];
      const b = pos[e.to];
      // Neighbours in a row, left to right: straight across the gap from
      // the first one's checks to the next bot. (Right to left would leave
      // from the bot, not its checks: those dip below instead.)
      const across =
        a && b && a.col < b.col
          ? neighbourLine(a, b, {
              cardH: CARD_H,
              slot: nth,
              slots: pairTotal[pair],
              text: labelText(e),
            })
          : null;
      if (across) return { ...e, ...across };
      // A bot on the next row: down from the checks into the gap between
      // the rows, along, and into the top of the bot — clear of both rows.
      if (a && b && a.botW && b.row === a.row + 1) {
        const sx = outMid(a);
        const tx = botMid(b);
        const y = b.y - 18 - nth * 8;
        return {
          ...e,
          d: `M${sx},${a.y + CARD_H} V${y} H${tx} V${b.y}`,
          head: arrowHead(tx, b.y, "down"),
          mx: (sx + tx) / 2,
          my: y,
        };
      }
      const sx = outMid(a);
      const sy = a.y + CARD_H;
      const tx = botMid(b);
      const ty = b.y + CARD_H;
      const dip = 60 + Math.abs(tx - sx) * 0.12 + nth * 26;
      return {
        ...e,
        d: `M${sx},${sy} C${sx},${sy + dip} ${tx},${ty + dip} ${tx},${ty}`,
        head: arrowHead(tx, ty, "up"),
        mx: (sx + tx) / 2,
        my: Math.max(sy, ty) + dip * 0.75,
        curve: true,
      };
    });
    const lastBottom = members.length
      ? layout.cards[members.length - 1].y + CARD_H
      : layout.lead.y + CARD_H;
    const below = Math.max(
      lastBottom,
      ...drawn.filter((e) => e.curve).map((e) => e.my + PILL_H / 2 + 4),
    );
    const routed = hasWidgets
      ? routeWidgets({
          width: Math.max(width || 0, layout.width),
          side,
          team: {
            cards: members.map((b) => ({
              id: b.id,
              ...pos[b.id],
            })),
            cols: layout.cols,
            cardH: CARD_H,
            gap: layout.gap,
            lead: lead ? layout.lead : null,
          },
          widgets,
          edges: allWEdges,
          below,
          colW: W_COL,
          cardH: W_CARD_H,
          labelOf: widgetLabel,
        })
      : null;
    return { layout, pos, drawn, routed };
  };
  let built = build(0);
  // More than 3 widget lines under a row: give that gap more height.
  if (built.routed && built.routed.crowded > 3) {
    built = build(CARD_H + LANE * (built.routed.crowded + 1) + 16);
  }
  const { layout, pos, drawn, routed } = built;
  const byId = new Map(
    [lead, ...members].filter(Boolean).map((b) => [b.id, b]),
  );
  const isMember = (id) => members.some((b) => b.id === id);

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
    const mid = (b) => pos[b.id].x + pos[b.id].botW / 2;
    const xs = firstRow.map(mid);
    teamLines.push(
      `M${Math.min(...xs, lx)},${layout.busY} H${Math.max(...xs, lx)}`,
    );
    for (const b of firstRow) {
      teamLines.push(`M${mid(b)},${layout.busY} V${pos[b.id].y}`);
    }
  }
  // Each bot's work goes into its checks: a short arrow between them.
  const checkArrows = members
    .filter((b) => checkCount(b) > 0 && pos[b.id])
    .map((b) => {
      const p = pos[b.id];
      const y = p.y + CARD_H / 2;
      return {
        key: b.id,
        d: `M${p.x + p.botW},${y} L${p.chkX},${y}`,
        head: arrowHead(p.chkX, y, "right", 5),
      };
    });

  // ── Widgets (TD-009) ────────────────────────────────────────────────
  const fullW = Math.max(width || 0, layout.width);
  const wpos = routed ? routed.cards : {};
  const widgetByKey = new Map(widgets.map((w) => [w.key, w]));
  const wDrawn = routed ? routed.lines : [];
  const wFocus = (e) => !focusId || e.from === focusId;

  // ── Wiring ────────────────────────────────────────────────────────────
  const canDrop = (id) => !!drag && id !== drag.from && isMember(id);
  const canDropWidget = () => !!drag && isMember(drag.from);
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
    setWpop(null);
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
  // A bot dropped on a widget, or a widget line's label clicked.
  const openWpop = (next) => {
    setPopError(null);
    setPop(null);
    setWpop(next);
  };
  const dropOnWidget = (key) => {
    if (!canDropWidget()) return;
    openWpop({ mode: "add", from: drag.from, widget: key, edge: null });
    setDrag(null);
  };
  const editWidgetLine = (e) => {
    if (!canWire) return;
    openWpop({ mode: "edit", from: e.from, widget: e.widget, edge: e });
  };
  // Saves through the host; the dialog stays open with the reason if it
  // can't.
  const wsave = async (fn) => {
    setSaving(true);
    try {
      await fn();
      setWpop(null);
    } catch (err) {
      setPopError(
        err && err.refused
          ? err.message
          : `Couldn't save: ${(err && err.message) || String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };
  const wWidget = wpop ? widgetByKey.get(wpop.widget) : null;
  const wSource = wpop ? byId.get(wpop.from) : null;
  const wpopStyle = (() => {
    if (!wpop || !wpos[wpop.widget]) return null;
    const b = wpos[wpop.widget];
    if (side) {
      return {
        left: Math.max(8, b.x - W_POP_W - 16),
        top: Math.max(8, b.y - 8),
      };
    }
    return {
      left: Math.max(
        8,
        Math.min(b.x + b.w / 2 - W_POP_W / 2, fullW - W_POP_W - 8),
      ),
      top: b.y + W_CARD_H + 12,
    };
  })();

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
      Math.min(t.x + t.w / 2 - POP_W / 2, fullW - POP_W - 8),
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
    // Only the lead is asked — in its conversation (release 6b).
    const actions = [
      ...(isLead ? [["conversation", "Ask the lead", "comment"]] : []),
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
          width: p.botW || p.w,
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
              left: (p.botW || p.w) / 2 - 8,
              top: CARD_H - 8,
              touchAction: "none",
              cursor: "crosshair",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPop(null);
              setWpop(null);
              const pt = pointIn(e) || {
                x: p.x + (p.botW || p.w) / 2,
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
    const sx = a.x + (a.botW || a.w) / 2;
    const sy = a.y + CARD_H;
    const tx = drag.x == null ? sx : drag.x;
    const ty = drag.y == null ? sy : drag.y;
    return `M${sx},${sy} C${sx},${sy + 80} ${tx},${ty + 80} ${tx},${ty}`;
  })();

  // A widget card: a drop target for a bot's line (TD-009).
  const widgetCard = (w) => {
    const p = wpos[w.key];
    if (!p) return null;
    const droppable = canDropWidget();
    const hot = droppable && hovered === `w:${w.key}`;
    return (
      <div
        key={w.key}
        data-testid={`diagram-widget-${w.itemId}`}
        className={`absolute rounded-xl border border-dashed px-3 py-2 flex flex-col justify-center ${
          hot ? "border-green-400" : droppable ? selectedBorder : hairline
        } ${hot ? selectedBg : fieldBg}`}
        style={{
          left: p.x,
          top: p.y,
          width: p.w,
          height: W_CARD_H,
          opacity: drag && !droppable ? 0.45 : 1,
        }}
        onPointerEnter={() => setHovered(`w:${w.key}`)}
        onPointerLeave={() =>
          setHovered((h) => (h === `w:${w.key}` ? null : h))
        }
        onPointerUp={() => dropOnWidget(w.key)}
      >
        <span className={`text-sm font-semibold truncate ${strong}`}>
          {w.label}
        </span>
        <span className={`text-xs truncate ${muted}`}>
          {`${w.page ? `${w.page} · ` : ""}${widgetSub(w, nameOf)}`}
        </span>
      </div>
    );
  };

  // An open popover makes room for itself below the cards (the view scrolls).
  const POP_ROOM = 480;
  const contentH = Math.max(layout.height, routed ? routed.bottom + 24 : 0);
  const openTop = popStyle ? popStyle.top : wpopStyle ? wpopStyle.top : null;
  const height =
    openTop !== null ? Math.max(contentH, openTop + POP_ROOM) : contentH;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      <svg
        className="absolute inset-0 pointer-events-none"
        width={fullW}
        height={contentH}
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
        {drawn.map((e) => (
          <path
            key={`head-${e.key}`}
            d={e.head}
            className={lineClass(e.kind)}
            fill="currentColor"
            fillOpacity={touches(e) ? 1 : 0.3}
          />
        ))}
        {wDrawn.map((e) => (
          <path
            key={e.key}
            data-testid="diagram-widget-edge"
            data-kind={e.kind}
            d={e.d}
            className={lineClass(e.kind)}
            stroke="currentColor"
            strokeWidth={wFocus(e) && focusId ? 2.5 : 1.75}
            strokeOpacity={wFocus(e) ? 1 : 0.3}
            strokeDasharray={
              e.kind === "failed"
                ? "6 5"
                : e.kind === "results"
                  ? "2 4"
                  : undefined
            }
            fill="none"
          />
        ))}
        {wDrawn.map((e) => (
          <path
            key={`head-${e.key}`}
            d={e.head}
            className={lineClass(e.kind)}
            fill="currentColor"
            fillOpacity={wFocus(e) ? 1 : 0.3}
          />
        ))}
        {checkArrows.map((a) => (
          <g key={`chk-${a.key}`} className={muted}>
            <path d={a.d} stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d={a.head} fill="currentColor" />
          </g>
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
      {wDrawn.map((e) => (
        <button
          type="button"
          key={`label-${e.key}`}
          data-testid={`widget-edge-label-${e.key}`}
          onClick={() => editWidgetLine(e)}
          disabled={!canWire}
          className={`absolute rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${fieldBg} ${hairline} ${
            wFocus(e) ? strong : muted
          }`}
          style={{
            left: e.mx,
            top: e.my,
            transform: "translate(-50%, -50%)",
          }}
        >
          {e.kind === "results" ? "shows answers" : eventText(e.event)}
        </button>
      ))}
      {hasWidgets ? (
        <div
          className={`absolute text-xs font-semibold ${muted}`}
          style={{ left: routed.header.x, top: routed.header.y }}
        >
          {canWire
            ? "Widgets · drag a bot here to show what it sends"
            : "Widgets"}
        </div>
      ) : null}
      {widgets.map(widgetCard)}
      {lead ? card(lead) : null}
      {members.map(card)}
      {members.map((b) => {
        const p = pos[b.id];
        if (!p || !hasChecksCard(b)) return null;
        const has = checkCount(b) > 0;
        return (
          <ChecksCard
            key={`checks-${b.id}`}
            bot={b}
            waiting={waitingFor(b.id)}
            canEdit={!!(canWire && onOpenChecks)}
            onOpen={(id) => onOpenChecks && onOpenChecks(id)}
            style={
              has
                ? { left: p.chkX, top: p.y, width: CHK_W, height: CARD_H }
                : {
                    left: p.chkX,
                    top: p.y + (CARD_H - ADD_H) / 2,
                    width: ADD_W,
                    height: ADD_H,
                  }
            }
          />
        );
      })}
      {!members.length ? (
        <div
          className={`absolute text-sm text-center ${muted}`}
          style={{ left: 0, right: 0, top: layout.lead.y + CARD_H + 40 }}
        >
          No bots on this dashboard yet. Add one with Add bot.
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
      {wpop && wWidget && wSource ? (
        <WidgetWirePopover
          key={`${wpop.mode}-${wpop.from}-${wpop.widget}-${
            wpop.edge ? wpop.edge.key : ""
          }`}
          source={wSource}
          widget={wWidget}
          choices={choicesFor(wpop.from)}
          mode={wpop.mode}
          edge={wpop.edge}
          error={popError}
          saving={saving}
          style={wpopStyle}
          onConnect={(c) =>
            wsave(() =>
              onConnectWidget({
                ...c,
                widget: wWidget,
                sourceId: wpop.from,
                edge: wpop.edge,
              }),
            )
          }
          onShowHere={(botId) =>
            wsave(() => onShowHere({ widget: wWidget, botId }))
          }
          onAsk={(a) => {
            setWpop(null);
            if (onAskWidget) {
              onAskWidget({ ...a, widget: wWidget, sourceId: wpop.from });
            }
          }}
          onRemove={() =>
            wsave(() =>
              wpop.edge && wpop.edge.kind === "results"
                ? onShowHere({ widget: wWidget, botId: null })
                : onRemoveWidgetLine({ widget: wWidget, edge: wpop.edge }),
            )
          }
          onCancel={() => setWpop(null)}
          findTarget={findWidgetTarget}
        />
      ) : null}
    </div>
  );
};

export default TeamChart;
