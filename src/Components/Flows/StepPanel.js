import React, { useState } from "react";
import {
  Button,
  Button3,
  InputText,
  SelectInput,
  StatusBadge,
  Switch,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { SidePanel, PanelSection } from "./SidePanel";
import { chainOrder, failTargetOf, inputStepOf } from "./flowText";

const nextOf = (flow, id) => {
  const e = (flow.edges || []).find((x) => x.kind === "next" && x.from === id);
  return e ? (flow.steps || []).find((s) => s.id === e.to) : null;
};
const prevOf = (flow, id) => {
  const e = (flow.edges || []).find((x) => x.kind === "next" && x.to === id);
  return e ? (flow.steps || []).find((s) => s.id === e.from) : null;
};

/** "A goal's status becomes 'CI passed'": what starts a step. */
function startsWhen(flow, step) {
  if (step.kind === "source")
    return "On its own schedule, or when something comes in";
  const before = prevOf(flow, step.id);
  if (!before) return "When a goal in this flow starts";
  if (before.kind === "check") return `A goal passes "${before.name}"`;
  if (before.kind === "you") return `You approve at "${before.name}"`;
  if (before.kind === "source") return "A goal starts";
  return `"${before.name}" finishes`;
}

function checkedBy(flow, step) {
  const after = nextOf(flow, step.id);
  if (!after) return "Nothing after it: what it makes is final";
  if (after.kind === "check") return `${after.name}, a check with no AI`;
  if (after.kind === "you") return "You, before it goes on";
  if (after.judgment) return `${after.name} (judgment)`;
  return `Nothing: ${after.name} takes what it makes`;
}

function cantArgueWith(flow, step) {
  const facts = [];
  for (const s of chainOrder(flow)) {
    if (
      s.kind === "check" &&
      failTargetOf(flow, s.id) &&
      failTargetOf(flow, s.id).id === step.id
    ) {
      facts.push(`what ${s.name} checks`);
    }
  }
  if (flow.criteria && flow.criteria.length)
    facts.push("the goal's criteria (locked)");
  if (facts.length === 0) facts.push("the goal's criteria (locked)");
  return facts.join(" · ");
}

/**
 * StepPanel — a step opened (frame 6): what starts it, what it reads and
 * writes, what checks it, what it can't argue with, what done means, its
 * tools and limits — and what you can change: its bot, what it does, its
 * record's fields, judgment. A "you" step: what you do there.
 */
export const StepPanel = ({
  flow,
  step,
  bot = null,
  bots = [],
  onSave,
  onRemove,
  onClose,
  onOpenFields,
  onOpenBot,
  mode = "edit",
  between = null,
  onAdd,
}) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const [note, setNote] = useState(step ? step.note || "" : "");
  const [name, setName] = useState(step ? step.name : "New step");
  const [botId, setBotId] = useState(step ? step.botId || "" : "");
  const [judgment, setJudgment] = useState(!!(step && step.judgment));
  const [action, setAction] = useState(
    step ? step.action || "Approve" : "Approve",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = step ? step.kind : "bot";
  const changed =
    mode === "new" ||
    (step &&
      (note !== (step.note || "") ||
        name !== step.name ||
        botId !== (step.botId || "") ||
        judgment !== !!step.judgment ||
        (kind === "you" && action !== (step.action || "Approve"))));

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const patch = {
        name: name.trim() || (kind === "you" ? "You" : "Step"),
        note: note.trim(),
        ...(kind === "you"
          ? { action: action.trim() || "Approve" }
          : { botId: botId || null }),
        ...(kind === "bot" ? { judgment } : {}),
      };
      const r = mode === "new" ? await onAdd(patch) : await onSave(patch);
      if (r && r.error) setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  const chip =
    kind === "you" ? (
      <StatusBadge state="closed" label="You" />
    ) : kind === "source" ? (
      <StatusBadge state="neutral" label="Source" />
    ) : (
      <StatusBadge state="closed" label={judgment ? "AI · judgment" : "AI"} />
    );

  const reads = step ? inputStepOf(flow, step.id) : null;
  const fields = (step && step.outputs) || [];
  const back = step ? failTargetOf(flow, step.id) : null;

  return (
    <SidePanel
      testId="step-panel"
      chip={chip}
      where={between ? between.text : ""}
      title={
        mode === "new" ? (kind === "you" ? "You approve" : "A bot") : step.name
      }
      intro={
        mode === "new"
          ? kind === "you"
            ? "It waits for you before going on."
            : "A bot works on the work before it goes on."
          : bot && bot.instructions
            ? bot.instructions.split(/\n/)[0].slice(0, 200)
            : step.note
      }
      onClose={onClose}
      footer={
        <>
          {changed ? (
            <Button
              title={mode === "new" ? "Add step" : "Save"}
              size="sm"
              disabled={busy}
              onClick={save}
            />
          ) : null}
          {mode === "edit" && kind !== "you" && step.botId && onOpenBot ? (
            <>
              <Button3
                title="Edit this bot"
                size="sm"
                onClick={() => onOpenBot(step.botId, "settings")}
              />
              <Button3
                title="See its runs"
                size="sm"
                onClick={() => onOpenBot(step.botId, "activity")}
              />
            </>
          ) : null}
          <span className="flex-1" />
          {mode === "edit" && onRemove ? (
            <Button3 title="Remove" size="sm" onClick={onRemove} />
          ) : null}
          {mode === "new" ? (
            <Button3 title="Cancel" size="sm" onClick={onClose} />
          ) : null}
        </>
      }
    >
      {mode === "new" || kind !== "you" ? (
        <InputText label="Name" value={name} onChange={(v) => setName(v)} />
      ) : null}

      {kind !== "you" ? (
        <SelectInput
          label={
            kind === "source"
              ? "The bot that starts goals"
              : "The bot that does it"
          }
          value={botId}
          placeholder="Choose a bot"
          options={bots.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => setBotId(v)}
        />
      ) : (
        <InputText
          label="What you do here"
          value={action}
          onChange={(v) => setAction(v)}
        />
      )}

      <TextArea
        label={kind === "you" ? "A note" : "What this step does or may do"}
        rows={3}
        value={note}
        onChange={(v) => setNote(v)}
      />

      {kind === "bot" ? (
        <div className={`flex flex-row items-center gap-3 ${strong}`}>
          <Switch
            checked={judgment}
            onChange={(v) =>
              setJudgment(typeof v === "boolean" ? v : !judgment)
            }
            label="Judges the work (a reviewer)"
          />
        </div>
      ) : null}

      {mode === "edit" && kind !== "you" ? (
        <>
          <PanelSection label="Starts when">
            {startsWhen(flow, step)}
          </PanelSection>
          <PanelSection label="Reads → writes">
            {`${reads ? `${reads.name}'s record` : "What started the goal"}${
              flow.criteria && flow.criteria.length
                ? ", the goal's criteria"
                : ""
            } → writes its record${
              fields.length ? `: ${fields.map((f) => f.name).join(", ")}` : ""
            }${back ? `, or a fix list back to ${back.name}` : ""}`}
            <div className="pt-1">
              <button
                type="button"
                className="text-xs font-semibold underline"
                onClick={() => onOpenFields(step.id)}
              >
                {fields.length
                  ? "What its record must have"
                  : "Say what its record must have"}
              </button>
            </div>
          </PanelSection>
          <PanelSection label="Checked by">
            {checkedBy(flow, step)}
          </PanelSection>
          <PanelSection label="Can't argue with">
            {cantArgueWith(flow, step)}
          </PanelSection>
          <PanelSection label="Done means">
            {fields.filter((f) => f.required).length
              ? `Its record fills ${fields
                  .filter((f) => f.required)
                  .map((f) => f.name)
                  .join(
                    ", ",
                  )}${step.judgment ? ", and every criterion has proof" : ""}`
              : step.judgment
                ? "Every criterion has proof: a passing test, a screenshot, or a CI line"
                : "It writes a passed record"}
          </PanelSection>
          {bot ? (
            <>
              <PanelSection label="Tools">
                {(bot.mcpServers || []).length
                  ? (bot.mcpServers || []).join(" · ")
                  : "No providers: it works from what it's given"}
                {bot.approvalPolicy === "allow"
                  ? " · runs without asking"
                  : " · asks before it changes anything"}
              </PanelSection>
              <PanelSection label="Limits">
                {`${bot.maxMinutes || bot.limits?.minutes || 20} min and ${
                  bot.maxSteps || bot.limits?.steps || 60
                } steps a run · ${flow.maxRounds || 3} rounds a goal, then it comes to you`}
              </PanelSection>
            </>
          ) : step.botId ? (
            <span className={`text-sm ${status.warning.text}`}>
              Its bot was deleted. Choose another one above.
            </span>
          ) : null}
        </>
      ) : null}

      {error ? (
        <span className={`text-sm ${status.error.text}`} role="alert">
          {error}
        </span>
      ) : null}
      {mode === "edit" && kind === "you" ? (
        <span className={`text-xs ${muted}`}>
          Goals that reach this step wait in Needs you until you mark them done.
        </span>
      ) : null}
    </SidePanel>
  );
};

export default StepPanel;
