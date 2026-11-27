import React, { useContext, useMemo, useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  InputText,
  Modal,
  RadioGroup,
  SegmentedControl,
  SelectInput,
  SubHeading3,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CheckKindEditor, KIND_INTRO } from "../Flows/CheckKindEditor";
import { PanelSection } from "../Flows/SidePanel";
import { BotAvatar } from "./BotAvatar";
import { triggerSummary } from "./teamUtils";
import {
  MAX_CHECKS,
  STEP_CHOICES,
  TONE,
  TRIES,
  addStep,
  changeKind,
  choiceOf,
  draftError,
  draftOf,
  handsOnChoices,
  handsOnTargets,
  moveStep,
  newCheck,
  removeStep,
  savedChecks,
  stepSub,
  stepTone,
  targetChanges,
  updateStep,
  turnOnStep,
} from "./checksView";

const HANDS_ON_OPTIONS = [
  { value: "answer", label: "Its whole answer" },
  { value: "summary", label: "Only the summary" },
];

// What a check gets: the bot's answer (electron/bots/botChecks.js workOutput).
const FIELD_ROWS = [{ path: "input.answer", kind: "text" }];

/** The coloured square for a step's kind. */
const ToneIcon = ({ step }) => {
  const tone = TONE[stepTone(step)];
  return (
    <span
      className={`flex-shrink-0 h-6 w-6 rounded flex items-center justify-center text-white text-xs ${tone.bg}`}
      title={tone.label}
    >
      <FontAwesomeIcon icon={tone.icon} />
    </span>
  );
};

/**
 * BotChecksModal — "<Bot>'s checks" (bot-checks PRD CHK-002, frame 2): the
 * bot's run, then its checks top to bottom with + between them (drag a
 * check to move it), the selected check on the right, what happens when a
 * check fails, and what it hands on to whom. Nothing is saved until Save.
 *
 * @param {object} bot
 * @param {object[]} members   the team (for reviewers and hands on)
 * @param {object[]} widgets   diagramWidgets()
 * @param {object[]} wEdges    widgetEdges()
 * @param {(save) => Promise} onSave  { checks, adds, removes }
 * @param {() => void} onClose
 */
