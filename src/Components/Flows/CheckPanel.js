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
  Checkbox,
  CodeEditorInline,
  InputText,
  RadioGroup,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { SidePanel, PanelSection } from "./SidePanel";
import { WhatItGets } from "./WhatItGets";
import { inputStepOf } from "./flowText";

const KINDS = [
  { value: "rules", label: "Rules" },
  { value: "command", label: "Command" },
  { value: "script", label: "Script" },
  { value: "tool", label: "Tool call" },
];

const KIND_INTRO = {
  rules: "Pick ready-made rules. Each one passes or fails on its own.",
  command:
    "Run a command you already have. Its output is kept as proof; force push and publish stay blocked.",
  script:
    "Write a short function, or have AI write it once. You read it before it's saved; it runs without AI.",
  tool: "Ask a provider for a fact and check the answer. Only tools that can't change anything are offered.",
};

// Each rule's settings, as the setup screen asks for them.
const RULE_PARAMS = {
  required: [["field", "Field"]],
  words: [
    ["field", "Field"],
    ["min", "At least (words)"],
    ["max", "At most (words)"],
  ],
  maxLength: [
    ["field", "Field"],
    ["max", "Under (characters)"],
  ],
  banned: [
    ["field", "Field"],
    ["words", "Banned words, one per line"],
  ],
  linksWork: [["field", "Field with the links"]],
  everyIncluded: [
    ["list", "Each item of"],
    ["key", "By its"],
    ["in", "Appears in"],
  ],
  equals: [
    ["field", "Field"],
    ["value", "Equals"],
  ],
  sumEquals: [
    ["fields", "These add up (comma between)"],
    ["total", "To"],
  ],
  noDuplicates: [
    ["field", "List"],
    ["key", "By its"],
  ],
};

const RULE_LABEL = {
  required: "Has a value",
  words: "Length",
  maxLength: "Short enough",
  banned: "No banned words",
  linksWork: "All links work",
  everyIncluded: "Every item is used",
  equals: "Matches",
  sumEquals: "Totals add up",
  noDuplicates: "Nothing used twice",
};

function ruleHelp(r) {
  switch (r.type) {
    case "required":
      return `${r.field || "A field"} is filled in`;
    case "words":
      return `Between ${r.min || 0} and ${r.max || "any number of"} words`;
    case "maxLength":
      return `Under ${r.max || 0} characters`;
    case "banned": {
      const n = (r.words || []).length;
      return `From your list: ${n} word${n === 1 ? "" : "s"}`;
    }
    case "linksWork":
      return "Every link answers, no 404s";
    case "everyIncluded":
      return `Each of ${r.list || "a list"} appears in ${r.in || "it"}`;
    case "equals":
      return `${r.field || "A field"} equals ${JSON.stringify(r.value)}`;
    case "sumEquals":
      return `${(r.fields || []).join(" + ") || "The parts"} = ${r.total || "the total"}, to the cent`;
    case "noDuplicates":
      return `No ${r.key || "item"} appears twice in ${r.field || "the list"}`;
    default:
      return "";
  }
}

/** Rules to start from, from what the step before makes. */
function startingRules(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r.path.startsWith("input.")) continue;
    if (r.kind === "links")
      out.push({ type: "linksWork", field: r.path, on: true });
    else if (r.kind === "text")
      out.push({ type: "required", field: r.path, on: true });
  }
  return out.slice(0, 6);
}

