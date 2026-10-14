import React, { useEffect, useState } from "react";
import { Button, Button3, InputText } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { money } from "./spendingText";

/**
 * BudgetField — a monthly dollar limit (bot-factory US-019 AC2): type an
 * amount and Set limit, or Remove limit. Empty means no limit.
 *
 * @param {number|null} budget  the current limit
 * @param {(usd: number|null) => Promise} onSave
 * @param {string} label  e.g. "Monthly budget"
 * @param {string} [testId]
 */
export const BudgetField = ({ budget = null, onSave, label, testId }) => {
  const { muted } = useConfigTokens();
  const [value, setValue] = useState(budget === null ? "" : String(budget));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => {
    setValue(budget === null ? "" : String(budget));
  }, [budget]);

  const typed = String(value).trim();
  const amount = typed === "" ? null : Number(typed.replace(/^\$/, ""));
  const invalid = typed !== "" && !(amount > 0);
  const changed = amount !== budget && !(amount === null && budget === null);

  const save = async (next) => {
    setSaving(true);
    setNote(null);
    try {
      await onSave(next);
      setNote(
        next === null ? "Limit removed." : `Saved — ${money(next)} a month.`,
      );
    } catch (err) {
      setNote((err && err.message) || "That didn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex flex-row items-end gap-2">
        <div className="w-48">
          <InputText
            label={label}
            value={value}
            onChange={(v) => {
              setValue(v);
              setNote(null);
            }}
            placeholder="No limit"
            inputMode="decimal"
          />
        </div>
        <Button
          title={saving ? "Saving…" : "Set limit"}
          size="sm"
          disabled={saving || invalid || !changed}
          onClick={() => save(amount)}
        />
        {budget !== null ? (
          <Button3
            title="Remove limit"
            size="sm"
            disabled={saving}
            onClick={() => save(null)}
          />
        ) : null}
      </div>
      <span className={`text-xs ${muted}`} role="status">
        {invalid
          ? "Enter an amount in dollars, like 5 or 12.50."
          : note || "US dollars a month. Leave it empty for no limit."}
      </span>
    </div>
  );
};

export default BudgetField;
