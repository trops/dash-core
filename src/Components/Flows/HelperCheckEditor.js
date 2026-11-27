/**
 * HelperCheckEditor.js — a helper check's settings (DASH-160): which
 * @trops/dash-check factory helper, whose handoff it reads, and its params
 * as JSON (dash-check's validateRecipe checks them when the bot is saved).
 */
import React, { useState } from "react";
import { SelectInput, TextArea } from "@trops/dash-react";
import { FACTORY_HELPERS } from "../Bots/checksView";

// The helpers a helper check offers, as the checks window lists them.
const HELPER_OPTIONS = FACTORY_HELPERS.map((h) => ({
  value: h.value,
  label: `${h.label} (${h.value})`,
}));

/** A helper check's params, from the JSON typed: { with } or { error }. */
export function paramsFrom(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return { with: undefined };
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error("not an object");
    }
    return { with: Object.keys(v).length ? v : undefined };
  } catch (_e) {
    return { error: 'Params must be a JSON object, e.g. { "base": "main" }' };
  }
}

/** Which helper, whose handoff it reads, and its params. */
export const HelperCheckEditor = ({ check, patch, muted = "" }) => {
  const [text, setText] = useState(() =>
    JSON.stringify(check.with || {}, null, 2),
  );
  const [bad, setBad] = useState(null);
  const known = HELPER_OPTIONS.some((o) => o.value === check.use);
  return (
    <>
      <SelectInput
        label="Helper"
        value={check.use || ""}
        options={[
          ...(check.use && !known
            ? [{ value: check.use, label: check.use }]
            : []),
          ...HELPER_OPTIONS,
        ]}
        onChange={(v) => patch({ use: v })}
      />
      <SelectInput
        label="The plan it reads"
        value={check.handoffFrom === "handed" ? "handed" : "answer"}
        options={[
          { value: "answer", label: "This bot's own handoff" },
          {
            value: "handed",
            label: "The handoff it was handed (e.g. the Planner's)",
          },
        ]}
        onChange={(v) =>
          patch({ handoffFrom: v === "handed" ? "handed" : undefined })
        }
      />
      <TextArea
        label="Params (JSON)"
        rows={5}
        value={text}
        onChange={(v) => {
          setText(v);
          const got = paramsFrom(v);
          setBad(got.error || null);
          if (!got.error) patch({ with: got.with });
        }}
      />
      <span className={`text-xs ${muted}`}>
        {bad ||
          'e.g. { "planKeys": "files, tests", "alsoAllow": "CHANGELOG.md" }. A list takes "a, b". It\'s checked when you save.'}
      </span>
    </>
  );
};

export default HelperCheckEditor;