const TIME_LIMITS = [
  { value: "30", label: "30 sec" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
  { value: "300", label: "5 min" },
  { value: "600", label: "10 min" },
  { value: "1800", label: "30 min" },
];

const SCRIPT_START = `// Gets what's on the left: goal, input, from, files.
function check({ goal, input, from, files }) {
  return {
    pass: true,
    reason: "",
    details: null,
  };
}`;

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
  const { muted, strong, hairline, fieldBg, accent } = useConfigTokens();
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
  const [tools, setTools] = useState(null);
  const [files, setFiles] = useState([]);
  const [openRule, setOpenRule] = useState(null);
  const [aiAsk, setAiAsk] = useState(null);
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
    if (!api || check.kind !== "tool" || tools) return;
    api.readOnlyTools(flow.workspaceId).then((r) => {
      if (r && r.ok) setTools(r.servers || []);
    });
  }, [api, check.kind, tools, flow.workspaceId]);

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
          "Add the check first; it's tried on the next goal that reaches it.",
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
    setCheck((c) => {
      if (c.kind === kind) return c;
      if (kind === "rules")
        return { kind, rules: startingRules(gets && gets.rows) };
      if (kind === "command")
        return {
          kind,
          command: "",
          timeoutSec: 120,
          passWhen: { type: "exit0" },
        };
      if (kind === "script")
        return { kind, script: SCRIPT_START, timeoutSec: 10 };
      return { kind, server: "", tool: "", args: {}, answerRules: [] };
    });
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

  const toolServer =
    (tools || []).find((s) => s.server === check.server) || null;
  const toolDef = toolServer
    ? toolServer.tools.find((t) => t.name === check.tool)
    : null;

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

        {check.kind === "rules" ? (
          <PanelSection label="Passes when" testId="check-rules">
            <div className="flex flex-col gap-2">
              {(check.rules || []).map((r, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-2 p-3 rounded-md border ${hairline}`}
                >
                  <div className="flex flex-row items-start gap-2">
                    <Checkbox
                      checked={r.on !== false}
                      onChange={(on) => setRule(i, { on })}
                      label=""
                    />
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left flex flex-col"
                      onClick={() => setOpenRule(openRule === i ? null : i)}
                    >
                      <span className={`text-sm font-semibold ${strong}`}>
                        {RULE_LABEL[r.type] || r.type}
                      </span>
                      <span className={`text-xs ${muted}`}>{ruleHelp(r)}</span>
                    </button>
                  </div>
                  {openRule === i ? (
                    <div className="flex flex-col gap-2 pl-6">
                      {(RULE_PARAMS[r.type] || []).map(([key, label]) =>
                        key === "words" ? (
                          <TextArea
                            key={key}
                            label={label}
                            rows={3}
                            value={(r.words || []).join("\n")}
                            onChange={(v) =>
                              setRule(i, {
                                words: String(v)
                                  .split(/\n/)
                                  .map((w) => w.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        ) : (
                          <InputText
                            key={key}
                            label={label}
                            value={
                              key === "fields"
                                ? (r.fields || []).join(", ")
                                : r[key] == null
                                  ? ""
                                  : String(r[key])
                            }
                            onFocus={() => {
                              lastField.current = { i, key };
                            }}
                            onChange={(v) =>
                              setRule(i, {
                                [key]:
                                  key === "fields"
                                    ? String(v)
                                        .split(",")
                                        .map((x) => x.trim())
                                        .filter(Boolean)
                                    : key === "min" || key === "max"
                                      ? Number(v) || 0
                                      : v,
                              })
                            }
                          />
                        ),
                      )}
                      <Button3
                        title="Remove this rule"
                        size="sm"
                        onClick={() =>
                          patch({
                            rules: (check.rules || []).filter(
                              (_, n) => n !== i,
                            ),
                          })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))}
              <SelectInput
                ariaLabel="Add a rule"
                placeholder="+ Add a rule"
                value=""
                options={Object.entries(RULE_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(type) => {
                  if (!type) return;
                  const field =
                    ((gets && gets.rows) || []).find((x) =>
                      x.path.startsWith("input."),
                    )?.path || "";
                  patch({
                    rules: [
                      ...(check.rules || []),
                      {
                        type,
                        field,
                        on: true,
                        ...(type === "banned" ? { words: [] } : {}),
                      },
                    ],
                  });
                  setOpenRule((check.rules || []).length);
                }}
              />
            </div>
          </PanelSection>
        ) : null}

        {check.kind === "command" ? (
          <>
            <PanelSection label="Where the script lives">
              <span className={`text-xs ${muted}`}>
                {files.filter((f) => f.ref.startsWith("scripts/")).length
                  ? "This flow's files (kept with the flow and published with it):"
                  : "Put a script in this flow's files to keep it with the flow, or run one only on this computer."}
              </span>
              <div className="flex flex-col gap-1 pt-1">
                {files
                  .filter((f) => f.ref.startsWith("scripts/"))
                  .map((f) => (
                    <button
                      key={f.ref}
                      type="button"
                      className={`text-left font-mono text-xs ${String(check.command || "").includes(f.ref) ? accent : muted}`}
                      onClick={() =>
                        patch({
                          command: `${/\.py$/.test(f.ref) ? "python3" : "node"} ${f.ref}`,
                        })
                      }
                    >
                      {f.ref}
                    </button>
                  ))}
                <span className="flex flex-row gap-3 pt-1">
                  <button
                    type="button"
                    className={`text-xs font-semibold ${accent}`}
                    onClick={async () => {
                      const r = await api.copyIn(flow.id, "scripts");
                      if (r && r.ok) {
                        setFiles(await api.files(flow.id));
                        patch({
                          command: `${/\.py$/.test(r.ref) ? "python3" : "node"} ${r.ref}`,
                        });
                      } else if (r && r.error) setError(r.error);
                    }}
                  >
                    Copy in from this computer…
                  </button>
                  <button
                    type="button"
                    className={`text-xs font-semibold ${accent}`}
                    onClick={async () => {
                      const r = await api.pickFolder({
                        file: true,
                        title: "A file only on this computer",
                      });
                      if (r && r.path) {
                        patch({
                          command: `node ${JSON.stringify(r.path)}`,
                          localFile: r.path,
                        });
                      }
                    }}
                  >
                    A file only on this computer…
                  </button>
                </span>
                {check.localFile ? (
                  <span className={`text-xs ${status.warning.text}`}>
                    Runs where it is. Left out when you publish, and shown as
                    missing anywhere else.
                  </span>
                ) : null}
              </div>
            </PanelSection>
            <InputText
              label="Command"
              value={check.command || ""}
              inputClassName="font-mono"
              onChange={(v) => patch({ command: v })}
            />
            <div className="flex flex-row gap-2">
              <div className="flex-1">
                <SelectInput
                  label="Runs in"
                  value="flow"
                  options={[{ value: "flow", label: "This flow's folder" }]}
                  onChange={() => {}}
                />
              </div>
              <div className="w-32">
                <SelectInput
                  label="Time limit"
                  value={String(check.timeoutSec || 120)}
                  options={TIME_LIMITS}
                  onChange={(v) => patch({ timeoutSec: Number(v) })}
                />
              </div>
            </div>
            <PanelSection label="Passes when">
              <RadioGroup
                value={(check.passWhen && check.passWhen.type) || "exit0"}
                onChange={(type) =>
                  patch({ passWhen: { ...(check.passWhen || {}), type } })
                }
                options={[
                  {
                    value: "exit0",
                    label: "It finishes without an error (exit code 0)",
                  },
                  { value: "contains", label: "Its output contains…" },
                  { value: "matches", label: "Its output matches…" },
                ]}
              />
              {check.passWhen && check.passWhen.type !== "exit0" ? (
                <InputText
                  ariaLabel="What its output has"
                  value={
                    check.passWhen.type === "contains"
                      ? check.passWhen.text || ""
                      : check.passWhen.pattern || ""
                  }
                  onChange={(v) =>
                    patch({
                      passWhen:
                        check.passWhen.type === "contains"
                          ? { type: "contains", text: v }
                          : { type: "matches", pattern: v },
                    })
                  }
                />
              ) : null}
            </PanelSection>
            <PanelSection label="Reading it in your command">
              <pre
                className={`m-0 p-3 rounded-md text-xs font-mono whitespace-pre-wrap ${fieldBg} ${muted}`}
              >
                {`const input = JSON.parse(fs.readFileSync(\n  process.env.DASH_INPUT, "utf8"));\n// Print {"reason", "details"} as JSON to\n// add them to the proof.`}
              </pre>
            </PanelSection>
          </>
        ) : null}

        {check.kind === "script" ? (
          <PanelSection label="Script">
            <div className="flex flex-row items-center pb-1">
              <span className="flex-1" />
              <button
                type="button"
                className={`text-xs font-semibold ${accent}`}
                onClick={() => setAiAsk(aiAsk === null ? name : null)}
              >
                Write it with AI
              </button>
            </div>
            {aiAsk !== null ? (
              <div
                className="flex flex-col gap-1.5 pb-2"
                data-testid="write-with-ai"
              >
                <InputText
                  label="What should it check?"
                  value={aiAsk}
                  onChange={(v) => setAiAsk(v)}
                />
                <div className="flex flex-row items-center gap-2">
                  <Button
                    title={busy ? "Writing…" : "Write it"}
                    size="sm"
                    disabled={busy || !aiAsk.trim()}
                    onClick={async () => {
                      setError("");
                      setBusy(true);
                      try {
                        const r = await api.writeScript(flow.workspaceId, {
                          ask: aiAsk,
                          fields: (gets && gets.rows) || [],
                        });
                        if (r && r.script) {
                          patch({ script: r.script });
                          setAiAsk(null);
                        } else
                          setError((r && r.error) || "No script came back.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <span className={`text-xs ${muted}`}>
                    AI writes it once; read it before you save. It runs without
                    AI.
                  </span>
                </div>
              </div>
            ) : null}
            <div
              className={`h-64 rounded-md overflow-hidden border ${hairline}`}
            >
              <CodeEditorInline
                code={check.script || ""}
                setCode={(v) => patch({ script: v })}
                language="js"
                uniqueKey={`check-${stepId || "new"}`}
              />
            </div>
            <span className={`text-xs ${muted}`}>
              Click a field on the left to add it. No internet, no files, no AI
              when it runs.
            </span>
          </PanelSection>
        ) : null}

        {check.kind === "tool" ? (
          <>
            <div className="flex flex-row gap-2">
              <div className="flex-1">
                <SelectInput
                  label="Provider"
                  value={check.server || ""}
                  placeholder={tools ? "Choose a provider" : "Looking…"}
                  options={(tools || []).map((s) => ({
                    value: s.server,
                    label: s.connected
                      ? s.server
                      : `${s.server} (not connected)`,
                  }))}
                  onChange={(server) => patch({ server, tool: "", args: {} })}
                />
              </div>
              <div className="flex-1">
                <SelectInput
                  label="Tool · read-only"
                  value={check.tool || ""}
                  placeholder="Choose a tool"
                  options={((toolServer && toolServer.tools) || []).map(
                    (t) => ({
                      value: t.name,
                      label: t.name,
                    }),
                  )}
                  onChange={(tool) => patch({ tool, args: {} })}
                />
              </div>
            </div>
            {toolDef ? (
              <PanelSection label="Asked with">
                <div className="flex flex-col gap-1.5">
                  {toolDef.params.map((p) => {
                    const a = (check.args || {})[p];
                    const shown =
                      a && typeof a === "object" && a.field
                        ? a.field
                        : a == null
                          ? ""
                          : String(a.value != null ? a.value : a);
                    return (
                      <div key={p} className="flex flex-row items-center gap-2">
                        <span className={`w-28 text-xs font-mono ${muted}`}>
                          {p}
                        </span>
                        <div className="flex-1">
                          <InputText
                            ariaLabel={p}
                            value={shown}
                            inputClassName="font-mono"
                            onFocus={() => {
                              lastField.current = { arg: p };
                            }}
                            onChange={(v) =>
                              patch({
                                args: {
                                  ...(check.args || {}),
                                  [p]: /^(goal|input|from|files)\./.test(v)
                                    ? { field: v }
                                    : { value: v },
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PanelSection>
            ) : null}
            <PanelSection label="Passes when">
              <div className="flex flex-col gap-1.5">
                {(check.answerRules || []).map((r, i) => (
                  <div key={i} className="flex flex-row items-center gap-1.5">
                    <div className="flex-1">
                      <InputText
                        ariaLabel="Answer field"
                        value={r.path || ""}
                        inputClassName="font-mono"
                        onChange={(v) =>
                          patch({
                            answerRules: check.answerRules.map((x, n) =>
                              n === i ? { ...x, path: v } : x,
                            ),
                          })
                        }
                      />
                    </div>
                    <span className={`text-xs ${muted}`}>equals</span>
                    <div className="flex-1">
                      <InputText
                        ariaLabel="Value"
                        value={
                          r.ref || (r.value == null ? "" : String(r.value))
                        }
                        inputClassName="font-mono"
                        onChange={(v) =>
                          patch({
                            answerRules: check.answerRules.map((x, n) =>
                              n === i
                                ? /^(goal|input|from)\./.test(v)
                                  ? { path: x.path, op: "equals", ref: v }
                                  : { path: x.path, op: "equals", value: v }
                                : x,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className={`self-start text-xs font-semibold ${accent}`}
                  onClick={() =>
                    patch({
                      answerRules: [
                        ...(check.answerRules || []),
                        { path: "", op: "equals", value: "" },
                      ],
                    })
                  }
                >
                  + Add a rule on the answer
                </button>
                <span className={`text-xs ${muted}`}>
                  Only tools that can't change anything are listed. A rule can
                  compare with a field from the record (input.commit), so the
                  fact is about this work, not older work.
                </span>
              </div>
            </PanelSection>
          </>
        ) : null}

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
