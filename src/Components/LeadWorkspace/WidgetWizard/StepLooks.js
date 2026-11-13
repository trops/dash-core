import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button2,
  Checkbox,
  EmptyState,
  InputText,
  ListRow,
  PanelHeader,
  SegmentedControl,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { WidgetContext } from "../../../Context/WidgetContext";
import { useMcpProvider } from "../../../hooks/useMcpProvider";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { classifyTool } from "../../../utils/widgetEvents";
import { toolErrorText } from "../../../utils/issues";
import { TextLink } from "./TextLink";
import { WizardAnswer } from "./WizardAnswer";
import {
  argsFromSettings,
  shownLimit,
  defaultOptions,
  fieldLabel,
  fieldRoles,
  itemsFrom,
  lookById,
  looksFor,
  optionControls,
  timeText,
} from "./widgetLooks";

/**
 * The one read the previews are drawn from: the widget's provider, called
 * as the app's own read (useMcpProvider, internal), with a tool that only
 * reads — never one that changes, or might change, anything. Draws nothing; tells `onRead({ items } | { error })`.
 */
const ReadOnce = ({ type, tool, args, settings, onRead }) => {
  // The app's own read: no widget permission, no Issue, no events.
  const mcp = useMcpProvider(type, { internal: true });
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    if (mcp.error) {
      asked.current = true;
      onRead({ error: String(mcp.error) });
      return;
    }
    if (!mcp.isConnected) return;
    asked.current = true;
    // What it takes, filled from the widget's settings; the Planner's own
    // arguments win.
    const schema = ((mcp.tools || []).find((t) => t && t.name === tool) || {})
      .inputSchema;
    const call = { ...argsFromSettings(schema, settings), ...(args || {}) };
    Promise.resolve(mcp.callTool(tool, call))
      .then((result) =>
        result && result.isError
          ? onRead({ error: toolErrorText(result) || "it said no" })
          : onRead({ items: itemsFrom(result) }),
      )
      .catch((e) => onRead({ error: (e && e.message) || String(e) }));
  }, [mcp.isConnected, mcp.error, mcp, tool, args, onRead]);
  return null;
};

/**
 * The widget's real data for the previews: one read-only call to the
 * provider it reads from. `preview`: { type, provider, tool, args } — no
 * tool, or one that changes things, reads nothing.
 * @returns {{ status: "reading"|"read"|"failed"|"none", items, error }}
 */
export function useLookData(preview) {
  const [state, setState] = useState({ status: "reading", items: [] });
  const ok =
    !!preview &&
    !!preview.tool &&
    !!preview.provider &&
    classifyTool(preview.tool) === "read";
  const onRead = useMemo(
    () => (r) =>
      setState(
        "error" in r
          ? { status: "failed", items: [], error: r.error || "no reason given" }
          : { status: "read", items: r.items || [] },
      ),
    [],
  );
  const reader = ok ? (
    <WidgetContext.Provider
      value={{
        widgetData: {
          selectedProviders: { [preview.type]: preview.provider },
        },
        api: null,
      }}
    >
      <ReadOnce
        type={preview.type}
        tool={preview.tool}
        args={preview.args}
        settings={preview.settings}
        onRead={onRead}
      />
    </WidgetContext.Provider>
  ) : null;
  return { ...(ok ? state : { status: "none", items: [] }), reader };
}

const fieldText = (item, key, roles) =>
  key === roles.time ? timeText(item[key]) : String(item[key] || "");

/**
 * One look, drawn with Dash's own components: the widget as it could be,
 * with these items and options.
 */
