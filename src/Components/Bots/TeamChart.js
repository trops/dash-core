import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SectionLabel, Tag } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { ChecksSection } from "./ChecksSection";
import { STATUS_DOT } from "./teamUtils";
import { diagramEdges, runsAfter } from "./teamDiagram";
import {
  DEFAULT_LINES,
  arrowKeys,
  botConnections,
  cardText,
  curveBetween,
  elbowBetween,
  flowRows,
  helperIds,
  lineSet,
  neighbourArrows,
  perRowFor,
  reviewerUses,
  workOrder,
} from "./teamFlow";
import { TeamConnectionsPanel } from "./TeamConnectionsPanel";
import { WidgetWirePopover } from "./WidgetWirePopover";
import { BOT_RESULTS, widgetEdges, widgetSub } from "./widgetDiagram";

// Room between neighbouring columns for an arrow.
const GUTTER = 28;
const MIN_CARD = 168;
const PER_ROW = 4;
const LEAD_W = 300;
const W_POP_W = 384;

/** The element's width, kept up to date (a fixed `width` wins — tests). */
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
 * Where each card is inside `root` ({ [nodeId]: { x, y, w, h } }), measured
 * after every render; only a change re-renders.
 */
function useBoxes(rootRef) {
  const [boxes, setBoxes] = useState({});
  const last = useRef("{}");
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const out = {};
    root.querySelectorAll("[data-node]").forEach((el) => {
      const b = el.getBoundingClientRect();
      out[el.getAttribute("data-node")] = {
        x: Math.round(b.left - r.left),
        y: Math.round(b.top - r.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    });
    const text = JSON.stringify(out);
    if (text !== last.current) {
      last.current = text;
      setBoxes(out);
    }
  });
  return boxes;
}

/**
 * TeamChart — a dashboard's team as a readable diagram (DASH-139; bot-teams
 * PRD TEAM-014): the lead on top ("You give it tasks · it can ask any
 * bot", no fixed arrow), the team's bots in work order left to right with
 * short arrows between neighbours, wrapping into rows whose cards share the
 * row width; the bots one hands on to stacked in the next column with a
 * fork arrow; helpers (bots used only in another bot's checks) in their own
 * lane; widgets in a lane only when Lines is "All, with widgets".
 *
 * Each card shows its name, when it runs ("After Planner"), its checks
 * (names on up to two lines with a kind mark, ChecksSection) and where its
 * failures go ("If it fails → Reporter") — failure routes are never drawn.
 *
 * `lines` (teamFlow LINES): "selected" draws only the selected bot's lines
 * besides the neighbour arrows; "flow" every bot-to-bot handoff; "all" adds
 * the widgets and their lines.
 *
 * Selecting a bot lights up its links, dims the rest and opens its
 * connections panel (TeamConnectionsPanel, `showPanel`), where everything
 * it's connected to is listed and edited: a bot is added or removed as a
 * trigger (`onSaveTrigger` / `onRemoveTrigger`), a widget through
 * `onConnectWidget` / `onShowHere` / `onRemoveWidgetLine` or, for a widget
 * that needs a choice or a change, the WidgetWirePopover (`onAskWidget`).
 * `setupFor(id)` true shows "Needs setup" on a card (DASH-119 / DASH-136).
 */
