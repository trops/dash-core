import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Button3,
  InputText,
  RadioGroup,
  SegmentedControl,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { SidePanel, PanelSection } from "./SidePanel";
import { WhatItGets } from "./WhatItGets";
import { inputStepOf } from "./flowText";
import {
  CheckKindEditor,
  KINDS,
  KIND_INTRO,
  checkOfKind,
  startingRules,
} from "./CheckKindEditor";

/** The field paths a check uses (for highlighting What it gets). */
function usedPaths(check) {
  const text = JSON.stringify(check || {});
  const out = new Set();
  for (const m of text.matchAll(
    /(goal|input|from|files|fix)(\.[A-Za-z0-9_]+)*/g,
  )) {
    out.add(m[0]);
  }
  return [...out];
}

/**
 * CheckPanel — set up a check with no AI (frames 13, 18–20, 31): its name,
 * its kind (rules, a command, a script or a tool call), what happens on a
 * fail, and a trial on the last real record before it's saved.
 *
 * mode "new": `onAdd({ name, check, failTo })`. mode "edit": `onSave(patch)`.
 */
export const CheckPanel = ({
  flow,
  step = null,
  between = null,
  mode = "edit",
  onAdd,
  onSave,
  onRemove,
  onClose,
}) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  const api = flowsApi();
  const stepId = step ? step.id : null;
  const [name, setName] = useState(step ? step.name : "New check");
  const [check, setCheck] = useState(() =>
    step && step.check ? step.check : { kind: "rules", rules: [] },
  );
  const [gets, setGets] = useState(null);
  const [trial, setTrial] = useState(null);
  const [trying, setTrying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const lastField = useRef(null);

  // Where the work goes on a fail: back to the step it checks, or to you.
  const back = useMemo(() => {
    if (step) {
      const e = (flow.edges || []).find(
        (x) => x.kind === "fail" && x.from === step.id,
      );
      if (e) return (flow.steps || []).find((s) => s.id === e.to) || null;
      return null;
    }
    return between && between.from
      ? inputStepOf(
          {
            ...flow,
            edges: [
              ...(flow.edges || []),
              { from: between.from, to: "__new", kind: "next" },
            ],
          },
          "__new",
        )
      : null;
  }, [flow, step, between]);
  const [failTo, setFailTo] = useState(() =>
    step ? (back ? back.id : "") : back ? back.id : "",
  );

  // What it gets: for an existing check, its own step; for a new one, as if
  // it sat after the step it follows.
  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    const target = stepId || (between && between.to) || null;
    if (!target && !(between && between.from)) return undefined;
    (async () => {
      let r = target ? await api.whatItGets(flow.id, target) : null;
      if (!stepId && between && between.to) {
        // The step after the + reads the same input the new check will.
        r = await api.whatItGets(flow.id, between.to);
      }
      if (!live) return;
      if (r && r.ok) {
        setGets(r);
        if (!stepId && check.kind === "rules" && !(check.rules || []).length) {
          setCheck((c) => ({ ...c, rules: startingRules(r.rows) }));
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id, stepId]);

  useEffect(() => {
    if (!api || (check.kind !== "command" && check.kind !== "script")) return;
    api
      .files(flow.id)
      .then((list) => setFiles(Array.isArray(list) ? list : []));
  }, [api, check.kind, flow.id]);

  const runTrial = useCallback(async () => {
    if (!api || !stepId) {
      setTrial({
        tried: false,
        reason:
          "Add the check first; it's tried on the next job that reaches it.",
      });
      return;
    }
    setTrying(true);
    try {
      const r = await api.trial(flow.id, stepId, check);
      setTrial(
        r && r.ok
          ? r
          : { tried: false, reason: (r && r.error) || "It couldn't be tried." },
      );
    } finally {
      setTrying(false);
    }
  }, [api, flow.id, stepId, check]);

  // A new check is tried on the last real record of the step before it.
  const runTrialNew = useCallback(async () => {
    if (!api || !between || !between.to) return runTrial();
    setTrying(true);
    try {
      const r = await api.trial(flow.id, between.to, check);
      setTrial(
        r && r.ok
          ? r
          : { tried: false, reason: (r && r.error) || "It couldn't be tried." },
      );
    } finally {
      setTrying(false);
    }
  }, [api, between, check, flow.id, runTrial]);

  const tryIt = stepId ? runTrial : runTrialNew;

  const setKind = (kind) => {
    setTrial(null);
    setCheck((c) =>
      c.kind === kind ? c : checkOfKind(kind, gets && gets.rows),
    );
  };

  const patch = (p) => {
    setTrial(null);
    setCheck((c) => ({ ...c, ...p }));
  };

  const setRule = (i, p) =>
    patch({
      rules: (check.rules || []).map((r, n) => (n === i ? { ...r, ...p } : r)),
    });

  // Clicking a field on the left puts it where it's used.
  const pick = (path) => {
    if (check.kind === "command") {
      patch({
        command: `${check.command || ""}${check.command ? " " : ""}${path}`,
      });
    } else if (check.kind === "script") {
      patch({ script: `${check.script || ""}\n// ${path}` });
    } else if (check.kind === "rules" && lastField.current) {
      const { i, key } = lastField.current;
      setRule(i, { [key]: path });
    } else if (check.kind === "rules") {
      patch({
        rules: [
          ...(check.rules || []),
          { type: "required", field: path, on: true },
        ],
      });
    } else if (check.kind === "tool" && lastField.current) {
      const { arg } = lastField.current;
      if (arg)
        patch({ args: { ...(check.args || {}), [arg]: { field: path } } });
    }
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const r =
        mode === "new"
          ? await onAdd({
              name: name.trim() || "Check",
              check,
              failTo: failTo || null,
            })
          : await onSave({
              name: name.trim() || "Check",
              check,
              failTo: failTo || null,
            });
      if (r && r.error) setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  // The flow's files, for a command or script check.
  const copyIn = async () => {
    const r = await api.copyIn(flow.id, "scripts");
    if (r && r.ok) {
      setFiles(await api.files(flow.id));
      patch({
        command: `${/\.py$/.test(r.ref) ? "python3" : "node"} ${r.ref}`,
      });
    } else if (r && r.error) setError(r.error);
  };
  const pickLocal = async () => {
    const r = await api.pickFolder({
      file: true,
      title: "A file only on this computer",
    });
    if (r && r.path) {
      patch({ command: `node ${JSON.stringify(r.path)}`, localFile: r.path });
    }
  };

  const failOptions = [
    ...(back
      ? [
          {
            value: back.id,
            label: `Send back to ${back.name} with what failed, up to ${flow.maxRounds || 3} rounds, then to me`,
          },
        ]
      : []),
    { value: "", label: "Come to me" },
  ];

  return (
    <div className="flex flex-row min-h-0 h-full">
      <WhatItGets
        data={gets}
        kind={check.kind}
        used={usedPaths(check)}
        onPick={pick}
      />
      <SidePanel
        testId="check-panel"
        ariaLabel={name || "Check"}
        chip={<StatusBadge state="info" label="Code check · no AI" />}
        where={between ? between.text : ""}
        onClose={onClose}
        footer={
          <>
            <Button
              title={mode === "new" ? "Add check" : "Save"}
              size="sm"
              disabled={busy}
              onClick={save}
            />
            <Button3 title="Cancel" size="sm" onClick={onClose} />
            <span className="flex-1" />
            {mode === "edit" && onRemove ? (
              <Button3 title="Remove step" size="sm" onClick={onRemove} />
            ) : null}
          </>
        }
      >
        <InputText label="Name" value={name} onChange={(v) => setName(v)} />
        <SegmentedControl
          ariaLabel="Kind of check"
          size="sm"
          value={check.kind}
          onChange={setKind}
          options={KINDS}
        />
        <span className={`text-sm ${muted}`}>{KIND_INTRO[check.kind]}</span>
        {check.missing ? (
          <span
            className={`text-sm ${status.warning.text}`}
            data-testid="check-missing"
          >
            {`It ran ${check.missing}, a file that was only on the publisher's computer. Choose a script for it here.`}
          </span>
        ) : null}

        <CheckKindEditor
          check={check}
          onPatch={patch}
          workspaceId={flow.workspaceId}
          fieldRows={(gets && gets.rows) || []}
          name={name}
          lastFieldRef={lastField}
          scripts={{ files, onCopyIn: copyIn, onPickLocal: pickLocal }}
          onError={setError}
          uniqueKey={stepId || "new"}
        />

        <PanelSection label="If it fails">
          <RadioGroup
            value={failTo}
            onChange={setFailTo}
            options={failOptions}
          />
        </PanelSection>

        <TrialBox
          trial={trial}
          trying={trying}
          onTry={tryIt}
          kind={check.kind}
        />

        {error ? (
          <span className={`text-sm ${status.error.text}`} role="alert">
            {error}
          </span>
        ) : null}
      </SidePanel>
    </div>
  );
};

/** "Tried on last week's draft: failed (exit 1)" with Try again (frame 13). */
const TrialBox = ({ trial, trying, onTry }) => {
  const { muted, strong, hairline, accent } = useConfigTokens();
  const status = useStatusTokens();
  const res = trial && trial.tried ? trial.result : null;
  const tone = res ? (res.pass ? status.success : status.error) : null;
  return (
    <div
      data-testid="check-trial"
      className={`flex flex-col gap-1 p-3 rounded-md border ${
        tone ? `${tone.border || ""} ${tone.bg}` : hairline
      }`}
    >
      <div className="flex flex-row items-center gap-2">
        <span
          className={`text-sm font-semibold flex-1 ${tone ? tone.text : strong}`}
        >
          {trying
            ? "Trying it…"
            : res
              ? `Tried on ${trial.on}: ${res.pass ? "passed" : "failed"}${res.exitCode != null ? ` (exit ${res.exitCode})` : ""}`
              : "Try it before you save it"}
        </span>
        <button
          type="button"
          className={`text-xs font-semibold ${accent}`}
          onClick={onTry}
          disabled={trying}
        >
          {res ? "Try again" : "Try it"}
        </button>
      </div>
      {res ? (
        <span
          className={`text-xs font-mono break-words ${tone ? tone.text : muted}`}
        >
          {res.reason}
        </span>
      ) : trial && !trial.tried ? (
        <span className={`text-xs ${muted}`}>{trial.reason}</span>
      ) : (
        <span className={`text-xs ${muted}`}>
          It's tried on the last real record that reached this step.
        </span>
      )}
    </div>
  );
};

export default CheckPanel;
