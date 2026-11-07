import React, { useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  Checkbox,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  SubHeading3,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import {
  effectiveJobModel,
  isMostExpensive,
  monthText,
  perRunText,
  runsText,
  shortModel,
} from "./aiSettingsText";

/**
 * Settings › AI › Bot models: every bot with what starts it, its model, a
 * run's cost and this month's spending — change one, or tick several and
 * set them all at once. Leads and Create follow Default models.
 */
export const BotModelsList = ({
  ai,
  models,
  bots,
  leads,
  team,
  spending,
  saveBot,
  onChanged,
  onBack,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState(() => new Set());
  const [bulkModel, setBulkModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!ai) return <span className={`text-sm ${muted}`}>Loading…</span>;

  const defaultModel = effectiveJobModel("bots", ai, models);
  const defaultLabel = `Default · ${shortModel(models, defaultModel)}`;
  const own = bots.filter((b) => b.model);
  const shown =
    filter === "own"
      ? own
      : filter === "default"
        ? bots.filter((b) => !b.model)
        : bots;
  const spentRows = (spending && spending.bots) || [];
  const allPicked = shown.length > 0 && shown.every((b) => picked.has(b.id));
  const somePicked = shown.some((b) => picked.has(b.id));

  const setOne = (id, on) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const apply = async (ids, model) => {
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) {
        await saveBot({ id, model: model || null });
      }
      setPicked(new Set());
      if (onChanged) await onChanged();
    } catch (err) {
      setError((err && err.message) || "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const modelOptions = [
    { value: "", label: defaultLabel },
    ...models.map((m) => ({ value: m.value, label: m.label })),
  ];
  const leadsOwn = leads.filter((l) => l.model).length;
  const leadModel = effectiveJobModel("leads", ai, models);

  return (
    <div className="flex flex-col gap-4" data-testid="bot-models">
      <div>
        <Button3 title="‹ AI" size="sm" onClick={onBack} />
      </div>
      <SubHeading3 title="Bot models" padding={false} />
      <span className={`text-sm ${muted}`}>
        Each bot&apos;s model in one place. Tick bots to change several at once.
        Costs are estimates for one run on an API key.
      </span>
      <SegmentedControl
        ariaLabel="Show"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPicked(new Set());
        }}
        options={[
          { value: "all", label: `All · ${bots.length}` },
          {
            value: "default",
            label: `Default model · ${bots.length - own.length}`,
          },
          { value: "own", label: `Own model · ${own.length}` },
        ]}
      />

      {error ? (
        <AlertBanner variant="error" size="compact" message={error} />
      ) : null}

      {picked.size ? (
        <div
          className={`flex flex-row flex-wrap items-center gap-3 rounded-lg px-3 py-2 ${selectedBg}`}
          data-testid="bot-models-bulk"
        >
          <span className={`text-sm font-medium flex-1 ${strong}`}>
            {picked.size} {picked.size === 1 ? "bot" : "bots"} selected
          </span>
          <span className={`text-sm ${muted}`}>Set them to</span>
          <div className="w-56">
            <SelectInput
              ariaLabel="Model for the selected bots"
              value={bulkModel}
              onChange={setBulkModel}
              options={modelOptions}
            />
          </div>
          <Button
            title={busy ? "Saving…" : `Apply to ${picked.size}`}
            size="sm"
            disabled={busy}
            onClick={() => apply([...picked], bulkModel)}
          />
        </div>
      ) : null}

      <div
        className={`flex flex-col rounded-lg border ${hairline}`}
        role="table"
      >
        <div
          role="row"
          className={`flex flex-row items-center gap-3 px-3 py-2 text-xs font-medium ${muted}`}
        >
          <span className="flex-1">
            <Checkbox
              label={
                somePicked && !allPicked
                  ? "Select all · some selected"
                  : "Select all"
              }
              checked={allPicked}
              onChange={(on) =>
                setPicked(on ? new Set(shown.map((b) => b.id)) : new Set())
              }
            />
          </span>
          <span className="w-40">Runs</span>
          <span className="w-56">Model</span>
          <span className="w-16 text-right">Per run</span>
          <span className="w-28 text-right">This month</span>
        </div>
        {shown.map((b) => {
          const model = b.model || defaultModel;
          const row = spentRows.find((r) => r.id === b.id);
          const limit =
            row && row.budget !== null && row.budget !== undefined
              ? row.budget
              : ai.limits.perBot;
          return (
            <div
              key={b.id}
              role="row"
              className={`flex flex-row items-center gap-3 px-3 py-2 border-t ${hairline} ${picked.has(b.id) ? selectedBg : ""}`}
              data-testid={`bot-models-row-${b.id}`}
            >
              <span className={`flex-1 min-w-0 truncate text-sm ${strong}`}>
                <Checkbox
                  label={b.name}
                  checked={picked.has(b.id)}
                  onChange={(on) => setOne(b.id, on)}
                />
              </span>
              <span className={`w-40 text-xs ${muted}`}>{runsText(b)}</span>
              <span className="w-56 flex flex-row items-center gap-2">
                <span className="flex-1 min-w-0">
                  <SelectInput
                    ariaLabel={`${b.name} model`}
                    value={b.model || ""}
                    onChange={(v) => apply([b.id], v)}
                    options={modelOptions}
                  />
                </span>
                {isMostExpensive(models, model) ? (
                  <StatusBadge state="warning" label="Most expensive" />
                ) : null}
              </span>
              <span className={`w-16 text-right text-xs ${muted}`}>
                {perRunText(models, model, "")}
              </span>
              <span className={`w-28 text-right text-xs ${muted}`}>
                {monthText(row ? row.usd : 0, limit)}
              </span>
            </div>
          );
        })}
        {!shown.length ? (
          <span className={`px-3 py-3 text-sm border-t ${hairline} ${muted}`}>
            No bots here.
          </span>
        ) : null}
        <div
          role="row"
          className={`flex flex-row items-center gap-3 px-3 py-2 border-t ${hairline}`}
          data-testid="bot-models-leads"
        >
          <span className={`flex-1 text-sm font-medium ${strong}`}>
            Dashboard leads · {leads.length}
          </span>
          <span className={`w-40 text-xs ${muted}`}>
            When you ask a dashboard
          </span>
          <span className={`w-56 text-xs ${muted}`}>
            {leadsOwn
              ? `${leads.length - leadsOwn} use the default · ${shortModel(models, leadModel)} · ${leadsOwn} ${leadsOwn === 1 ? "picks its" : "pick their"} own`
              : `All use the default · ${shortModel(models, leadModel)}`}
          </span>
          <span className={`w-16 text-right text-xs ${muted}`}>
            {perRunText(models, leadModel, "")}
          </span>
          <span className={`w-28 text-right text-xs ${muted}`}>
            In the total
          </span>
        </div>
        <div
          role="row"
          className={`flex flex-row items-center gap-3 px-3 py-2 border-t ${hairline}`}
          data-testid="bot-models-create"
        >
          <span className={`flex-1 text-sm font-medium ${strong}`}>
            Create (Dash team) · {team.length} roles
          </span>
          <span className={`w-40 text-xs ${muted}`}>When you use Create</span>
          <span className={`w-56 text-xs ${muted}`}>Set in Default models</span>
          <span className="w-16" />
          <span className={`w-28 text-right text-xs ${muted}`}>
            In the total
          </span>
        </div>
      </div>
    </div>
  );
};

export default BotModelsList;