export const TeamChart = ({
  lead = null,
  members = [],
  selectedId = null,
  showPanel = true,
  lines = DEFAULT_LINES,
  statusOf = () => "Idle",
  approvalsFor = () => [],
  setupFor = () => false,
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
  liveFor = () => null,
  onOpenChecks = null,
  onOpenJob = null,
  width: fixedWidth = 0,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder, fieldBg } =
    useConfigTokens();
  const canvasRef = useRef(null);
  const width = useWidth(canvasRef, fixedWidth);
  const boxes = useBoxes(canvasRef);
  // The open bot → widget dialog: { from, widget (key), event }.
  const [wpop, setWpop] = useState(null);
  const [wError, setWError] = useState(null);
  const [saving, setSaving] = useState(false);

  const all = [lead, ...members].filter(Boolean);
  const byId = new Map(all.map((b) => [b.id, b]));
  const widgetByKey = new Map(widgets.map((w) => [w.key, w]));
  const isMember = (id) => members.some((b) => b.id === id);

  const edges = useMemo(() => diagramEdges(members, lead), [members, lead]);
  const wEdges = useMemo(
    () => (widgets.length ? widgetEdges(widgets, members) : []),
    [widgets, members],
  );
  const helpers = helperIds(members, edges);
  const uses = reviewerUses(members);
  const columns = workOrder(members, edges, helpers);
  const perRow = perRowFor(width, {
    minCard: MIN_CARD,
    gutter: GUTTER,
    max: PER_ROW,
  });
  const rows = flowRows(columns, perRow);
  const arrows = neighbourArrows(rows, edges);
  const shown = lineSet({
    mode: lines,
    selectedId,
    edges,
    wEdges,
    covered: arrowKeys(arrows),
    members,
  });
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const canEditChecks = !!(canWire && onOpenChecks);

  // ── Cards ─────────────────────────────────────────────────────────────
  const dimmed = (id) => shown.dim && !shown.lit.has(id);
  const frameOf = (id, live) => {
    if (id === selectedId) return `border-2 ${selectedBorder}`;
    if (shown.failLit.has(id)) return "border border-dashed border-red-400";
    if (shown.dim && shown.lit.has(id)) return "border border-indigo-400";
    if (live && live.needs) return "border border-amber-400";
    return `border ${hairline}`;
  };

  const card = (bot, { helper = false, stacked = false } = {}) => {
    if (!bot) return null;
    const isLead = bot.role === "lead";
    const active = bot.id === selectedId;
    const status = statusOf(bot.id);
    const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
    const waiting = (approvalsFor(bot.id) || []).length > 0;
    const member = !isLead && isMember(bot.id);
    const live = member ? liveFor(bot.id) : null;
    const text = member ? cardText(bot, members, edges, selectedId) : null;
    const usedBy = helper ? uses.get(bot.id) || [] : [];
    const needsSetup = member && setupFor(bot.id);
    const failText =
      member && !helper
        ? text.failsTo.length
          ? `If it fails → ${text.failsTo.join(", ")}`
          : text.failures
        : null;
    return (
      <div
        key={bot.id}
        data-node={bot.id}
        data-testid={`diagram-card-${bot.id}`}
        data-dim={dimmed(bot.id) ? "true" : undefined}
        className={`relative rounded-xl flex flex-col min-w-0 ${frameOf(
          bot.id,
          live,
        )} ${active ? selectedBg : fieldBg}`}
        style={{
          flex: isLead ? "0 1 auto" : stacked ? "0 0 auto" : "1 1 0",
          width: isLead ? LEAD_W : undefined,
          opacity: dimmed(bot.id) ? 0.4 : 1,
        }}
      >
        <button
          type="button"
          aria-label={bot.name}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect && onSelect(active ? null : bot.id)}
          className="w-full text-left p-3 flex flex-row items-start gap-2"
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
            <span className={`text-xs ${muted}`}>
              {isLead ? "You give it tasks · it can ask any bot" : text.after}
            </span>
            {needsSetup ? (
              <span className="mt-1">
                <Tag text="Needs setup" />
              </span>
            ) : null}
          </span>
        </button>
        {helper ? (
          <div className={`border-t px-3 py-2 flex flex-col gap-1 ${hairline}`}>
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
            >
              Used by
            </span>
            {usedBy.map((u, i) => (
              <span
                key={`${u.botId}-${i}`}
                className="text-xs text-indigo-300 line-clamp-2"
              >
                {`${u.name} · "${u.check}"`}
              </span>
            ))}
          </div>
        ) : member ? (
          <ChecksSection
            bot={bot}
            live={live}
            canEdit={canEditChecks}
            onOpen={(id) => onOpenChecks && onOpenChecks(id)}
            onOpenJob={onOpenJob}
          />
        ) : null}
        {failText ? (
          <div
            className={`border-t px-3 py-1.5 text-xs ${hairline} ${
              (active && text.failsTo.length) || shown.failLit.has(bot.id)
                ? "text-red-300 font-semibold"
                : muted
            }`}
            data-testid={`fail-line-${bot.id}`}
          >
            {failText}
          </div>
        ) : null}
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
      </div>
    );
  };

  const spacer = (key) => (
    <span key={key} aria-hidden="true" style={{ flex: `0 0 ${GUTTER}px` }} />
  );
  const column = (col) =>
    col.ids.length === 1 ? (
      card(byId.get(col.ids[0]))
    ) : (
      <div
        key={col.ids.join("+")}
        className="flex flex-col gap-2 min-w-0"
        style={{ flex: "1 1 0" }}
        data-testid="diagram-stack"
      >
        {col.ids.map((id) => card(byId.get(id), { stacked: true }))}
      </div>
    );
  const flowRow = (row, r) => {
    const out = [];
    row.forEach((col, i) => {
      if (i) out.push(spacer(`g${i}`));
      out.push(column(col));
    });
    // Cards share the row width: a short last row keeps the same widths.
    for (let i = row.length; i < perRow; i++) {
      out.push(spacer(`pg${i}`));
      out.push(
        <span key={`p${i}`} aria-hidden="true" style={{ flex: "1 1 0" }} />,
      );
    }
    return (
      <div
        key={`row-${r}`}
        className="flex flex-row items-start"
        data-testid="diagram-row"
      >
        {out}
      </div>
    );
  };

  // ── Lines (measured from the cards) ─────────────────────────────────
  const hotEdge = (e) =>
    !!selectedId && (e.from === selectedId || e.to === selectedId);
  const arrowPaths = [];
  for (const a of arrows.flat()) {
    for (const e of a.edges) {
      const from = boxes[e.from];
      const to = boxes[e.to];
      if (!from || !to) continue;
      arrowPaths.push({
        key: e.key,
        hot: hotEdge(e),
        ...elbowBetween(from, to),
      });
    }
  }
  const linePaths = shown.lines
    .map((l) => {
      const from = boxes[l.from];
      const to = boxes[l.to];
      if (!from || !to) return null;
      return { ...l, ...curveBetween(from, to) };
    })
    .filter(Boolean);
  const lineClass = (hot) => (hot ? "text-indigo-300" : muted);

  // ── Widgets lane ────────────────────────────────────────────────────
  const widgetCard = (w) => (
    <div
      key={w.key}
      data-node={`w:${w.key}`}
      data-testid={`diagram-widget-${w.itemId}`}
      className={`rounded-xl border border-dashed px-3 py-2 flex flex-col min-w-0 ${
        shown.dim && shown.lit.has(`w:${w.key}`)
          ? "border-indigo-400"
          : hairline
      } ${fieldBg}`}
      style={{
        flex: "1 1 160px",
        maxWidth: 260,
        opacity: dimmed(`w:${w.key}`) ? 0.4 : 1,
      }}
    >
      <span className={`text-sm font-semibold truncate ${strong}`}>
        {w.label}
      </span>
      <span className={`text-xs truncate ${muted}`}>
        {`${w.page ? `${w.page} · ` : ""}${widgetSub(w, nameOf)}`}
      </span>
    </div>
  );

  // ── The panel's edits ───────────────────────────────────────────────
  const addListener = async (event, value) => {
    if (!selected) return;
    const [type, ...rest] = String(value).split(":");
    const id = rest.join(":");
    if (type === "bot") {
      if (!onSaveTrigger) return;
      const choice = (choicesFor(selected.id) || []).find(
        (c) => c.event === event,
      );
      await onSaveTrigger({
        mode: "add",
        sourceId: selected.id,
        targetId: id,
        oldEventType: null,
        event,
        label: (choice && choice.label) || event,
        note: "",
      });
      return;
    }
    const widget = widgetByKey.get(id);
    if (!widget) return;
    if (widget.component === BOT_RESULTS && event === "completed") {
      if (onShowHere) await onShowHere({ widget, botId: selected.id });
      return;
    }
    if (widget.handlers.length === 1 && onConnectWidget) {
      await onConnectWidget({
        widget,
        sourceId: selected.id,
        event,
        handlerName: widget.handlers[0],
        edge: null,
      });
      return;
    }
    // A choice of listener, or a change to the widget: the dialog.
    setWError(null);
    setWpop({ from: selected.id, widget: widget.key, event });
  };
  const removeListener = async (event, t) => {
    if (t.type === "bot") {
      if (onRemoveTrigger) {
        await onRemoveTrigger({ targetId: t.id, eventType: t.eventType });
      }
      return;
    }
    if (t.edge && t.edge.kind === "results") {
      if (onShowHere) await onShowHere({ widget: t.widget, botId: null });
      return;
    }
    if (onRemoveWidgetLine) {
      await onRemoveWidgetLine({ widget: t.widget, edge: t.edge });
    }
  };
  const wsave = async (fn) => {
    setSaving(true);
    try {
      await fn();
      setWpop(null);
    } catch (err) {
      setWError(
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
  const wChoices = (() => {
    if (!wpop) return [];
    const list = (choicesFor(wpop.from) || []).filter(
      (c) => c.event === wpop.event,
    );
    return list.length ? list : [{ event: wpop.event, label: wpop.event }];
  })();

  // The bot the flow carries on to from the selected one ("main path").
  const mainNext = (() => {
    if (!selected) return null;
    const at = columns.findIndex((c) => c.main === selected.id);
    const next = at >= 0 ? columns[at + 1] : null;
    return next ? next.main : null;
  })();
  const connections =
    selected && selected.role !== "lead" && isMember(selected.id)
      ? botConnections({
          bot: selected,
          members,
          widgets,
          wEdges,
          choices: choicesFor(selected.id),
          after: runsAfter(selected, all, nameOf),
          mainNext,
        })
      : null;

  const helperBots = members.filter((b) => helpers.has(b.id));

  return (
    <div className="w-full flex flex-row flex-wrap">
      <div
        ref={canvasRef}
        className="relative min-w-0 p-4 flex flex-col gap-3"
        style={{ flex: "999 1 480px" }}
        data-testid="team-diagram"
      >
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          {arrowPaths.map((p) => (
            <g
              key={`arrow-${p.key}`}
              data-testid="diagram-arrow"
              data-hot={p.hot ? "true" : undefined}
              className={lineClass(p.hot)}
            >
              <path
                d={p.d}
                stroke="currentColor"
                strokeWidth={p.hot ? 2 : 1.5}
                fill="none"
              />
              <path d={p.head} fill="currentColor" />
            </g>
          ))}
          {linePaths.map((p) => (
            <g
              key={`line-${p.key}`}
              data-testid={p.widget ? "diagram-widget-edge" : "diagram-edge"}
              data-hot={p.hot ? "true" : undefined}
              className={lineClass(p.hot)}
              opacity={shown.dim && !p.hot ? 0.4 : 1}
            >
              <path
                d={p.d}
                stroke="currentColor"
                strokeWidth={p.hot ? 2 : 1.5}
                strokeDasharray={p.widget ? "4 4" : undefined}
                fill="none"
              />
              <path d={p.head} fill="currentColor" />
            </g>
          ))}
        </svg>

        {lead ? <div className="flex flex-row">{card(lead)}</div> : null}

        {members.length ? (
          <>
            {columns.length ? <SectionLabel text="Work flow" /> : null}
            {rows.map(flowRow)}
          </>
        ) : (
          <div className={`text-sm text-center py-8 ${muted}`}>
            No bots on this dashboard yet. Add one with Add bot.
          </div>
        )}

        {helperBots.length ? (
          <>
            <SectionLabel text="Helpers" />
            <div className="flex flex-row flex-wrap" style={{ gap: GUTTER }}>
              {helperBots.map((b) => (
                <div
                  key={`h-${b.id}`}
                  className="flex min-w-0"
                  style={{
                    flex: `0 1 calc((100% - ${GUTTER * (perRow - 1)}px) / ${perRow})`,
                  }}
                >
                  {card(b, { helper: true })}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {shown.showWidgets && widgets.length ? (
          <>
            <SectionLabel text="Widgets" />
            <div className="flex flex-row flex-wrap gap-3">
              {widgets.map(widgetCard)}
            </div>
          </>
        ) : null}

        {widgets.length && !shown.showWidgets ? (
          <span className={`text-xs ${muted}`}>
            {`Widgets aren't drawn here unless Lines is "All, with widgets". A selected bot's widgets are in its panel.`}
          </span>
        ) : null}
      </div>

      {selected && showPanel ? (
        <TeamConnectionsPanel
          key={selected.id}
          bot={selected}
          connections={connections}
          canEdit={canWire}
          onClose={() => onSelect && onSelect(null)}
          onOpenPage={() => onOpen && onOpen(selected.id, "activity")}
          onOpenConversation={() =>
            onOpen && onOpen(selected.id, "conversation")
          }
          onOpenChecks={canEditChecks ? () => onOpenChecks(selected.id) : null}
          onAdd={addListener}
          onRemove={removeListener}
        >
          {wpop && wWidget && wSource ? (
            <WidgetWirePopover
              key={`${wpop.from}-${wpop.widget}-${wpop.event}`}
              source={wSource}
              widget={wWidget}
              choices={wChoices}
              mode="add"
              edge={null}
              error={wError}
              saving={saving}
              style={{ right: 8, top: 64, maxWidth: W_POP_W }}
              onConnect={(c) =>
                wsave(() =>
                  onConnectWidget({
                    ...c,
                    widget: wWidget,
                    sourceId: wpop.from,
                    edge: null,
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
              onRemove={() => setWpop(null)}
              onCancel={() => setWpop(null)}
              findTarget={findWidgetTarget}
            />
          ) : null}
        </TeamConnectionsPanel>
      ) : null}
    </div>
  );
};

export default TeamChart;
