import React, { useEffect, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  InputText,
  RadioGroup,
  SelectInput,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { SidePanel, PanelSection } from "./SidePanel";
import { FIELD_KIND_LABELS } from "./flowText";

const KIND_OPTIONS = [
  "text",
  "number",
  "boolean",
  "list",
  "links",
  "paths",
  "object",
].map((value) => ({ value, label: FIELD_KIND_LABELS[value] }));

/**
 * FieldsPanel — what a step's record must have (frames 26–27): each field,
 * its kind, whether it's required and which steps use it. Suggested from
 * its last runs; removing a field another step uses names that step first.
 */
export const FieldsPanel = ({ flow, step, onSave, onClose, onOpenStep }) => {
  const { muted, strong, hairline, fieldBg, accent } = useConfigTokens();
  const status = useStatusTokens();
  const api = flowsApi();
  const [fields, setFields] = useState(() =>
    (step.outputs || []).map((f) => ({ ...f })),
  );
  const [usage, setUsage] = useState({});
  const [suggested, setSuggested] = useState(null);
  const [last, setLast] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    api
      .fieldUsage(flow.id, step.id)
      .then((r) => live && r && r.ok && setUsage(r.usage || {}));
    api.suggestFields(flow.id, step.id).then((r) => {
      if (!live || !r || !r.ok) return;
      setLast(r.last || null);
      if (!(step.outputs || []).length && (r.fields || []).length) {
        setFields(r.fields);
        setSuggested(r.from);
      }
    });
    return () => {
      live = false;
    };
  }, [api, flow.id, step.id, step.outputs]);

  const setField = (i, p) =>
    setFields((list) => list.map((f, n) => (n === i ? { ...f, ...p } : f)));
  const remove = (i) => {
    const f = fields[i];
    const users = (usage[f.name] || []).filter((u) => u.stepId);
    if (users.length && (!removing || removing.i !== i)) {
      setRemoving({ i, name: f.name, users });
      return;
    }
    setRemoving(null);
    setFields((list) => list.filter((_, n) => n !== i));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const clean = fields
        .map((f) => ({ ...f, name: String(f.name || "").trim() }))
        .filter((f) => f.name);
      const r = await onSave({ outputs: clean });
      if (r && r.error) setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      testId="fields-panel"
      chip={
        <StatusBadge
          state="closed"
          label={step.kind === "source" ? "Source" : "AI"}
        />
      }
      where={`${step.name} › Its record`}
      title={`What ${step.name}'s record must have`}
      intro={`The steps after ${step.name} can only use these fields. ${step.name} is told to fill them, and Dash checks every run before anything goes on.`}
      onClose={onClose}
      footer={
        <>
          <Button title="Save" size="sm" disabled={busy} onClick={save} />
          <Button3 title="Cancel" size="sm" onClick={onClose} />
        </>
      }
    >
      {suggested ? (
        <div
          className={`p-3 rounded-md text-sm ${status.info.bg} ${status.info.text}`}
        >
          {`Suggested from its last ${suggested} run${suggested === 1 ? "" : "s"}. Check the fields, then save.`}
        </div>
      ) : null}

      <div
        className={`rounded-md border ${hairline} overflow-hidden`}
        role="table"
        aria-label="Fields"
      >
        <div
          role="row"
          className={`flex flex-row gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${muted} ${fieldBg}`}
        >
          <span role="columnheader" className="w-28 flex-shrink-0">
            Field
          </span>
          <span role="columnheader" className="w-24 flex-shrink-0">
            Kind
          </span>
          <span role="columnheader" className="w-16 flex-shrink-0">
            Required
          </span>
          <span role="columnheader" className="w-24 flex-shrink-0">
            Used by
          </span>
        </div>
        {fields.map((f, i) => {
          const users = usage[f.name] || [];
          const isRemoving = removing && removing.i === i;
          return (
            <div
              key={i}
              role="row"
              data-testid="field-row"
              className={`flex flex-row gap-2 items-center px-3 py-2 border-t ${hairline} ${
                isRemoving ? status.error.bg : ""
              }`}
            >
              <div className="w-28 flex-shrink-0 flex flex-row items-center gap-1">
                <InputText
                  ariaLabel="Field name"
                  value={f.name}
                  inputClassName={`font-mono ${isRemoving ? "line-through" : ""}`}
                  onChange={(v) => setField(i, { name: v })}
                />
              </div>
              <div className="w-24 flex-shrink-0">
                <SelectInput
                  ariaLabel="Kind"
                  value={f.kind}
                  options={KIND_OPTIONS}
                  onChange={(v) => setField(i, { kind: v })}
                />
              </div>
              <div className="w-16 flex-shrink-0">
                <Checkbox
                  checked={f.required !== false}
                  onChange={(v) => setField(i, { required: v })}
                  label={f.required !== false ? "Yes" : "No"}
                />
              </div>
              <div
                className={`flex-1 min-w-0 flex flex-row items-center gap-1 text-xs ${isRemoving ? status.error.text : muted}`}
              >
                <span className="flex-1 min-w-0">
                  {isRemoving
                    ? "Removing…"
                    : users.length
                      ? users.map((u) => u.name).join(", ")
                      : "—"}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className={`text-xs ${muted}`}
                  onClick={() => remove(i)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={`self-start text-sm font-semibold ${accent}`}
        onClick={() =>
          setFields((list) => [
            ...list,
            { name: "", kind: "text", required: true },
          ])
        }
      >
        + Add a field
      </button>

      {removing ? (
        <div
          data-testid="field-break"
          className={`flex flex-col gap-2 p-3 rounded-md border ${status.warning.border || ""} ${status.warning.bg}`}
        >
          <span className={`text-sm font-semibold ${status.warning.text}`}>
            {`${removing.users.map((u) => u.name).join(" and ")} use${removing.users.length === 1 ? "s" : ""} ${removing.name}`}
          </span>
          <span className={`text-sm ${strong}`}>
            {`${removing.users.length === 1 ? "It reads" : "They read"} ${removing.name}. If you remove the field, ${
              removing.users.length === 1 ? "that step" : "those steps"
            } will fail on every run until ${removing.users.length === 1 ? "it's" : "they're"} changed.`}
          </span>
          <div className="flex flex-row flex-wrap gap-2">
            <Button3
              title={`Keep ${removing.name}`}
              size="sm"
              onClick={() => setRemoving(null)}
            />
            <Button3
              title={`Open ${removing.users[0].name}`}
              size="sm"
              onClick={() => onOpenStep && onOpenStep(removing.users[0].stepId)}
            />
            <Button3
              title="Remove anyway"
              size="sm"
              onClick={() => remove(removing.i)}
            />
          </div>
        </div>
      ) : null}

      <PanelSection label="If a run's record doesn't match">
        <RadioGroup
          value="ask"
          onChange={() => {}}
          options={[
            {
              value: "ask",
              label: `Stop it there and ask ${step.name} again with what was missing, up to ${flow.maxRounds || 3} rounds`,
            },
          ]}
        />
      </PanelSection>

      {last ? (
        <div
          data-testid="fields-last-run"
          className={`flex flex-col gap-0.5 p-3 rounded-md border ${
            last.fit && !last.fit.ok
              ? `${status.warning.border || ""} ${status.warning.bg}`
              : `${status.success.border || ""} ${status.success.bg}`
          }`}
        >
          <span
            className={`text-sm font-semibold ${last.fit && !last.fit.ok ? status.warning.text : status.success.text}`}
          >
            {last.fit && !last.fit.ok
              ? "Last run doesn't match"
              : "Last run matches"}
          </span>
          <span className={`text-xs ${muted}`}>
            {last.fit && !last.fit.ok
              ? `Missing ${last.fit.missing.join(", ") || "nothing"}${last.fit.wrong.length ? `; wrong kind: ${last.fit.wrong.map((w) => w.name).join(", ")}` : ""}`
              : `${Object.keys(last.output || {}).length} fields filled`}
          </span>
        </div>
      ) : null}

      {error ? (
        <span className={`text-sm ${status.error.text}`} role="alert">
          {error}
        </span>
      ) : null}
    </SidePanel>
  );
};

export default FieldsPanel;
