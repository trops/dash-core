import React, { useContext, useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  ButtonIcon,
  InputText,
  Modal,
  RadioGroup,
  SelectInput,
  SelectableCard,
  SubHeading3,
  TextArea,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  CheckKindEditor,
  KIND_INTRO,
  checkOfKind,
} from "../Flows/CheckKindEditor";
import { AddCheckScreen } from "./AddCheckScreen";
import { checkCost } from "./checkCost";
import { useCheckStats } from "./useCheckStats";
import {
  AUTO_KINDS,
  BUILT_IN_CHOICES,
  MAX_CHECKS,
  TONE,
  TRIES,
  WHO,
  addStep,
  autoKindOf,
  changeKind,
  choiceOf,
  draftError,
  draftOf,
  moveStep,
  newCheck,
  removeStep,
  savedChecks,
  stepSub,
  stepTone,
  turnOnStep,
  updateStep,
  whoOf,
} from "./checksView";

// What a check gets: the bot's answer (electron/bots/botChecks.js workOutput).
const FIELD_ROWS = [{ path: "input.answer", kind: "text" }];

/**
 * One size wherever the window opens (DASH-127): from the bot, over a job,
 * while adding a check. Capped to the app window on small screens.
 */
export const CHECKS_WINDOW = { width: 1040, height: 760 };
const LIST_WIDTH = 300;

/** A new step of a STEP_CHOICES kind, ready to edit. */
function startOf(choice) {
  const step = newCheck(choice);
  // A script starts from the template, like the flow editor's.
  return choice === "script"
    ? { ...step, check: checkOfKind("script", FIELD_ROWS) }
    : step;
}

/**
 * BotChecksModal — "<Bot>'s checks" (bot-checks PRD CHK-002; DASH-127
 * screens 7, 4b, 4c). Left, "Its checks": top to bottom, each with its
 * rough cost and time, moved by drag (⋮⋮) or ▲▼, then what happens when
 * one fails. Right, "The selected check": its name and who decides, each
 * choice's settings inside its own box. Nothing else: where its work goes
 * is on the bot's Settings tab ("Sends its work to"). Nothing is saved
 * until Save checks.
 *
 * @param {object} bot
 * @param {object[]} members   the team (who can review)
 * @param {(save) => Promise} onSave  { checks }
 * @param {() => void} onClose
 * @param {string} [footerNote]  a line by the buttons ("Changes apply from
 *   Planner's next run.")
 * @param {boolean} [handsOn]  no longer used: "Hands on" moved to the
 *   bot's Settings tab (DASH-127). Callers may still pass it.
 */
