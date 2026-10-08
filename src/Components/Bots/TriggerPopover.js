import React, { useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  RadioGroup,
  SectionLabel,
  SelectInput,
  TextArea,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

const TOOL = "tool";
const isTool = (event) => String(event || "").startsWith("tool.");

/** "Algolia HR › search_index" → "search_index (Algolia HR)". */
const toolLabel = (c) => {
  const [provider, tool] = String(c.label).split(" › ");
  return tool ? `${tool} (${provider})` : c.label;
};

/**
 * TriggerPopover — add or edit one trigger between two team bots on the
 * diagram (bot-teams PRD TEAM-014 AC8/AC9): which of the source bot's events
 * runs the target — Completed, Failed, or "Uses a tool…" (then which tool:
 * a bot can have dozens) — and an optional note for the target
 * ("Then ask it to").
 *
 * @param {{event, label}[]} choices  eventChoices(source, toolSources)
 * @param {"add"|"edit"} mode
 * @param {(t: {event, label, note}) => void} onSave
 */
export const TriggerPopover = ({
  source,
  target,
  choices = [],
  mode = "add",
  initialEvent = null,
  initialNote = "",
  loop = false,
  error = null,
  saving = false,
  onSave,
  onRemove,
  onCancel,
  style = null,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const tools = choices.filter((c) => isTool(c.event));
  const plain = choices.filter((c) => !isTool(c.event));
  const known = choices.some((c) => c.event === initialEvent);
  const [event, setEvent] = useState(
    known ? initialEvent : (plain[0] && plain[0].event) || "completed",
  );
  // The tool picked under "Uses a tool…" (kept while switching back and forth).
  const [tool, setTool] = useState(
    isTool(initialEvent) && known
      ? initialEvent
      : (tools[0] && tools[0].event) || null,
  );
  const [note, setNote] = useState(initialNote || "");
  const kind = isTool(event) ? TOOL : event;
  const chosen = choices.find((c) => c.event === event) || null;

  const pickKind = (v) => {
    if (v === TOOL) {
      if (tool) setEvent(tool);
    } else {
      setEvent(v);
    }
  };
  const pickTool = (v) => {
    setTool(v);
    setEvent(v);
  };
  const save = () =>
    chosen &&
    onSave &&
    onSave({ event: chosen.event, label: chosen.label, note });

  const kinds = [
    ...plain.map((c) => ({ value: c.event, label: c.label })),
    ...(tools.length ? [{ value: TOOL, label: "Uses a tool…" }] : []),
  ];

  return (
    <div
      role="dialog"
      aria-label={`Trigger for ${target.name}`}
      className={`absolute z-10 w-80 rounded-xl border shadow-lg flex flex-col ${hairline} ${fieldBg}`}
      style={style || undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`px-4 py-3 border-b ${hairline}`}>
        <div className={`text-sm font-semibold ${strong}`}>
          {`Run ${target.name}`}
        </div>
        <div className={`text-xs ${muted}`}>{`after ${source.name}`}</div>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <SectionLabel text={`When ${source.name}…`} />
        <RadioGroup
          name={`trigger-${source.id}-${target.id}`}
          value={kind}
          onChange={pickKind}
          options={kinds}
        />
        {kind === TOOL ? (
          <SelectInput
            label="Tool"
            value={tool || ""}
            onChange={pickTool}
            options={tools.map((c) => ({
              value: c.event,
              label: toolLabel(c),
            }))}
          />
        ) : null}
        <SectionLabel text="Then ask it to (optional)" />
        <TextArea
          value={note}
          onChange={(v) =>
            setNote(typeof v === "string" ? v : v?.target?.value || "")
          }
          placeholder="e.g. Check the images in the records it read."
          rows={2}
          autoGrow
        />
        <span className={`text-xs ${muted}`}>
          {`${target.name} gets the event's details plus this note.`}
        </span>
        {loop ? (
          <AlertBanner
            variant="warning"
            size="compact"
            message="This makes a loop — loops stop after 5 runs."
          />
        ) : null}
        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
      </div>
      <div
        className={`px-4 py-3 border-t flex flex-row items-center gap-2 ${hairline}`}
      >
        {mode === "edit" ? (
          <Button3 title="Remove" size="sm" onClick={onRemove} />
        ) : null}
        <div className="flex-1" />
        <Button3 title="Cancel" size="sm" onClick={onCancel} />
        <Button
          title={mode === "edit" ? "Save" : "Add trigger"}
          size="sm"
          disabled={saving || !chosen}
          onClick={save}
        />
      </div>
    </div>
  );
};

export default TriggerPopover;
