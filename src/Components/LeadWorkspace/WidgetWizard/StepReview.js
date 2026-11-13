import React, { useRef, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  FontAwesomeIcon,
  InputText,
  StatusBadge,
  Switch,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { TextLink } from "./TextLink";
import {
  STEPS,
  reviewRows,
  settingKind,
  settingLabel,
  settingText,
  widgetLabel,
} from "./widgetSpec";

const NUMBER = /^-?\d+(\.\d+)?$/;

/** "Max items" → "maxItems": a setting's name as the widget declares it. */
const settingKey = (name) => {
  const words = String(name || "")
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words
    .map((w, i) =>
      i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1),
    )
    .join("");
};

/** What was typed, back to the setting's own kind (a number, an object). */
const typedBack = (was, typed) => {
  if (typeof was === "boolean") return typed === true;
  const t = String(typed);
  if (typeof was === "number") return NUMBER.test(t.trim()) ? Number(t) : was;
  if (was && typeof was === "object") {
    try {
      return JSON.parse(t);
    } catch (_e) {
      return was;
    }
  }
  return t;
};

/**
 * The wizard's step bar (the approved "Widget, step by step"): each step,
 * the current one marked, a done one ticked with what was chosen.
 * @param {string} current  a STEPS id
 * @param {{ [id]: string }} done  the done steps and their note
 * @param {boolean} compact  in a header: small, ticks without the notes
 */
