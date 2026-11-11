import React, { useEffect, useRef, useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  SectionLabel,
  SelectInput,
  TextArea,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { WhenChoices, firstEvent } from "./TriggerPopover";
import { BOT_RESULTS, wireHandlerName } from "./widgetDiagram";

const RUN_WAIT_MS = 3 * 60 * 1000;
const RUN_POLL_MS = 3000;

/** A bot's last finished answer from its runs (oldest first), or null. */
export function lastAnswerOf(runs) {
  const list = Array.isArray(runs) ? runs : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (!r || r.skipped) continue;
    if (["failed", "stopped", "interrupted"].includes(r.status)) continue;
    if (typeof r.output !== "string" || !r.output.trim()) continue;
    return { at: r.endedAt || r.at || r.startedAt || null, output: r.output };
  }
  return null;
}

const when = (iso) => {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  return t.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

const textOf = (v) =>
  typeof v === "string" ? v : (v && v.target && v.target.value) || "";

/**
 * WidgetWirePopover — a line from a bot to a widget on the Bots diagram
 * (team-dashboards TD-009): when the bot does what, and what the widget does
 * with it.
 * - A Bot results widget: it shows this bot instead (Show here).
 * - A widget that already listens: pick which listener — it connects right
 *   away, no AI.
 * - Any other widget (or "Describe something else instead"): say what it
 *   should show; the Dash team adds the listener and the display to it —
 *   or, for a widget that isn't yours to change, to your own copy of it in
 *   the same spot. It's built from the bot's real answers: a bot that hasn't
 *   run yet is run first.
 *
 * @param {object} widget  a diagramWidgets entry
 * @param {object|null} edge  the line being changed (mode "edit")
 * @param {(c: {event, label, handlerName}) => Promise} onConnect
 * @param {(botId: string|null) => Promise} onShowHere
 * @param {(a: {event, label, ask, handlerName}) => void} onAsk
 * @param {(widget) => Promise<{status, mode, target}>} findTarget  whether
 *   the widget changes in place or as a copy (findWidgetTarget)
 */
export const WidgetWirePopover = ({
  source,
  widget,
  choices = [],
  mode = "add",
  edge = null,
  error = null,
  saving = false,
  onConnect,
  onShowHere,
  onAsk,
  onRemove,
  onCancel,
  findTarget = null,
  style = null,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const isResults = widget.component === BOT_RESULTS;
  const [event, setEvent] = useState(
    firstEvent(choices, edge ? edge.event : null),
  );
  const [handler, setHandler] = useState(
    (edge && edge.handlerName) || widget.handlers[0] || "",
  );
  const [describing, setDescribing] = useState(
    !isResults && !widget.handlers.length,
  );
  const [ask, setAsk] = useState("");
  const [target, setTarget] = useState({ status: "loading", mode: null });
  const [answer, setAnswer] = useState({ status: "loading", last: null });
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const chosen = choices.find((c) => c.event === event) || null;
  const bots = () =>
    (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
    null;

  // What the Dash team can do with this widget: change it, or a copy.
  useEffect(() => {
    if (!describing) return;
    if (!findTarget) {
      setTarget({ status: "ready", mode: "update", target: null });
      return;
    }
    Promise.resolve()
      .then(() => findTarget(widget))
      .then((t) => alive.current && setTarget(t))
      .catch(
        () => alive.current && setTarget({ status: "missing", mode: null }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [describing, widget.component, widget.sourcePackage]);

  // The bot's last answer — what the Dash team builds from.
  const loadAnswer = async () => {
    const b = bots();
    try {
      const runs = b && b.getRuns ? await b.getRuns(source.id, 20) : [];
      return lastAnswerOf(runs);
    } catch (_e) {
      return null;
    }
  };
  useEffect(() => {
    if (!describing) return;
    loadAnswer().then(
      (last) =>
        alive.current && setAnswer({ status: last ? "ready" : "none", last }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [describing, source.id]);

  // Run it now: run the bot, then wait for its answer.
  const runNow = async () => {
    const b = bots();
    if (!b || !b.run || running) return;
    setRunning(true);
    const before = answer.last ? answer.last.at : null;
    try {
      await b.run(source.id, "", false);
    } catch (_e) {
      // It may still run; keep waiting for an answer.
    }
    const until = Date.now() + RUN_WAIT_MS;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, RUN_POLL_MS));
      const last = await loadAnswer();
      if (last && last.at !== before) {
        if (alive.current) setAnswer({ status: "ready", last });
        break;
      }
    }
    if (alive.current) setRunning(false);
  };

  const copy = target.status === "ready" && target.mode === "new";
  const needsAnswer = event === "completed" && answer.status !== "ready";
  const title = `Show in ${widget.label}`;

  const connect = () =>
    chosen &&
    handler &&
    onConnect &&
    onConnect({
      event: chosen.event,
      label: chosen.label,
      handlerName: handler,
    });
  const askTeam = () =>
    chosen &&
    ask.trim() &&
    onAsk &&
    onAsk({
      event: chosen.event,
      label: chosen.label,
      ask: ask.trim(),
      handlerName: wireHandlerName(source, chosen.event, [
        ...widget.handlers,
        ...(widget.listenerNames || []),
      ]),
    });

  let body;
  let primary;
  let foot = "";
  if (isResults) {
    const showsThis = widget.resultsBotId === source.id;
    body = (
      <span className={`text-xs ${muted}`}>
        {showsThis
          ? `${widget.label} shows ${source.name}'s latest answers and results.`
          : `${widget.label} shows one bot's latest answers and results. Show ${source.name}'s here instead?`}
      </span>
    );
    primary = showsThis ? null : (
      <Button
        title="Show here"
        size="sm"
        disabled={saving}
        onClick={() => onShowHere && onShowHere(source.id)}
      />
    );
  } else if (!describing) {
    body = (
      <>
        <WhenChoices
          name={`wire-${source.id}-${widget.key}`}
          source={source}
          choices={choices}
          event={event}
          onChange={setEvent}
        />
        <SectionLabel text={`${widget.label} will`} />
        <SelectInput
          label="Listener"
          value={handler}
          onChange={setHandler}
          options={[
            ...widget.handlers,
            ...(handler && !widget.handlers.includes(handler) ? [handler] : []),
          ].map((h) => ({ value: h, label: h }))}
        />
        <span className={`text-xs ${muted}`}>
          {`${widget.label} already listens for messages, so this connects right away.`}{" "}
          <Button3
            title="Describe something else instead"
            size="sm"
            onClick={() => setDescribing(true)}
          />
        </span>
      </>
    );
    primary = (
      <Button
        title={mode === "edit" ? "Save" : "Connect"}
        size="sm"
        disabled={saving || !chosen || !handler}
        onClick={connect}
      />
    );
    foot = mode === "edit" ? "" : "Undo: click the line";
  } else {
    body = (
      <>
        {copy ? (
          <AlertBanner
            variant="warning"
            size="compact"
            message={`${widget.label} isn't yours to change (it's from ${
              (target.target && target.target.package) || "another package"
            }), so the Dash team makes your own copy that also shows what ${source.name} sends, and puts it in the same spot.`}
          />
        ) : null}
        <WhenChoices
          name={`wire-${source.id}-${widget.key}`}
          source={source}
          choices={choices}
          event={event}
          onChange={setEvent}
        />
        {copy ? null : (
          <span className={`text-xs ${muted}`}>
            {`${widget.label} can't receive this yet. Say what it should show, and the Dash team adds the listener and the display to the widget.`}
          </span>
        )}
        <SectionLabel text="What should the widget do with it?" />
        <TextArea
          value={ask}
          onChange={(v) => setAsk(textOf(v))}
          placeholder="e.g. Show each item with its picture and a link."
          rows={3}
          autoGrow
        />
        {event === "completed" ? (
          <div
            data-testid="wire-answer"
            className={`rounded-lg border px-3 py-2 flex flex-row items-center gap-2 text-xs ${hairline} ${muted}`}
          >
            <span className="flex-1">
              {answer.status === "loading"
                ? `Looking for ${source.name}'s last answer…`
                : answer.status === "ready"
                  ? `The Dash team reads ${source.name}'s last answers to see what it sends · last one ${when(answer.last.at)}`
                  : running
                    ? `Running ${source.name}… the Dash team can start once it answers.`
                    : `${source.name} hasn't answered yet, so there's nothing to read. Run it once and the Dash team plans from what it really sends.`}
            </span>
            {answer.status === "none" ? (
              <Button3
                title={running ? "Running…" : "Run it now"}
                size="sm"
                disabled={running}
                onClick={runNow}
              />
            ) : null}
          </div>
        ) : null}
      </>
    );
    primary = (
      <Button
        title={copy ? "Make my own copy" : "Ask the Dash team"}
        size="sm"
        disabled={
          saving ||
          !chosen ||
          !ask.trim() ||
          needsAnswer ||
          target.status === "loading" ||
          target.status === "missing"
        }
        onClick={askTeam}
      />
    );
    foot =
      target.status === "missing"
        ? /^dash\./.test(widget.component)
          ? "It's one of Dash's own widgets, which can't be changed — drop the bot on one of your widgets."
          : "This widget isn't installed any more."
        : "Opens Create to plan it";
  }

  return (
    <div
      role="dialog"
      aria-label={title}
      className={`absolute z-10 w-96 rounded-xl border shadow-lg flex flex-col ${hairline} ${fieldBg}`}
      style={style || undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`px-4 py-3 border-b ${hairline}`}>
        <div className={`text-sm font-semibold ${strong}`}>{title}</div>
        <div className={`text-xs ${muted}`}>{`from ${source.name}`}</div>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        {body}
        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
      </div>
      <div
        className={`px-4 py-3 border-t flex flex-row items-center gap-2 ${hairline}`}
      >
        {mode === "edit" ? (
          <Button3
            title="Remove"
            size="sm"
            disabled={saving}
            onClick={onRemove}
          />
        ) : null}
        <span className={`flex-1 text-xs ${muted}`}>{foot}</span>
        <Button3 title="Cancel" size="sm" onClick={onCancel} />
        {primary}
      </div>
    </div>
  );
};

export default WidgetWirePopover;
