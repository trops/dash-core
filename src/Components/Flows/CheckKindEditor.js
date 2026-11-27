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
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { PanelSection } from "./SidePanel";

// The main process's side of a check: read-only tools, Write it with AI.
const flowsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.flows) ||
  null;

export const KINDS = [
  { value: "rules", label: "Rules" },
  { value: "command", label: "Command" },
  { value: "script", label: "Script" },
  { value: "tool", label: "Tool call" },
  { value: "repo", label: "Repo check" },
  { value: "package", label: "Check package" },
  { value: "git-on-branch", label: "On its branch" },
  { value: "git-committed", label: "Work is committed" },
  { value: "pr-ci", label: "The PR's CI passes" },
  { value: "handoff-has", label: "The handoff has" },
];

export const KIND_INTRO = {
  rules: "Pick ready-made rules. Each one passes or fails on its own.",
  command:
    "Run a command you already have. Its output is kept as proof; force push and publish stay blocked.",
  script:
    "Write a short function, or have AI write it once. You read it before it's saved; it runs without AI.",
  tool: "Ask a provider for a fact and check the answer. Only tools that can't change anything are offered.",
  repo: "Run a check the repo keeps in .dash/checks, like CI. It's read from the base branch, so the work being checked can't change it.",
};

Object.assign(KIND_INTRO, {
  package:
    "A ready-made check from a package: one that ships with Dash, or one you install from the registry. Fill in its inputs; it runs without AI.",
  "git-on-branch":
    "Built in: the job's workspace is on its branch (the handoff's workspace.branch). No AI, no shell to write.",
  "git-committed":
    "Built in: at least one commit past the base branch, and nothing uncommitted. No AI, no shell to write.",
  "pr-ci":
    "Built in: the PR in the handoff (prUrl) has CI that passed. It waits for CI, using the bot's GitHub provider.",
  "handoff-has":
    "Built in: the bot's handoff has each of these keys, not empty.",
});

const CI_LIMITS = [
  { value: "600", label: "10 min" },
  { value: "1200", label: "20 min" },
  { value: "1800", label: "30 min" },
  { value: "3600", label: "1 hour" },
];

const IF_MISSING_OPTIONS = [
  { value: "fail", label: "Fail, saying it's missing" },
  { value: "skip", label: "Skip it (passes)" },
];
const FROM_OPTIONS = [
  { value: "base", label: "The base branch (e.g. main)" },
  { value: "workspace", label: "The workspace's own copy" },
];

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

const botsApiOf = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/**
 * A package step (DASH-106): which package (Dash's or installed), its
 * inputs, and finding one in the registry to install.
 */
