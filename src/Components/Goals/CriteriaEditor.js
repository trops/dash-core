import React, { useEffect, useRef, useState } from "react";
import {
  Button3,
  InputText,
  SelectInput,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

export const PROOF_OPTIONS = [
  { value: "test", label: "Test passes" },
  { value: "check", label: "A check in the flow" },
  { value: "reviewer", label: "Reviewer looks · judgment" },
  { value: "you", label: "You decide" },
  { value: "none", label: "Nothing yet" },
];

const PROOF_HINT = {
  test: "The Builder writes the test: it must fail before the change and pass after.",
  check: "A check in the flow proves it, with no AI.",
  reviewer: "The Reviewer looks, labelled as judgment.",
  you: "You decide at the end.",
  none: "",
};

/**
 * CriteriaEditor — what done means, each criterion with how it's proven
 * (frames 29–30). A criterion nothing can check is flagged, with a
 * measurable rewrite to use, or "I'll decide".
 */
export const CriteriaEditor = ({ criteria, onChange, locked = false }) => {
  const { muted, strong, hairline, accent } = useConfigTokens();
  const status = useStatusTokens();
  const [help, setHelp] = useState({});
  const timers = useRef({});
  const api = flowsApi();

  // Ask whether each criterion can be checked as written (debounced).
  useEffect(() => {
    if (!api) return undefined;
    for (const c of criteria) {
      clearTimeout(timers.current[c.id]);
      timers.current[c.id] = setTimeout(async () => {
        const r = await api.criterionHelp(c.text);
        setHelp((h) => ({ ...h, [c.id]: r || null }));
      }, 300);
    }
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, [api, criteria]);

  const set = (i, patch) =>
    onChange(criteria.map((c, n) => (n === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-2" data-testid="criteria-editor">
      {criteria.map((c, i) => {
        const h = help[c.id];
        // An empty row is left out when it starts: nothing to warn about.
        const blank = !String(c.text || "").trim();
        const vague = !blank && h && h.vague && c.proof !== "you" && !c.leftOut;
        const none = c.proof === "none" && !c.leftOut;
        const warn = vague || none;
        return (
          <div
            key={c.id}
            data-testid="criterion"
            className={`flex flex-col gap-2 p-3 rounded-lg border ${
              warn
                ? `${status.warning.accentBorder} ${status.warning.bg}`
                : hairline
            } ${c.leftOut ? "border-dashed" : ""}`}
          >
            <div className="flex flex-row items-center gap-2">
              <span className={`w-6 text-sm font-semibold ${muted}`}>
                {i + 1}
              </span>
              <div className="flex-1">
                <InputText
                  ariaLabel={`Criterion ${i + 1}`}
                  value={c.text}
                  disabled={locked}
                  onChange={(v) =>
                    set(i, {
                      text: v,
                      proof: c.proof === "none" ? "none" : c.proof,
                    })
                  }
                />
              </div>
              {!locked ? (
                <Button3
                  title="Remove"
                  size="sm"
                  onClick={() => onChange(criteria.filter((_, n) => n !== i))}
                />
              ) : null}
            </div>
            <div className="flex flex-row items-center gap-2 pl-8">
              <span className={`text-xs ${muted}`}>Proven by</span>
              <div className="w-56">
                <SelectInput
                  ariaLabel="Proven by"
                  value={c.proof || "none"}
                  options={PROOF_OPTIONS}
                  onChange={(v) => set(i, { proof: v, leftOut: false })}
                />
              </div>
              <span className={`text-xs flex-1 ${muted}`}>
                {c.leftOut ? "Left out" : PROOF_HINT[c.proof] || ""}
              </span>
            </div>
            {warn ? (
              <div className="flex flex-col gap-1.5 pl-8">
                <span className={`text-sm ${status.warning.text}`}>
                  {(h && h.why) ||
                    "Nothing can check this yet. Give it a way to be proven, or judge it yourself at the end."}
                </span>
                <div className="flex flex-row flex-wrap gap-2">
                  {h && h.rewrite ? (
                    <Button3
                      title={`Use: "${h.rewrite}"${h.rewriteProof && h.rewriteProof !== "none" ? ` (${h.rewriteProof})` : ""}`}
                      size="sm"
                      onClick={() =>
                        set(i, {
                          text: h.rewrite,
                          proof:
                            h.rewriteProof && h.rewriteProof !== "none"
                              ? h.rewriteProof
                              : c.proof,
                        })
                      }
                    />
                  ) : null}
                  <Button3
                    title="Leave it out"
                    size="sm"
                    onClick={() => set(i, { leftOut: true })}
                  />
                  <Button3
                    title="I'll decide"
                    size="sm"
                    onClick={() => set(i, { proof: "you", leftOut: false })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {!locked ? (
        <button
          type="button"
          className={`self-start text-sm font-semibold ${accent}`}
          onClick={() =>
            onChange([
              ...criteria,
              { id: `c${Date.now().toString(36)}`, text: "", proof: "test" },
            ])
          }
        >
          + Add a criterion
        </button>
      ) : null}
      {criteria.length === 0 ? (
        <span className={`text-sm ${strong}`}>
          Nothing yet. Add what done means: each one gets a way to be proven
          before the job starts.
        </span>
      ) : null}
    </div>
  );
};

export default CriteriaEditor;