export const BotChecksModal = ({
  bot,
  members = [],
  onSave,
  onClose,
  footerNote = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const { muted, strong, hairline, fieldBg, selectedBg, selectedBorder } =
    useConfigTokens();
  const status = useStatusTokens();
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const [draft, setDraft] = useState(() => draftOf(bot && bot.checks));
  const [selected, setSelected] = useState(
    bot && bot.checks && (bot.checks.steps || []).length ? 0 : null,
  );
  const [adding, setAdding] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const stats = useCheckStats(bot);
  if (!bot) return null;

  // Bots on its team, not itself: who can review.
  const others = members.filter(
    (m) =>
      m &&
      m.id !== bot.id &&
      (m.workspaceId === undefined ||
        bot.workspaceId === undefined ||
        String(m.workspaceId) === String(bot.workspaceId)),
  );
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || null;
  const step = !adding && selected != null ? draft.steps[selected] : null;
  const full = draft.steps.length >= MAX_CHECKS;
  const last = draft.steps.length - 1;

  const addAtEnd = (s) => {
    const at = draft.steps.length;
    // A reviewer starts on the team's only other bot.
    const ready =
      s && s.kind === "reviewer" && !s.botId && others.length
        ? { ...s, botId: others[0].id }
        : s;
    setDraft((d) => addStep(d, at, ready));
    setSelected(at);
    setAdding(false);
    setError("");
  };
  const move = (from, to) => {
    if (from === to || to < 0 || to > last) return;
    setDraft((d) => moveStep(d, from, to));
    if (selected === from) setSelected(to);
    else if (selected != null) {
      // The selected one keeps its place in the new order.
      const order = moveStep(
        { steps: draft.steps.map((_, i) => i) },
        from,
        to,
      ).steps;
      setSelected(order.indexOf(selected));
    }
  };
  // Changes go to the step by its id: an answer that comes back later
  // (Write it with AI) still lands on its own step after a move, or nowhere
  // once it's removed.
  const stepId = step ? step.id : null;
  const patchStep = (p) =>
    setDraft((d) => {
      const i = d.steps.findIndex((s) => s.id === stepId);
      return i < 0 ? d : updateStep(d, i, p);
    });
  const patchCheck = (p) =>
    setDraft((d) => {
      const i = d.steps.findIndex((s) => s.id === stepId);
      if (i < 0 || !d.steps[i].check) return d;
      return updateStep(d, i, { check: { ...d.steps[i].check, ...p } });
    });
  // The selected step turned into another kind (its name kept if yours).
  const turnInto = (choice) => {
    if (!step || choice === choiceOf(step)) return;
    let next = changeKind(step, choice);
    if (choice === "script") {
      next = { ...next, check: checkOfKind("script", FIELD_ROWS) };
    }
    if (next.kind === "reviewer" && !next.botId && others.length) {
      next = { ...next, botId: others[0].id };
    }
    setDraft((d) => updateStep(d, selected, next));
  };
  const pickWho = (who) => {
    if (!step || who === whoOf(step)) return;
    turnInto(who === "rule" ? "rules" : who);
  };

  const save = async () => {
    const problem = draftError(draft, bot.id);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({ checks: savedChecks(draft) });
    } catch (err) {
      // Refused before anything changed (the dashboard is being edited):
      // its own words. Otherwise part of it may have saved.
      setError(
        err && err.refused
          ? err.message
          : `Couldn't save all of it: ${(err && err.message) || String(err)}. Close and reopen to see what saved.`,
      );
      setSaving(false);
    }
  };

  const arrow = (up, name, disabled, onClick) => (
    <button
      type="button"
      className={`px-1.5 text-xs leading-none rounded border ${hairline} ${fieldBg} ${
        disabled ? "opacity-30 cursor-default" : "cursor-pointer"
      }`}
      aria-label={`Move ${name} ${up ? "up" : "down"}`}
      disabled={disabled}
      onClick={onClick}
    >
      {up ? "▲" : "▼"}
    </button>
  );

  const row = (s, i) => {
    const active = !adding && i === selected;
    const name = s.name || TONE[stepTone(s)].label;
    return (
      <div
        key={s.id || i}
        data-testid={`check-row-${i}`}
        draggable
        onDragStart={() => setDragFrom(i)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (dragFrom != null) move(dragFrom, i);
          setDragFrom(null);
        }}
        onDragEnd={() => setDragFrom(null)}
        className={`flex flex-row items-center gap-2 p-2 rounded-lg border ${
          active ? `${selectedBorder} ${selectedBg}` : "border-transparent"
        } ${dragFrom === i ? "opacity-50" : ""}`}
      >
        <span
          className={`cursor-grab select-none text-sm px-0.5 ${muted}`}
          title="Drag to reorder"
          aria-hidden="true"
        >
          ⋮⋮
        </span>
        <span className={`text-xs w-4 text-right ${muted}`}>{i + 1}</span>
        <button
          type="button"
          className="flex-1 min-w-0 flex flex-col text-left"
          onClick={() => {
            setSelected(i);
            setAdding(false);
          }}
          aria-current={active ? "true" : undefined}
          title={stepSub(s, nameOf)}
        >
          <span className={`text-sm truncate ${strong}`}>
            {`${name}${s.held ? " (off)" : ""}`}
          </span>
          <span className={`text-xs truncate ${muted}`}>
            {checkCost(s, stats[s.id])}
          </span>
        </button>
        <span className="flex flex-col gap-0.5">
          {arrow(true, name, i === 0, () => move(i, i - 1))}
          {arrow(false, name, i === last, () => move(i, i + 1))}
        </span>
      </div>
    );
  };

  // One "Who decides" choice: its box, and its settings inside once picked.
  const whoBox = (w, settings) => {
    const on = !!step && whoOf(step) === w.value;
    const noReviewer = w.value === "reviewer" && !others.length;
    return (
      <div
        key={w.value}
        className={`flex flex-col gap-3 p-3 rounded-lg border ${
          on ? `${selectedBorder} ${selectedBg}` : hairline
        } ${noReviewer && !on ? "opacity-60" : ""}`}
        data-testid={`who-${w.value}`}
      >
        <label className="flex flex-row items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name={`who-${stepId}`}
            className="mt-1"
            checked={on}
            disabled={noReviewer && !on}
            onChange={() => pickWho(w.value)}
          />
          <span className="flex flex-col gap-0.5">
            <span className={`text-sm font-semibold ${strong}`}>{w.label}</span>
            <span className={`text-xs ${muted}`}>
              {noReviewer
                ? "There's no other bot on this team, so you approve."
                : w.hint}
            </span>
          </span>
        </label>
        {on && settings ? (
          <div className="pl-7 flex flex-col gap-3">{settings}</div>
        ) : null}
      </div>
    );
  };

  const autoSettings = () => {
    if (!step || whoOf(step) !== "rule") return null;
    const card = autoKindOf(step);
    const choice = choiceOf(step);
    return (
      <>
        <div
          role="group"
          aria-label="Kind of automatic check"
          className="grid grid-cols-2 gap-2"
        >
          {AUTO_KINDS.map((k) => (
            <SelectableCard
              key={k.value}
              label={k.label}
              description={k.hint}
              selected={card === k.value}
              onSelect={() => card !== k.value && turnInto(k.start)}
            />
          ))}
        </div>
        {card === "builtin" ? (
          <div className="max-w-md">
            <SelectInput
              label="Built-in check"
              value={choice}
              options={BUILT_IN_CHOICES}
              onChange={(v) => v && turnInto(v)}
            />
          </div>
        ) : null}
        {step.kind === "check" && step.check ? (
          <>
            <span className={`text-sm ${muted}`}>
              {KIND_INTRO[step.check.kind]}
            </span>
            <CheckKindEditor
              key={`${step.id}-${step.check.kind}`}
              check={step.check}
              onPatch={patchCheck}
              workspaceId={bot.workspaceId}
              fieldRows={FIELD_ROWS}
              name={step.name}
              runsIn={`${bot.name}'s folder`}
              onError={setError}
              uniqueKey={`${bot.id}-${step.id}`}
            />
          </>
        ) : null}
      </>
    );
  };

  const reviewerSettings = () =>
    step && step.kind === "reviewer" ? (
      <>
        <div className="max-w-xs">
          <SelectInput
            label="Which bot (bots on this team)"
            value={step.botId || ""}
            placeholder="Choose a bot"
            options={others.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(botId) => patchStep({ botId })}
          />
        </div>
        <TextArea
          label="What it looks for (optional)"
          value={step.note || ""}
          rows={3}
          placeholder="e.g. it covers every acceptance item"
          onChange={(v) => patchStep({ note: v })}
        />
        <span className={`text-xs ${muted}`}>
          It reads the work and says pass or fail, with why. It can&apos;t
          change the work.
        </span>
      </>
    ) : null;

  const selectedCheck = step ? (
    <>
      <InputText
        label="Name"
        value={step.name || ""}
        onChange={(v) => patchStep({ name: v })}
      />
      {step.held ? (
        <div className="flex flex-col gap-2" data-testid="held-check">
          <AlertBanner
            variant="warning"
            size="compact"
            message="This command came with the package, so it's off: Dash won't run it on this computer until you turn it on. Until then, its jobs wait for you to approve the work."
          />
          <code className="font-mono text-xs break-all">
            {(step.check &&
              (step.check.command ||
                (step.check.fallback && step.check.fallback.command) ||
                step.check.package)) ||
              ""}
          </code>
          <div>
            <Button
              title="Turn on"
              size="sm"
              onClick={() => setDraft((d) => turnOnStep(d, selected))}
            />
          </div>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2 border-0 m-0 p-0">
        <legend className={`text-sm font-semibold pb-2 ${strong}`}>
          Who decides
        </legend>
        {WHO.map((w) =>
          whoBox(
            w,
            w.value === "rule"
              ? autoSettings()
              : w.value === "reviewer"
                ? reviewerSettings()
                : null,
          ),
        )}
      </fieldset>
      <div className="flex flex-row pt-2">
        <span className="flex-1" />
        <Button3
          title="Remove this check"
          size="sm"
          onClick={() => {
            setDraft((d) => removeStep(d, selected));
            setSelected(null);
          }}
        />
      </div>
    </>
  ) : (
    <span className={`text-sm ${muted}`}>
      Pick a check on the left to change it, or add one.
    </span>
  );

  const addScreen = (
    <div className="flex flex-col gap-4" data-testid="add-check">
      {/* Add check (DASH-110): who decides, suggestions, describe it. */}
      <AddCheckScreen
        bot={bot}
        canReview={others.length > 0}
        onAdd={addAtEnd}
        onCancel={() => setAdding(false)}
      />
      <div className="flex flex-col gap-2">
        <span className={`text-xs ${muted}`}>Or start a blank one:</span>
        <div className="flex flex-row flex-wrap gap-1">
          {AUTO_KINDS.map((k) => (
            <Button3
              key={k.value}
              title={k.label}
              size="sm"
              onClick={() => addAtEnd(startOf(k.start))}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen
      setIsOpen={(o) => !o && onClose()}
      width="max-w-full"
      height="max-h-full"
    >
      <div
        className={`flex flex-col min-h-0 rounded-lg border ${hairline} ${panel.backgroundColor || ""} ${panel.textColor || strong}`}
        style={{
          width: CHECKS_WINDOW.width,
          height: CHECKS_WINDOW.height,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 32px)",
        }}
        data-testid="bot-checks-modal"
      >
        <div
          className={`flex-shrink-0 flex flex-row items-start gap-3 px-5 py-4 border-b ${hairline}`}
        >
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SubHeading3 title={`${bot.name}'s checks`} padding={false} />
            <span className={`text-sm ${muted}`}>
              {`They prove ${bot.name}'s work is done, every time it runs. Top to bottom; the first that fails stops them.`}
            </span>
          </div>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-row">
          <div
            className={`flex-shrink-0 min-h-0 overflow-y-auto flex flex-col gap-1 p-3 border-r ${hairline}`}
            style={{ width: LIST_WIDTH }}
            data-testid="checks-list"
          >
            <span
              className={`px-2 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-wide ${muted}`}
            >
              Its checks
            </span>
            {draft.steps.map(row)}
            {!draft.steps.length ? (
              <span className={`px-2 text-sm ${muted}`}>
                {`No checks yet: ${bot.name}'s work goes straight on.`}
              </span>
            ) : draft.steps.length > 1 ? (
              <span className={`px-2 text-xs ${muted}`}>
                Drag ⋮⋮ or use ▲▼. Cheapest first saves money: a fail stops the
                rest.
              </span>
            ) : null}
            <div className="pt-2">
              <Button3
                title="+ Add check"
                size="sm"
                disabled={full || adding}
                onClick={() => setAdding(true)}
              />
            </div>

            <div className={`my-3 border-t ${hairline}`} />
            <span className={`text-sm font-semibold ${strong}`}>
              If a check fails
            </span>
            <RadioGroup
              value={draft.onFail}
              onChange={(onFail) => setDraft((d) => ({ ...d, onFail }))}
              options={[
                {
                  value: "retry",
                  label: `${bot.name} tries again, told what failed`,
                },
                { value: "you", label: "It comes to you" },
                { value: "stop", label: "The job fails" },
              ]}
            />
            {draft.onFail !== "you" ? (
              <span className={`text-xs ${muted}`}>
                {`When it fails, ${bot.name}'s Failed event goes out with the reason, so whatever listens for it runs.`}
              </span>
            ) : null}
            {draft.onFail === "retry" ? (
              <div className="pt-2">
                <SelectInput
                  label="Tries, at most"
                  value={String(draft.maxTries)}
                  options={[...new Set([...TRIES, draft.maxTries])]
                    .sort((a, b) => a - b)
                    .map((n) => ({
                      value: String(n),
                      label: `${n}, then it fails`,
                    }))}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, maxTries: Number(v) || 3 }))
                  }
                />
              </div>
            ) : null}
          </div>

          <aside
            aria-label="The selected check"
            className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col gap-3 px-5 py-4"
            data-testid="selected-check"
          >
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
            >
              {adding ? "Add a check" : "The selected check"}
            </span>
            {adding ? addScreen : selectedCheck}
          </aside>
        </div>

        <div
          className={`flex-shrink-0 flex flex-row items-center gap-3 px-5 py-3 border-t ${hairline}`}
        >
          {error ? (
            <span
              className={`flex-1 text-sm ${status.error.text}`}
              role="alert"
            >
              {error}
            </span>
          ) : footerNote ? (
            <span
              className={`flex-1 text-sm ${muted}`}
              data-testid="checks-footer-note"
            >
              {footerNote}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={saving ? "Saving…" : "Save checks"}
            size="sm"
            disabled={saving}
            onClick={save}
          />
        </div>
      </div>
    </Modal>
  );
};

export default BotChecksModal;
