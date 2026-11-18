import React, { useEffect, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  CodeEditorInline,
  InputText,
  RadioGroup,
  SelectInput,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { PanelSection } from "./SidePanel";

export const KINDS = [
  { value: "rules", label: "Rules" },
  { value: "command", label: "Command" },
  { value: "script", label: "Script" },
  { value: "tool", label: "Tool call" },
];

export const KIND_INTRO = {
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
export function startingRules(rows) {
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

export const SCRIPT_START = `// Gets what's on the left: goal, input, from, files.
function check({ goal, input, from, files }) {
  return {
    pass: true,
    reason: "",
    details: null,
  };
}`;

/** A fresh check of `kind`, starting from `rows` (What it gets) for rules. */
export function checkOfKind(kind, rows) {
  if (kind === "rules") return { kind, rules: startingRules(rows) };
  if (kind === "command")
    return { kind, command: "", timeoutSec: 120, passWhen: { type: "exit0" } };
  if (kind === "script") return { kind, script: SCRIPT_START, timeoutSec: 10 };
  return { kind, server: "", tool: "", args: {}, answerRules: [] };
}

/**
 * CheckKindEditor — a check's settings for its kind (rules, a command, a
 * script or a tool call). Shared by a flow's check panel and a bot's checks
 * window.
 *
 * @param {object} check         the check ({ kind, … })
 * @param {(patch) => void} onPatch
 * @param {*} workspaceId        for the read-only tools and Write it with AI
 * @param {object[]} [fieldRows] What it gets (rows with `path`)
 * @param {string} [name]        the check's name (Write it with AI starts from it)
 * @param {{current}} [lastFieldRef] the field last focused ({ i, key } / { arg })
 * @param {object|null} [scripts] a flow's files: { files, onCopyIn, onPickLocal };
 *                               null leaves out "Where the script lives"
 * @param {string} [runsIn]      where a command runs
 * @param {(msg) => void} [onError]
 * @param {string} [uniqueKey]
 */
export const CheckKindEditor = ({
  check,
  onPatch,
  workspaceId,
  fieldRows = [],
  name = "",
  lastFieldRef = null,
  scripts = null,
  runsIn = "This flow's folder",
  onError = () => {},
  uniqueKey = "new",
}) => {
  const { muted, strong, hairline, fieldBg, accent } = useConfigTokens();
  const status = useStatusTokens();
  const api = flowsApi();
  const [tools, setTools] = useState(null);
  const [openRule, setOpenRule] = useState(null);
  const [aiAsk, setAiAsk] = useState(null);
  const [writing, setWriting] = useState(false);
  const patch = onPatch;
  const remember = (v) => {
    if (lastFieldRef) lastFieldRef.current = v;
  };

  useEffect(() => {
    if (!api || check.kind !== "tool" || tools) return;
    // A failed look-up shows no providers rather than Looking… for ever.
    Promise.resolve(api.readOnlyTools(workspaceId))
      .then((r) => setTools(r && r.ok ? r.servers || [] : []))
      .catch(() => setTools([]));
  }, [api, check.kind, tools, workspaceId]);

  const setRule = (i, p) =>
    patch({
      rules: (check.rules || []).map((r, n) => (n === i ? { ...r, ...p } : r)),
    });

  const toolServer =
    (tools || []).find((s) => s.server === check.server) || null;
  const toolDef = toolServer
    ? toolServer.tools.find((t) => t.name === check.tool)
    : null;
  const files = (scripts && scripts.files) || [];

  return (
    <>
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
                          onFocus={() => remember({ i, key })}
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
                          rules: (check.rules || []).filter((_, n) => n !== i),
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
                  (fieldRows || []).find((x) => x.path.startsWith("input."))
                    ?.path || "";
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
          {scripts ? (
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
                    onClick={scripts.onCopyIn}
                  >
                    Copy in from this computer…
                  </button>
                  <button
                    type="button"
                    className={`text-xs font-semibold ${accent}`}
                    onClick={scripts.onPickLocal}
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
          ) : null}
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
                value="here"
                options={[{ value: "here", label: runsIn }]}
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
                  title={writing ? "Writing…" : "Write it"}
                  size="sm"
                  disabled={writing || !aiAsk.trim()}
                  onClick={async () => {
                    onError("");
                    setWriting(true);
                    try {
                      const r = await api.writeScript(workspaceId, {
                        ask: aiAsk,
                        fields: fieldRows || [],
                      });
                      if (r && r.script) {
                        patch({ script: r.script });
                        setAiAsk(null);
                      } else onError((r && r.error) || "No script came back.");
                    } catch (err) {
                      onError((err && err.message) || "No script came back.");
                    } finally {
                      setWriting(false);
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
          <div className={`h-64 rounded-md overflow-hidden border ${hairline}`}>
            <CodeEditorInline
              code={check.script || ""}
              setCode={(v) => patch({ script: v })}
              language="js"
              uniqueKey={`check-${uniqueKey}`}
            />
          </div>
          <span className={`text-xs ${muted}`}>
            {lastFieldRef
              ? "Click a field on the left to add it. No internet, no files, no AI when it runs."
              : "It gets the work as input.answer. No internet, no files, no AI when it runs."}
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
                  label: s.connected ? s.server : `${s.server} (not connected)`,
                }))}
                onChange={(server) => patch({ server, tool: "", args: {} })}
              />
            </div>
            <div className="flex-1">
              <SelectInput
                label="Tool · read-only"
                value={check.tool || ""}
                placeholder="Choose a tool"
                options={((toolServer && toolServer.tools) || []).map((t) => ({
                  value: t.name,
                  label: t.name,
                }))}
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
                          onFocus={() => remember({ arg: p })}
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
                      value={r.ref || (r.value == null ? "" : String(r.value))}
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
                compare with a field from the record (input.commit), so the fact
                is about this work, not older work.
              </span>
            </div>
          </PanelSection>
        </>
      ) : null}
    </>
  );
};

export default CheckKindEditor;