export const LookPreview = ({
  lookId,
  items,
  roles,
  options,
  title,
  total = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const look = lookById(lookId);
  const o = options;
  const shown = (o.fields || []).filter((f) => f !== roles.title);
  const pad = o.spacing === "Compact" ? "py-1" : "py-2";
  const meta = (it) =>
    shown
      .filter((f) => !(f === roles.time && o.timeAt === "Left column"))
      .map((f) => fieldText(it, f, roles))
      .filter(Boolean)
      .join(" · ");
  const head =
    o.header === "None" ? null : (
      <PanelHeader
        title={title}
        actions={
          o.header === "Title and count" ? (
            <span className={`text-xs ${muted}`}>
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          ) : null
        }
      />
    );
  if (!items.length) {
    return (
      <div className="flex flex-col h-full">
        {head}
        <EmptyState title={o.empty} />
      </div>
    );
  }
  const titleOf = (it) =>
    roles.title ? String(it[roles.title] || "") : Object.values(it)[0];
  const timeCol = (it) =>
    roles.time && o.timeAt === "Left column" && shown.includes(roles.time) ? (
      <span className={`w-16 flex-shrink-0 text-xs font-semibold ${strong}`}>
        {timeText(it[roles.time])}
      </span>
    ) : null;
  let body;
  if (look.id === "count") {
    body = (
      <div className="flex flex-col gap-1 px-2 py-3">
        <span className={`text-xs font-semibold ${muted}`}>IN ALL</span>
        <span className={`text-3xl font-semibold ${strong}`}>
          {total === null ? items.length : total}
        </span>
        {items.slice(0, 3).map((it, i) => (
          <span key={i} className={`text-sm truncate ${muted}`}>
            {titleOf(it)}
          </span>
        ))}
      </div>
    );
  } else if (look.id === "cards") {
    body = (
      <div className="grid grid-cols-2 gap-2 p-2">
        {items.slice(0, 4).map((it, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 rounded-lg border p-2 ${hairline}`}
          >
            <span className={`text-sm break-words ${strong}`}>
              {titleOf(it)}
            </span>
            <span className={`text-xs truncate ${muted}`}>{meta(it)}</span>
          </div>
        ))}
      </div>
    );
  } else if (look.id === "next") {
    const [first, ...rest] = items;
    body = (
      <div className="flex flex-col">
        <div className={`flex flex-col gap-1 px-2 py-3 border-b ${hairline}`}>
          <span>
            <StatusBadge compact state="info" label="Next" />
          </span>
          <span className={`text-lg font-semibold ${strong}`}>
            {titleOf(first)}
          </span>
          <span className={`text-xs ${muted}`}>
            {[
              roles.time ? timeText(first[roles.time]) : "",
              ...shown
                .filter((f) => f !== roles.time)
                .map((f) => fieldText(first, f, roles)),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {rest.map((it, i) => (
          <ListRow key={i} title={titleOf(it)} meta={meta(it)} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col">
        {items.map((it, i) => (
          <div
            key={i}
            className={`flex flex-row items-center gap-2 px-2 ${pad} ${
              i < items.length - 1 ? `border-b ${hairline}` : ""
            } ${look.id === "timeline" ? "border-l-2 pl-3" : ""}`}
          >
            {look.id === "timeline" && roles.time ? (
              <span className={`w-16 flex-shrink-0 text-xs ${muted}`}>
                {timeText(it[roles.time])}
              </span>
            ) : (
              timeCol(it)
            )}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className={`text-sm truncate ${strong}`}>
                {titleOf(it)}
              </span>
              {meta(it) ? (
                <span className={`text-xs truncate ${muted}`}>{meta(it)}</span>
              ) : null}
            </span>
            {o.markFirst === "On" && i === 0 ? (
              <StatusBadge compact state="info" label="Next" />
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {head}
      {body}
    </div>
  );
};

/**
 * Step 4 · Looks (the approved "looks" and "tweak" frames): three ways the
 * widget could look, drawn with Dash's own components from the user's real
 * data (or the Planner's sample, said so); pick one, then change it live —
 * no AI. "Describe it" goes to the chat.
 *
 * @param {object} piece      the wizard's widget
 * @param {object} preview    { type, provider, tool, args } — the read
 * @param {object|null} look  what was picked: { id, options }
 * @param {(look) => void} onPick  a look picked (its options not yet)
 * @param {(look) => void} onNext
 * @param {() => void} onBack
 * @param {() => void} onDescribe
 */
/**
 * The Planner's question for step 4, for its chat bubble.
 */
/**
 * A provider's error in a few words: its message, not the whole reply
 * (found live: a JSON dump with suggestions filled the step).
 */
export function shortError(error) {
  let text = String(error || "").trim();
  const json = text.indexOf("{");
  if (json >= 0) {
    try {
      const o = JSON.parse(text.slice(json));
      const m =
        (o && o.error && (o.error.message || o.error.code)) ||
        (o && o.message) ||
        null;
      if (m) text = String(m);
    } catch (_e) {
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      if (m) text = m[1];
    }
  }
  return text.length > 120
    ? `${text.slice(0, 117)}…`
    : text || "no reason given";
}

export const looksQuestion = () => ({
  question: "How should it look?",
  why: "A few ways it could look, drawn with Dash's own components and your data. Pick one, then change it — no AI needed for that.",
});

export const StepLooks = ({
  piece,
  preview = null,
  look = null,
  onPick = () => {},
  onNext,
  onBack,
  onDescribe,
  readOnly = false,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const data = useLookData(preview);
  const sample = useMemo(
    () =>
      itemsFrom(
        (Array.isArray(piece.sample) ? piece.sample : [])
          .filter((x) => typeof x === "string" && x.trim())
          .join("\n"),
      ),
    [piece.sample],
  );
  const real = data.status === "read";
  const all = real ? data.items : sample;
  const limit = shownLimit(piece.settings);
  const items = limit ? all.slice(0, limit) : all;
  const roles = useMemo(() => fieldRoles(items), [items]);
  const order = looksFor(roles);
  const [shown, setShown] = useState(3);
  const [picked, setPicked] = useState(look ? look.id : null);
  const [options, setOptions] = useState(() => (look && look.options) || null);
  const base = defaultOptions(roles, piece.whenEmpty);
  const kept = options || (look && look.id === picked && look.options) || base;
  // Fields picked from other data (the sample, an earlier read) that this
  // data doesn't have go; none left — the defaults.
  const fields = (kept.fields || []).filter((f) => roles.fields.includes(f));
  const opts = { ...kept, fields: fields.length ? fields : base.fields };
  const title = piece.name || "Widget";
  const from =
    data.status === "reading"
      ? `Reading from ${preview && preview.provider}…`
      : real
        ? `Using what's in ${preview.provider} now.`
        : data.status === "failed"
          ? `${preview.provider} couldn't be read (${shortError(data.error)}) — showing the plan's sample instead.`
          : "Using the plan's sample.";
  const set = (k, v) => setOptions({ ...opts, [k]: v });

  if (picked) {
    const l = lookById(picked);
    return (
      <WizardAnswer
        testId="wizard-looks-tweak"
        actions={
          <>
            <Button
              title="Next: review"
              disabled={readOnly}
              onClick={() => onNext({ id: picked, options: opts })}
            />
            <Button2
              title="Back to the ideas"
              disabled={readOnly}
              onClick={() => setPicked(null)}
            />
          </>
        }
      >
        {data.reader}
        <div className="flex flex-row flex-wrap items-start gap-4">
          <div className="w-96 flex-shrink-0 flex flex-col gap-2">
            <div
              className={`h-64 overflow-hidden rounded-xl border ${statusTokens.info.accentBorder}`}
              data-testid="look-live"
            >
              <LookPreview
                lookId={picked}
                items={items}
                roles={roles}
                options={opts}
                title={title}
                total={all.length}
              />
            </div>
            <span className={`text-xs ${muted}`}>
              Live — every change on the right shows here at once, no AI needed.{" "}
              {from}
            </span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <span className={`text-sm font-semibold ${strong}`}>
              {l.name} · change it
            </span>
            {optionControls(l, roles).map((c) => (
              <div
                key={c.key}
                className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1"
              >
                <span className={`w-36 flex-shrink-0 text-xs ${muted}`}>
                  {c.label}
                </span>
                <SegmentedControl
                  ariaLabel={c.label}
                  value={opts[c.key]}
                  onChange={(v) => set(c.key, v)}
                  options={c.options.map((x) => ({ value: x, label: x }))}
                />
              </div>
            ))}
            {roles.fields.length ? (
              <div className="flex flex-row flex-wrap items-start gap-x-4 gap-y-1">
                <span className={`w-36 flex-shrink-0 text-xs ${muted}`}>
                  For each one, show
                </span>
                <div className="flex flex-row flex-wrap gap-3">
                  {roles.fields.map((f) => (
                    <Checkbox
                      key={f}
                      label={fieldLabel(f)}
                      checked={(opts.fields || []).includes(f)}
                      onChange={(on) =>
                        set(
                          "fields",
                          on
                            ? [...(opts.fields || []).filter((x) => x !== f), f]
                            : (opts.fields || []).filter((x) => x !== f),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
              <span className={`w-36 flex-shrink-0 text-xs ${muted}`}>
                When there&apos;s nothing
              </span>
              <div className="flex-1 min-w-48">
                <InputText
                  height="h-8"
                  padding="px-2 py-1"
                  ariaLabel="When there's nothing"
                  value={opts.empty}
                  onChange={(v) => set("empty", typeof v === "string" ? v : "")}
                />
              </div>
            </div>
            <span className={`text-xs ${muted}`}>
              Something these don&apos;t cover?{" "}
              <TextLink
                title="Describe it"
                disabled={readOnly}
                onClick={onDescribe}
              />{" "}
              — the Builder draws it from your words.
            </span>
          </div>
        </div>
      </WizardAnswer>
    );
  }

  const ideas = order.slice(0, shown);
  const more = order.length - shown;
  return (
    <WizardAnswer
      testId="wizard-looks"
      actions={
        <Button2
          title="Back to talks to"
          disabled={readOnly}
          onClick={onBack}
        />
      }
    >
      {data.reader}
      <span className={`text-xs ${muted}`}>{from}</span>
      <div className="flex flex-row flex-wrap gap-3">
        {ideas.map((l) => {
          const use = () => {
            setPicked(l.id);
            if (!look || look.id !== l.id) setOptions(null);
            // Kept at once: a reopened conversation is where it was.
            onPick({
              id: l.id,
              options: look && look.id === l.id ? look.options : null,
            });
          };
          return (
            // The whole card picks it and lights up under the pointer; its
            // button is the way in from the keyboard.
            <div
              key={l.id}
              className={`flex-1 min-w-0 flex flex-col gap-2 rounded-xl border p-3 ${hairline} ${
                look && look.id === l.id ? selectedBg : ""
              } ${readOnly ? "" : "dr-clickable"}`}
              data-testid="look-idea"
              onClick={(e) => {
                if (
                  readOnly ||
                  (e.target.closest && e.target.closest("button"))
                )
                  return;
                use();
              }}
            >
              <div
                className={`h-64 overflow-hidden rounded-lg border ${hairline}`}
              >
                <LookPreview
                  lookId={l.id}
                  items={items}
                  roles={roles}
                  options={defaultOptions(roles, piece.whenEmpty)}
                  title={title}
                  total={all.length}
                />
              </div>
              <span className={`text-sm font-semibold ${strong}`}>
                {l.name}
              </span>
              <span className={`text-xs ${muted}`}>{l.what}</span>
              <span className={`text-xs ${muted}`}>
                Built from: {l.builtFrom}
              </span>
              <Button2
                title="Use this one"
                ariaLabel={`Use ${l.name}`}
                disabled={readOnly}
                onClick={use}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-row flex-wrap items-center gap-3">
        {more > 0 ? (
          <Button2
            title={`Show ${more} more ${more === 1 ? "idea" : "ideas"}`}
            onClick={() => setShown(order.length)}
          />
        ) : null}
        <span className={`text-xs ${muted}`}>
          Or{" "}
          <TextLink
            title="describe it"
            disabled={readOnly}
            onClick={onDescribe}
          />{" "}
          — the Builder draws it from your words.
        </span>
      </div>
    </WizardAnswer>
  );
};

export default StepLooks;