export const BotChecksModal = ({
  bot,
  members = [],
  widgets = [],
  wEdges = [],
  onSave,
  onClose,
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
  const [adding, setAdding] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const before = useMemo(
    () => handsOnTargets(bot, members, widgets, wEdges),
    // Only what it had when the window opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [targets, setTargets] = useState(before);
  if (!bot) return null;

  const others = members.filter((m) => m && m.id !== bot.id);
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || null;
  const step = selected != null ? draft.steps[selected] : null;
  const choices = handsOnChoices(bot, members, widgets, targets);
  const full = draft.steps.length >= MAX_CHECKS;

  const add = (at, choice) => {
    setDraft((d) => addStep(d, at, newCheck(choice)));
    setSelected(at);
    setAdding(null);
    setError("");
  };
  const move = (from, to) => {
    if (from === to) return;
    setDraft((d) => moveStep(d, from, to));
    setSelected(to);
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

  const save = async () => {
    const problem = draftError(draft, bot.id);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        checks: savedChecks(draft),
        ...targetChanges(before, targets),
      });
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

  // The + between steps, and the kinds it offers when open.
  const plus = (at) => (
    <div key={`plus-${at}`} className="flex flex-col items-start pl-3">
      <span className={`w-px h-3 border-l ${hairline}`} />
      {adding === at ? (
        <div
          className={`flex flex-row flex-wrap gap-1 p-2 rounded-lg border ${hairline} ${fieldBg}`}
          data-testid={`add-menu-${at}`}
        >
          {STEP_CHOICES.map((c) => (
            <Button3
              key={c.value}
              title={c.label}
              size="sm"
              onClick={() => add(at, c.value)}
            />
          ))}
          <Button3 title="Cancel" size="sm" onClick={() => setAdding(null)} />
        </div>
      ) : (
        <ButtonIcon
          icon="plus"
          size="xs"
          ariaLabel={
            at === draft.steps.length
              ? "Add a check"
              : `Add a check here (${at + 1})`
          }
          disabled={full}
          onClick={() => setAdding(at)}
        />
      )}
      <span className={`w-px h-3 border-l ${hairline}`} />
    </div>
  );

  const row = (s, i) => {
    const active = i === selected;
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
        className={`flex flex-row items-center gap-3 p-3 rounded-lg border ${
          active ? `${selectedBorder} ${selectedBg}` : `${hairline} ${fieldBg}`
        } ${dragFrom === i ? "opacity-50" : ""}`}
      >
        <button
          type="button"
          className="flex-1 min-w-0 flex flex-row items-center gap-3 text-left"
          onClick={() => setSelected(i)}
          aria-current={active ? "true" : undefined}
        >
          <ToneIcon step={s} />
          <span className="flex-1 min-w-0 flex flex-col">
            <span className={`text-sm font-semibold truncate ${strong}`}>
              {s.name || TONE[stepTone(s)].label}
            </span>
            <span className={`text-xs truncate ${muted}`}>
              {stepSub(s, nameOf)}
            </span>
          </span>
        </button>
        <span
          className={`cursor-grab ${muted}`}
          title="Drag to move it"
          aria-hidden="true"
        >
          <FontAwesomeIcon icon="grip-vertical" />
        </span>
      </div>
    );
  };

  const choice = step ? choiceOf(step) : null;
  const kindOptions = [
    ...STEP_CHOICES,
    ...(choice === "script" ? [{ value: "script", label: "A script" }] : []),
  ];

  return (
    <Modal
      isOpen
      setIsOpen={(o) => !o && onClose()}
      width="w-2/3"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full min-h-0 rounded-lg border ${hairline} ${panel.backgroundColor || ""} ${panel.textColor || strong}`}
        data-testid="bot-checks-modal"
      >
        <div
          className={`flex flex-row items-start gap-3 px-6 py-4 border-b ${hairline}`}
        >
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SubHeading3 title={`${bot.name}'s checks`} padding={false} />
            <span className={`text-sm ${muted}`}>
              {`They prove ${bot.name}'s work is done, every time it runs. Top to bottom; the first fail stops them.`}
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
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col gap-0 p-6">
            <div
              className={`flex flex-row items-center gap-3 p-3 rounded-lg border ${hairline}`}
            >
              <BotAvatar bot={bot} />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className={`text-sm font-semibold ${strong}`}>
                  {`${bot.name} runs`}
                </span>
                <span className={`text-xs ${muted}`}>
                  {`${triggerSummary(bot)}, or when the lead or you ask`}
                </span>
              </span>
            </div>
            {draft.steps.map((s, i) => [plus(i), row(s, i)])}
            {plus(draft.steps.length)}
            {!draft.steps.length ? (
              <span className={`text-sm ${muted}`}>
                {`No checks yet: ${bot.name}'s work goes straight on. Add one with +.`}
              </span>
            ) : null}

            <PanelSection label="If a check fails">
              <RadioGroup
                value={draft.onFail}
                onChange={(onFail) => setDraft((d) => ({ ...d, onFail }))}
                options={[
                  {
                    value: "retry",
                    label: `${bot.name} tries again, told what failed`,
                  },
                  { value: "you", label: "It comes to you" },
                  { value: "stop", label: "It fails" },
                ]}
              />
              {draft.onFail !== "you" ? (
                <span className={`text-xs ${muted}`}>
                  {`When it fails, ${bot.name}'s Failed event goes out with the reason, so whatever listens for it runs.`}
                </span>
              ) : null}
              {draft.onFail === "retry" ? (
                <div className="w-72 pt-2">
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
            </PanelSection>

            <PanelSection label="Hands on" testId="hands-on">
              <div className="flex flex-col gap-2">
                <SegmentedControl
                  ariaLabel="What it hands on"
                  size="sm"
                  value={draft.handsOn}
                  onChange={(handsOn) => setDraft((d) => ({ ...d, handsOn }))}
                  options={HANDS_ON_OPTIONS}
                />
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <span className={`text-sm ${muted}`}>to</span>
                  {targets.map((t) => (
                    <span
                      key={t.key}
                      className={`flex flex-row items-center gap-1 rounded-full border pl-3 pr-1 py-0.5 text-sm ${hairline}`}
                    >
                      <span>{t.name}</span>
                      <ButtonIcon
                        icon="xmark"
                        size="xs"
                        ariaLabel={`Stop handing on to ${t.name}`}
                        onClick={() =>
                          setTargets((list) =>
                            list.filter((x) => x.key !== t.key),
                          )
                        }
                      />
                    </span>
                  ))}
                  {choices.length ? (
                    <div className="w-56">
                      <SelectInput
                        ariaLabel="Hand on to"
                        placeholder="+ Add"
                        value=""
                        options={choices.map((c) => ({
                          value: c.key,
                          label:
                            c.type === "bot" ? c.name : `${c.name} (widget)`,
                        }))}
                        onChange={(key) => {
                          const c = choices.find((x) => x.key === key);
                          if (c) setTargets((list) => [...list, c]);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <span className={`text-xs ${muted}`}>
                  {`Nothing here is fine: then the checks only prove ${bot.name}'s own work. To send it to another widget, drag ${bot.name} onto it on the diagram.`}
                </span>
              </div>
            </PanelSection>
          </div>

          <aside
            aria-label="The selected check"
            className={`w-96 flex-shrink-0 min-h-0 overflow-y-auto flex flex-col gap-3 p-4 border-l ${hairline}`}
            data-testid="selected-check"
          >
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
            >
              The selected check
            </span>
            {step ? (
              <>
                <InputText
                  label="Name"
                  value={step.name || ""}
                  onChange={(v) => patchStep({ name: v })}
                />
                <SelectInput
                  label="Kind"
                  value={choice}
                  options={kindOptions}
                  onChange={(v) => {
                    if (v && v !== choice) {
                      setDraft((d) =>
                        updateStep(d, selected, changeKind(step, v)),
                      );
                    }
                  }}
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
                          (step.check.fallback &&
                            step.check.fallback.command))) ||
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
                {step.kind === "reviewer" ? (
                  <>
                    <SelectInput
                      label="Who reviews"
                      value={step.botId || ""}
                      placeholder="Choose a bot"
                      options={others.map((m) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                      onChange={(botId) => patchStep({ botId })}
                    />
                    <InputText
                      label="What it looks for (optional)"
                      value={step.note || ""}
                      onChange={(v) => patchStep({ note: v })}
                    />
                    <span className={`text-sm ${muted}`}>
                      It reads the work and says pass or fail, with why. It
                      can't change the work.
                    </span>
                  </>
                ) : null}
                {step.kind === "you" ? (
                  <span className={`text-sm ${muted}`}>
                    {`It waits in Jobs for you to approve it, or send it back to ${bot.name} with a reason.`}
                  </span>
                ) : null}
                <div className="flex flex-row flex-wrap gap-2 pt-2">
                  <Button3
                    title="Move up"
                    size="sm"
                    disabled={selected === 0}
                    onClick={() => move(selected, selected - 1)}
                  />
                  <Button3
                    title="Move down"
                    size="sm"
                    disabled={selected === draft.steps.length - 1}
                    onClick={() => move(selected, selected + 1)}
                  />
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
                Pick a check on the left to change it, or add one with +.
              </span>
            )}
          </aside>
        </div>

        <div
          className={`flex flex-row items-center gap-3 px-6 py-3 border-t ${hairline}`}
        >
          {error ? (
            <span
              className={`flex-1 text-sm ${status.error.text}`}
              role="alert"
            >
              {error}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={saving ? "Saving…" : "Save"}
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