export const PackageCheckEditor = ({ check, patch, muted = "" }) => {
  const [list, setList] = useState(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const load = () => {
    const api = botsApiOf();
    if (!api || !api.listCheckPackages) {
      setList([]);
      return;
    }
    Promise.resolve(api.listCheckPackages())
      .then((r) => setList((r && r.packages) || []))
      .catch(() => setList([]));
  };
  useEffect(load, []);
  const pkg = (list || []).find((p) => p.id === check.package) || null;
  const inputs = (check && check.inputs) || {};
  const search = async () => {
    const api = botsApiOf();
    if (!api || !api.searchCheckPackages) return;
    setNote(null);
    try {
      setFound((await api.searchCheckPackages(query)) || []);
    } catch (e) {
      setNote((e && e.message) || "Couldn't search the registry.");
    }
  };
  const install = async (ref) => {
    const api = botsApiOf();
    if (!api || !api.installCheckPackage) return;
    setBusy(ref);
    setNote(null);
    try {
      const r = await api.installCheckPackage(ref);
      if (r && r.error) throw new Error(r.error);
      patch({ package: r.id || ref, inputs: {} });
      load();
      setNote(`Installed ${r.id || ref}.`);
    } catch (e) {
      setNote((e && e.message) || "Couldn't install it.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SelectInput
        label="Package"
        value={check.package || ""}
        options={[
          { value: "", label: list ? "Pick a package" : "Looking…" },
          ...(list || []).map((p) => ({
            value: p.id,
            label: `${p.id}${p.source === "dash" ? " (ships with Dash)" : ""}`,
          })),
          ...(check.package && !pkg
            ? [
                {
                  value: check.package,
                  label: `${check.package} (not installed)`,
                },
              ]
            : []),
        ]}
        onChange={(v) => patch({ package: v, inputs: {} })}
      />
      {pkg ? (
        <span className={`text-xs ${muted}`}>
          {`${pkg.description || ""}${pkg.needs && pkg.needs.provider ? ` Needs a ${pkg.needs.provider} provider.` : ""}${pkg.needs && pkg.needs.commands ? ` Runs ${pkg.needs.commands.join(", ")}.` : ""}`}
        </span>
      ) : null}
      {pkg
        ? (pkg.inputs || []).map((i) => (
            <InputText
              key={i.name}
              label={i.label || i.name}
              value={inputs[i.name] !== undefined ? String(inputs[i.name]) : ""}
              placeholder={i.default !== undefined ? String(i.default) : ""}
              onChange={(v) =>
                patch({
                  inputs: { ...inputs, [i.name]: v === "" ? undefined : v },
                })
              }
            />
          ))
        : null}
      <PanelSection label="Find one in the registry">
        <div className="flex flex-row gap-2">
          <div className="flex-1">
            <InputText
              ariaLabel="Search check packages"
              value={query}
              placeholder="jira, tests, plan…"
              onChange={setQuery}
            />
          </div>
          <Button title="Search" size="sm" onClick={search} />
        </div>
        {(found || []).map((f) => (
          <div key={f.ref} className="flex flex-row items-center gap-2 text-sm">
            <span className="flex-1 min-w-0">
              {`${f.ref}${f.version ? ` ${f.version}` : ""} · ${f.author}: ${f.description}`}
            </span>
            {f.installed ? (
              <span className={`text-xs ${muted}`}>Installed</span>
            ) : (
              <Button
                title={busy === f.ref ? "Installing…" : "Install"}
                size="sm"
                onClick={busy ? undefined : () => install(f.ref)}
              />
            )}
          </div>
        ))}
        {found && !found.length ? (
          <span className={`text-xs ${muted}`}>No check packages match.</span>
        ) : null}
        {note ? <span className="text-xs">{note}</span> : null}
      </PanelSection>
    </>
  );
};

/** A fresh check of `kind`, starting from `rows` (What it gets) for rules. */
export function checkOfKind(kind, rows) {
  if (kind === "rules") return { kind, rules: startingRules(rows) };
  if (kind === "command")
    return { kind, command: "", timeoutSec: 120, passWhen: { type: "exit0" } };
  if (kind === "script") return { kind, script: SCRIPT_START, timeoutSec: 10 };
  if (kind === "repo") return { kind, name: "validate", ifMissing: "fail" };
  return { kind, server: "", tool: "", args: {}, answerRules: [] };
}

/**
 * CheckKindEditor — a check's settings for its kind (rules, a command, a
 * script or a tool call), in a bot's checks window.
 *
 * @param {object} check         the check ({ kind, … })
 * @param {(patch) => void} onPatch
 * @param {*} workspaceId        for the read-only tools and Write it with AI
 * @param {object[]} [fieldRows] What it gets (rows with `path`)
 * @param {string} [name]        the check's name (Write it with AI starts from it)
 * @param {{current}} [lastFieldRef] the field last focused ({ i, key } / { arg })
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
  runsIn = "The bot's folder",
  onError = () => {},
  uniqueKey = "new",
}) => {
  const { muted, strong, hairline, fieldBg, accent } = useConfigTokens();
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

      {check.kind === "package" ? (
        <PackageCheckEditor check={check} patch={patch} muted={muted} />
      ) : null}

      {check.kind === "repo" ? (
        <>
          <InputText
            label="Its file in .dash/checks"
            value={check.name || ""}
            inputClassName="font-mono"
            placeholder="validate"
            onChange={(v) => patch({ name: v.trim() })}
          />
          <span className={`text-xs ${muted}`}>
            {`Dash runs .dash/checks/${check.name || "<name>"} (any extension: .sh, .js, .py…) in ${runsIn}.`}
          </span>
          <div className="flex flex-row gap-2">
            <div className="flex-1">
              <SelectInput
                label="Read from"
                value={check.from || "base"}
                options={FROM_OPTIONS}
                onChange={(v) => patch({ from: v === "base" ? undefined : v })}
              />
            </div>
            <div className="flex-1">
              <SelectInput
                label="When the repo has none"
                value={check.ifMissing || "fail"}
                options={IF_MISSING_OPTIONS}
                onChange={(v) => patch({ ifMissing: v })}
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
          <PanelSection label="Writing the check">
            <pre
              className={`m-0 p-3 rounded-md text-xs font-mono whitespace-pre-wrap ${fieldBg} ${muted}`}
            >
              {`# .dash/checks/${check.name || "validate"}.sh\n# Runs in the workspace; exit 0 passes.\nnpm test\n# Optional last line, shown on the job:\necho '{"reason": "Tests pass"}'`}
            </pre>
          </PanelSection>
        </>
      ) : null}

      {check.kind === "git-on-branch" ? (
        <InputText
          label="Branch (empty: the job's workspace.branch)"
          value={check.branch || ""}
          inputClassName="font-mono"
          placeholder="{workspace.branch}"
          onChange={(v) => patch({ branch: v.trim() || undefined })}
        />
      ) : null}

      {check.kind === "git-committed" ? (
        <InputText
          label="Base branch (empty: the repo's default)"
          value={check.base || ""}
          inputClassName="font-mono"
          placeholder="{repo.baseBranch}"
          onChange={(v) => patch({ base: v.trim() || undefined })}
        />
      ) : null}

      {check.kind === "pr-ci" ? (
        <div className="flex flex-row gap-2">
          <div className="flex-1">
            <InputText
              label="The PR link's key in the handoff"
              value={check.prKey || "prUrl"}
              inputClassName="font-mono"
              onChange={(v) => patch({ prKey: v.trim() || "prUrl" })}
            />
          </div>
          <div className="flex-1">
            <SelectInput
              label="When the repo has no CI"
              value={check.ifNoChecks || "pass"}
              options={[
                { value: "pass", label: "Pass, saying so" },
                { value: "fail", label: "Fail" },
              ]}
              onChange={(v) => patch({ ifNoChecks: v })}
            />
          </div>
          <div className="w-32">
            <SelectInput
              label="Waits up to"
              value={String(check.timeoutSec || 1200)}
              options={CI_LIMITS}
              onChange={(v) => patch({ timeoutSec: Number(v) })}
            />
          </div>
        </div>
      ) : null}

      {check.kind === "handoff-has" ? (
        <TextArea
          label="Keys, one per line (plan.cause reaches in)"
          value={(check.keys || []).join("\n")}
          onChange={(v) =>
            patch({
              keys: String(v)
                .split("\n")
                .map((k) => k.trim())
                .filter(Boolean),
            })
          }
        />
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
