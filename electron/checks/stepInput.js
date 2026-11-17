/**
 * stepInput.js
 *
 * What goes into a step and what comes out of it (flows PRD, phase 3).
 *
 * Every step — a bot, a check of any kind — gets one standard input:
 *
 *   { goal:  { id, title, body, criteria, round, maxRounds },
 *     input: <the record of the step whose work this is>,
 *     from:  { <earlier step, by key>: <its record> },
 *     files: [ paths in the goal's work folder ],
 *     fix?:  { step, reason, details }   // why the work came back }
 *
 * and a step that declares output fields must fill them: a record missing
 * a required field, or with one of the wrong kind, is refused before the
 * next step starts.
 *
 * Pure: no Electron, no I/O (files are passed in).
 */
"use strict";

const { chain, inputStep, stepById } = require("../flows/flowModel");

/** The key a step's record goes under in `from`: its name in camelCase. */
function stepKey(step) {
  const words = String((step && step.name) || "step")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "step";
  const key = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
  return /^[0-9]/.test(key) ? `s${key}` : key;
}

/** The latest passed record a step wrote on this task, or null. */
function latestPassed(task, stepId) {
  const history = (task && task.history) || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r && r.stepId === stepId && r.status === "passed") return r;
  }
  return null;
}

/** The latest failed record on a task, if the work came back because of it. */
function latestFix(task, flow) {
  const history = (task && task.history) || [];
  // Past the user's own moves (one more round): the failure before them.
  let i = history.length - 1;
  while (i >= 0 && history[i] && history[i].by === "you") i -= 1;
  const last = history[i];
  if (!last || last.status !== "failed") return null;
  const step = stepById(flow, last.stepId);
  return {
    step: step ? step.name : last.stepId || "",
    reason: last.summary || "",
    details: last.details === undefined ? null : last.details,
  };
}

/**
 * The standard input for `stepId` on a goal's task.
 * @param {{ goal: object, task: object, flow: object, stepId: string,
 *           files?: string[] }} p
 */
function buildInput({ goal, task, flow, stepId, files = [] }) {
  const src = inputStep(flow, stepId);
  const srcRecord = src ? latestPassed(task, src.id) : null;
  const from = {};
  for (const step of chain(flow)) {
    if (step.id === stepId) break;
    if (step.kind === "you") continue;
    const r = latestPassed(task, step.id);
    if (r && r.output !== undefined) from[stepKey(step)] = r.output;
  }
  const out = {
    goal: {
      id: goal ? goal.id : null,
      title: goal ? goal.title : "",
      body: goal ? goal.body || "" : "",
      criteria: goal && Array.isArray(goal.criteria) ? goal.criteria : [],
      round: (task && task.round) || 1,
      maxRounds: (task && task.maxRounds) || (flow && flow.maxRounds) || 3,
    },
    input: srcRecord && srcRecord.output !== undefined ? srcRecord.output : {},
    from,
    files: Array.isArray(files) ? files.slice(0, 200) : [],
  };
  const fix = latestFix(task, flow);
  if (fix) out.fix = fix;
  return out;
}

/** The kind of a value, as the field kinds name them. */
function kindOf(value) {
  if (value == null) return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "text";
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => typeof v === "string")) {
      if (value.every((v) => /^https?:\/\//i.test(v))) return "links";
      if (value.every((v) => /[\\/]|\.[a-z0-9]{1,6}$/i.test(v))) return "paths";
    }
    return "list";
  }
  return "object";
}

const fits = (want, value) => {
  const got = kindOf(value);
  if (want === "list") return Array.isArray(value);
  if (want === "links" || want === "paths") return Array.isArray(value);
  if (want === "text") return got === "text";
  return got === want;
};

const filled = (v) =>
  v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/**
 * Does a record fill a step's declared fields?
 * @returns {{ ok: boolean, missing: string[], wrong: Array<{name, want, got}> }}
 */
function checkOutput(fields, output) {
  const list = Array.isArray(fields) ? fields : [];
  const o =
    output && typeof output === "object" && !Array.isArray(output)
      ? output
      : {};
  const missing = [];
  const wrong = [];
  for (const f of list) {
    const v = o[f.name];
    if (!filled(v)) {
      if (f.required) missing.push(f.name);
      continue;
    }
    if (!fits(f.kind, v))
      wrong.push({ name: f.name, want: f.kind, got: kindOf(v) });
  }
  return { ok: !missing.length && !wrong.length, missing, wrong };
}

/** What a bot is told when its record doesn't match. */
function outputProblem(stepName, result) {
  const parts = [];
  if (result.missing.length) {
    parts.push(`missing ${result.missing.join(", ")}`);
  }
  for (const w of result.wrong) {
    parts.push(`${w.name} should be ${w.want}, not ${w.got}`);
  }
  return `${stepName}'s record doesn't match what it must have: ${parts.join("; ")}. Fill them in the output and call write_done again.`;
}

/**
 * Fields suggested from a step's last records (frame 26): every field the
 * records had, its kind, and required when every record filled it.
 */
function suggestFields(outputs) {
  const list = (Array.isArray(outputs) ? outputs : []).filter(
    (o) => o && typeof o === "object" && !Array.isArray(o),
  );
  const seen = new Map();
  for (const o of list) {
    for (const [name, value] of Object.entries(o)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const cur = seen.get(name) || { name, kinds: new Set(), count: 0 };
      if (filled(value)) {
        cur.count += 1;
        cur.kinds.add(kindOf(value));
      }
      seen.set(name, cur);
    }
  }
  return [...seen.values()].map((f) => ({
    name: f.name,
    kind: f.kinds.size === 1 ? [...f.kinds][0] : "text",
    required: list.length > 0 && f.count === list.length,
  }));
}

/**
 * Every field of an input as the "What it gets" column lists it: its path,
 * kind and a short sample (frames 18, 19).
 */
function describeInput(input, { maxDepth = 2 } = {}) {
  const rows = [];
  const sample = (v) => {
    if (typeof v === "string")
      return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
    if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
    if (v && typeof v === "object") return `${Object.keys(v).length} fields`;
    return String(v);
  };
  const walk = (v, p, depth) => {
    const isObj = v && typeof v === "object" && !Array.isArray(v);
    if (isObj && depth < maxDepth && Object.keys(v).length) {
      for (const [k, child] of Object.entries(v))
        walk(child, `${p}.${k}`, depth + 1);
      return;
    }
    rows.push({ path: p, kind: kindOf(v), sample: sample(v) });
  };
  for (const top of ["goal", "input", "from", "files", "fix"]) {
    if (input && input[top] !== undefined)
      walk(input[top], top, top === "files" ? 2 : 0);
  }
  return rows;
}

/** A value at a dotted path ("input.links", "from.notes.0.title"). */
function valueAt(obj, dotted) {
  const parts = String(dotted || "")
    .split(".")
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

module.exports = {
  stepKey,
  latestPassed,
  buildInput,
  kindOf,
  checkOutput,
  outputProblem,
  suggestFields,
  describeInput,
  valueAt,
};