export const StepBar = ({
  current,
  done = {},
  compact = false,
  // Other steps (a widget the user already has: Which one, Settings, Review).
  steps = STEPS,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <nav
      aria-label="Steps"
      className={`flex flex-row flex-wrap ${compact ? "gap-1" : "gap-2"}`}
      data-testid="wizard-steps"
    >
      {steps.map((s, i) => {
        const on = s.id === current;
        const note = done[s.id];
        return (
          <span
            key={s.id}
            aria-current={on ? "step" : undefined}
            className={`inline-flex flex-row items-center gap-1.5 rounded-full border ${compact ? "px-2.5 py-0.5" : "px-3 py-1"} text-xs font-semibold ${on ? `${selectedBg} ${statusTokens.info.accentBorder} ${strong}` : `${compact ? "border-transparent" : hairline} ${note ? strong : muted}`}`}
          >
            {note ? (
              <FontAwesomeIcon
                icon="circle-check"
                className={`h-3 w-3 ${statusTokens.success.icon}`}
                aria-label="Done"
              />
            ) : (
              <span aria-hidden="true">{i + 1}</span>
            )}
            {s.label}
            {note && !compact ? (
              <span className={`font-normal ${muted}`}>· {note}</span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
};

/**
 * A plan's settings as a table (the approved "does" and "settings" frames):
 * each one's name, what it starts as (on / off as a switch) and its kind;
 * + Add a setting. Typed as text; back to each one's kind on Done.
 * `doneRef.current()` applies what's here (the row's Done, step 2's Next).
 */
export const SettingsEditor = ({ settings, onDone, doneRef }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [values, setValues] = useState(() => {
    const out = {};
    for (const k of Object.keys(settings)) {
      out[k] =
        typeof settings[k] === "boolean"
          ? settings[k]
          : settingText(settings[k]);
    }
    return out;
  });
  const [added, setAdded] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const add = () => {
    const key = settingKey(newName);
    if (!key) return;
    if (!(key in values)) setAdded((cur) => [...cur, key]);
    setValues((v) => ({ ...v, [key]: newValue }));
    setNewName("");
    setNewValue("");
  };
  const done = () => {
    const out = {};
    for (const k of Object.keys(values)) {
      out[k] = added.includes(k)
        ? values[k]
        : typedBack(settings[k], values[k]);
    }
    // A name typed but not added yet goes too.
    const key = settingKey(newName);
    if (key && !(key in out)) out[key] = newValue;
    onDone(out);
  };
  if (doneRef) doneRef.current = done;
  const keys = Object.keys(values);
  return (
    <div className="flex flex-col gap-2" data-testid="review-settings-editor">
      {keys.length ? (
        <div className="flex flex-col">
          <div
            className={`flex flex-row gap-3 pb-1 text-xs font-semibold ${muted}`}
          >
            <span className="w-48 flex-shrink-0">Setting</span>
            <span className="flex-1 min-w-0">Starts as</span>
            <span className="w-36 flex-shrink-0">Kind</span>
          </div>
          {keys.map((k) => (
            <div
              key={k}
              className={`flex flex-row items-center gap-3 py-1 border-t ${hairline}`}
              data-testid="setting-row"
            >
              <span className={`w-48 flex-shrink-0 text-sm ${strong}`}>
                {settingLabel(k)}
              </span>
              <span className="flex-1 min-w-0">
                {typeof values[k] === "boolean" ? (
                  <Switch
                    ariaLabel={settingLabel(k)}
                    checked={values[k]}
                    onChange={(on) =>
                      setValues((cur) => ({ ...cur, [k]: !!on }))
                    }
                  />
                ) : (
                  <InputText
                    height="h-8"
                    padding="px-2 py-1"
                    ariaLabel={settingLabel(k)}
                    value={values[k]}
                    onChange={(v) =>
                      setValues((cur) => ({
                        ...cur,
                        [k]: typeof v === "string" ? v : "",
                      }))
                    }
                  />
                )}
              </span>
              <span className={`w-36 flex-shrink-0 text-xs ${muted}`}>
                {added.includes(k) ? "Text" : settingKind(settings[k])}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className={`text-sm ${muted}`}>No settings yet.</span>
      )}
      {!adding ? (
        <div>
          <TextLink title="+ Add a setting" onClick={() => setAdding(true)} />
        </div>
      ) : (
        <div className="flex flex-row items-end gap-2">
          <div className="flex-1 min-w-0">
            <InputText
              label="Name"
              value={newName}
              onChange={(v) => setNewName(typeof v === "string" ? v : "")}
            />
          </div>
          <div className="flex-1 min-w-0">
            <InputText
              label="Starts as"
              value={newValue}
              onChange={(v) => setNewValue(typeof v === "string" ? v : "")}
            />
          </div>
          <Button3
            size="sm"
            title="Add"
            disabled={!settingKey(newName)}
            onClick={add}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Step 5 · Review & build (the approved overview / missing frames): every
 * part of the widget, one row each — You chose or Proposed — with Change;
 * the plan's own buttons under it. Nothing is built until the user says yes.
 *
 * @param {object} plan, piece      the plan and the wizard's widget
 * @param {Array} providers         the user's providers (providers.json)
 * @param {string[]} picked         what the user picked in step 1
 * @param {object} reads            readsFromStep
 * @param {string} where            the cell, in words
 * @param {() => void} onChoose     Reads from's Change / Choose
 * @param {(settings) => void} onSettings  the settings, changed
 * @param {(label) => void} onChat  a part changed in the chat
 * @param {(step) => void} onStep  back to its step ("does" / "talks")
 * @param {node} footer             the plan's buttons
 */
export const StepReview = ({
  plan,
  piece,
  providers = [],
  picked = [],
  reads = null,
  where = "",
  edited = {},
  onChoose,
  onSettings,
  onChat,
  onStep = () => {},
  footer = null,
  readOnly = false,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [open, setOpen] = useState(null);
  const doneRef = useRef(null);
  const { rows, setCount, total, isNew } = reviewRows(plan, piece, {
    providers,
    picked,
    reads,
    where,
    edited,
  });
  const toChoose = total - setCount;
  return (
    <div
      role="region"
      aria-label="The widget, as it will be built"
      className={`${readOnly ? "dr-chat-card" : "dr-chat-answer"} self-start w-full flex flex-col rounded-2xl border overflow-hidden ${hairline}`}
      data-testid="wizard-review"
    >
      <div
        className={`flex flex-row items-center gap-3 px-4 py-3 border-b ${hairline}`}
      >
        <span
          className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg border ${hairline}`}
          aria-hidden="true"
        >
          <FontAwesomeIcon icon="table-cells-large" className={muted} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="flex flex-row flex-wrap items-center gap-2">
            <span className={`text-base font-semibold ${strong}`}>
              {widgetLabel(piece)}
            </span>
            <StatusBadge
              compact
              state="info"
              label={isNew ? "New widget" : "Your widget"}
            />
          </span>
          <span className={`text-xs ${muted}`}>
            Everything it will do — check each part. Changing one now costs
            nothing; changing it after it&apos;s built means building it again.
          </span>
        </span>
        <StatusBadge
          state={toChoose ? "warning" : "success"}
          label={
            toChoose
              ? `${setCount} of ${total} set · ${toChoose} to choose`
              : `${total} of ${total} set`
          }
        />
      </div>
      {rows.map((r) => {
        const isOpen = open === r.key;
        const settings =
          piece.settings && typeof piece.settings === "object"
            ? piece.settings
            : {};
        return (
          <div
            key={r.key}
            className={`flex flex-col gap-3 px-4 py-3 border-b ${hairline} ${!r.set ? statusTokens.warning.bg : isOpen ? selectedBg : ""}`}
            data-testid="review-row"
            data-key={r.key}
            data-set={r.set ? "true" : "false"}
          >
            <div className="flex flex-row items-start gap-3">
              <FontAwesomeIcon
                icon={r.set ? "circle-check" : "circle-exclamation"}
                className={`h-4 w-4 mt-1 flex-shrink-0 ${r.set ? statusTokens.success.icon : statusTokens.warning.icon}`}
                aria-label={r.set ? "Set" : "To choose"}
              />
              <span
                className={`w-40 flex-shrink-0 text-sm font-semibold ${strong}`}
              >
                {r.label}
              </span>
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                {r.value.map((v, i) => (
                  <span
                    key={i}
                    className={`text-sm ${r.set ? strong : statusTokens.warning.text}`}
                  >
                    {v}
                  </span>
                ))}
                {r.sub ? (
                  <span className={`text-xs ${muted}`}>{r.sub}</span>
                ) : null}
              </span>
              <span className="w-44 flex-shrink-0 flex flex-row items-center justify-end gap-2">
                {r.tag ? (
                  <StatusBadge
                    state={r.tag === "You chose" ? "success" : "neutral"}
                    label={r.tag}
                  />
                ) : null}
                {readOnly || !r.change ? null : r.change === "choose" ? (
                  <Button size="sm" title="Choose" onClick={onChoose} />
                ) : isOpen ? (
                  <Button
                    size="sm"
                    title="Done"
                    ariaLabel={`Done changing ${r.label}`}
                    onClick={() => doneRef.current && doneRef.current()}
                  />
                ) : (
                  <Button2
                    size="sm"
                    title="Change"
                    ariaLabel={`Change ${r.label}`}
                    onClick={() => {
                      if (r.change === "provider") onChoose();
                      else if (r.change === "settings") setOpen(r.key);
                      else if (
                        r.change === "does" ||
                        r.change === "talks" ||
                        r.change === "looks"
                      )
                        onStep(r.change);
                      else onChat(r.label);
                    }}
                  />
                )}
              </span>
            </div>
            {isOpen && r.key === "settings" ? (
              <div className={`ml-7 rounded-lg border p-3 ${hairline}`}>
                <SettingsEditor
                  settings={settings}
                  doneRef={doneRef}
                  onDone={(next) => {
                    setOpen(null);
                    onSettings(next);
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-row flex-wrap items-center gap-3 px-4 py-3">
        {footer}
        <span
          className={`text-xs ${toChoose ? statusTokens.warning.text : muted}`}
        >
          {toChoose
            ? "Choose what it reads from first"
            : "Nothing is built until you say yes"}
        </span>
      </div>
    </div>
  );
};

/**
 * How it will look (the overview's right side): the widget's name and the
 * Planner's sample lines — a sketch, not the widget.
 */
export const ReviewSketch = ({ sketch, where = "" }) => {
  const { muted, strong, hairline } = useConfigTokens();
  if (!sketch) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="wizard-sketch">
      <span className={`text-sm font-semibold ${strong}`}>
        How it will look
      </span>
      <span className={`text-xs ${muted}`}>
        A sketch from the plan&apos;s sample — the preview after it&apos;s built
        shows your real data.
      </span>
      <div className={`flex flex-col rounded-xl border p-3 ${hairline}`}>
        <span
          className={`pb-2 border-b text-sm font-semibold ${hairline} ${strong}`}
        >
          {sketch.title}
        </span>
        {sketch.lines.length ? (
          sketch.lines.map((l, i) => (
            <span
              key={i}
              className={`py-2 border-b text-sm ${hairline} ${strong}`}
            >
              {l}
            </span>
          ))
        ) : (
          <span className={`py-2 text-sm ${muted}`}>{sketch.empty}</span>
        )}
      </div>
      {where ? <span className={`text-xs ${muted}`}>{where}</span> : null}
    </div>
  );
};
