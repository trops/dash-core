/**
 * checkPackage.js — a check package's manifest, check.json (DASH-106).
 *
 * A check package is a folder: check.json, plus its file for a file check.
 *
 *   {
 *     "name": "plan-has-sections",        letters, digits, . - _
 *     "description": "…", "version": "1.0.0", "author": "…",
 *     "kind": "file" | "tool",
 *     "run": "check.js",                  file: its file in the folder
 *     "tool": {                           tool: a read-only provider tool
 *       "type": "jira", "tool": "getJiraIssue",
 *       "args": { "issueIdOrKey": { "field": "item.id" } },
 *       "answerRules": [{ "path": "key", "op": "notEmpty" }]
 *     },
 *     "inputs": [{ "name", "label", "type", "default", "description" }],
 *     "needs": { "commands": ["node"], "provider": "jira" }
 *   }
 *
 * Inputs are declared like team settings. A step fills them ({ kind:
 * "package", package, inputs }), and can use {team settings}, {item.*} and
 * {workspace.*}. A file check gets them as DASH_CHECK_<NAME> and as
 * .check.inputs in its input; a tool check's args read them as
 * { "field": "check.inputs.<name>" }.
 *
 * Pure.
 */
"use strict";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const INPUT_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const INPUT_TYPES = ["text", "url", "number", "boolean", "command", "folder"];
const KINDS = ["file", "tool"];
const MAX_INPUTS = 12;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 256 * 1024;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v, n = 500) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * A manifest, checked: { manifest } or { error }.
 * @param {object} m  check.json, parsed
 */
function cleanCheckManifest(m) {
  if (!isObj(m)) return { error: "check.json must be a JSON object" };
  const name = str(m.name, 64);
  if (!NAME_RE.test(name)) {
    return {
      error: `check.json's name "${name}" must be lowercase letters, digits, ".", "-" and "_"`,
    };
  }
  const kind = m.kind === undefined ? (m.tool ? "tool" : "file") : m.kind;
  if (!KINDS.includes(kind)) {
    return { error: `check.json's kind must be "file" or "tool"` };
  }
  const version = str(m.version, 40) || "0.0.0";
  if (!VERSION_RE.test(version)) {
    return { error: `check.json's version "${version}" must be like 1.0.0` };
  }
  const out = {
    name,
    description: str(m.description, 500),
    version,
    author: str(m.author, 120),
    kind,
    inputs: [],
    needs: {},
  };
  if (kind === "file") {
    const run = str(m.run, 100);
    if (!RUN_RE.test(run) || run.includes("..")) {
      return {
        error:
          'A file check\'s check.json names its file in "run" (e.g. "check.js")',
      };
    }
    out.run = run;
  } else {
    const t = isObj(m.tool) ? m.tool : null;
    if (!t || !str(t.type, 40) || !str(t.tool, 100)) {
      return {
        error:
          'A tool check\'s check.json has "tool": { "type" (the provider type, e.g. "jira"), "tool", "args", "answerRules" }',
      };
    }
    const rules = Array.isArray(t.answerRules) ? t.answerRules : [];
    if (!rules.length) {
      return { error: "A tool check needs answerRules to decide pass or fail" };
    }
    let copy;
    try {
      copy = JSON.parse(
        JSON.stringify({ args: t.args || {}, answerRules: rules }),
      );
    } catch (_e) {
      return {
        error: "A tool check's args and answerRules must be plain JSON",
      };
    }
    out.tool = {
      type: str(t.type, 40).toLowerCase(),
      tool: str(t.tool, 100),
      args: isObj(copy.args) ? copy.args : {},
      answerRules: copy.answerRules,
    };
    out.needs.provider = out.tool.type;
  }
  const inputs = Array.isArray(m.inputs) ? m.inputs : [];
  if (inputs.length > MAX_INPUTS) {
    return { error: `A check has at most ${MAX_INPUTS} inputs` };
  }
  const seen = new Set();
  for (const i of inputs) {
    const n = isObj(i) ? str(i.name, 40) : "";
    if (!INPUT_RE.test(n)) {
      return {
        error: `Each input's name must be letters, digits and _, starting with a letter ("${n}")`,
      };
    }
    if (seen.has(n)) return { error: `The input "${n}" is there twice` };
    seen.add(n);
    const type = INPUT_TYPES.includes(i.type) ? i.type : "text";
    out.inputs.push({
      name: n,
      label: str(i.label, 120) || n,
      type,
      ...(i.default !== undefined && i.default !== null
        ? { default: type === "boolean" ? !!i.default : String(i.default) }
        : {}),
      ...(str(i.description) ? { description: str(i.description) } : {}),
      ...(i.required === true ? { required: true } : {}),
    });
  }
  const needs = isObj(m.needs) ? m.needs : {};
  const cmds = Array.isArray(needs.commands)
    ? needs.commands
        .map((c) => str(c, 40))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  if (cmds.length) out.needs.commands = cmds;
  if (!out.needs.provider && str(needs.provider, 40)) {
    out.needs.provider = str(needs.provider, 40).toLowerCase();
  }
  return { manifest: out };
}

/**
 * A package's files, checked: check.json and (for a file check) its file;
 * text only, none too big. { manifest, files } or { error }.
 * @param {{ [path]: string }} files
 */
function readCheckFiles(files) {
  if (!isObj(files) || typeof files["check.json"] !== "string") {
    return { error: "A check package has a check.json" };
  }
  let parsed;
  try {
    parsed = JSON.parse(files["check.json"]);
  } catch (e) {
    return { error: `check.json doesn't parse: ${e.message}` };
  }
  const { manifest, error } = cleanCheckManifest(parsed);
  if (error) return { error };
  const out = { "check.json": JSON.stringify(manifest, null, 2) };
  const names = Object.keys(files).filter((f) => f !== "check.json");
  if (names.length > MAX_FILES) {
    return { error: `A check package has at most ${MAX_FILES} files` };
  }
  for (const f of names) {
    if (!RUN_RE.test(f) || f.includes("..")) {
      return { error: `"${f}" can't be in a check package (flat names only)` };
    }
    if (typeof files[f] !== "string" || files[f].length > MAX_FILE_BYTES) {
      return { error: `${f} is too big for a check package` };
    }
    out[f] = files[f];
  }
  if (manifest.kind === "file" && typeof out[manifest.run] !== "string") {
    return { error: `check.json runs "${manifest.run}", which isn't there` };
  }
  return { manifest, files: out };
}

/**
 * A package's ref: "@scope/name", "scope/name" or "name" (one that ships
 * with Dash). { scope, name, id } or null.
 */
function parsePackageRef(ref) {
  // "@scope/name@1.2.0": the version isn't part of the ref.
  const r = str(ref, 140).replace(/^(@?[^@]+)@[^@/]+$/, "$1");
  const m = r.match(
    /^@?([a-z0-9][a-z0-9._-]{0,63})\/([a-z0-9][a-z0-9._-]{0,63})$/,
  );
  if (m && SCOPE_RE.test(m[1])) {
    return { scope: m[1], name: m[2], id: `@${m[1]}/${m[2]}` };
  }
  if (NAME_RE.test(r)) return { scope: null, name: r, id: r };
  return null;
}

/**
 * A step's inputs filled in: given ones, else defaults. { values, missing }.
 * @param {object} manifest
 * @param {object} given  the step's inputs (already filled with team values)
 */
function inputValues(manifest, given = {}) {
  const values = {};
  const missing = [];
  for (const i of (manifest && manifest.inputs) || []) {
    let v =
      isObj(given) && given[i.name] !== undefined ? given[i.name] : i.default;
    if (i.type === "boolean") v = v === true || v === "yes" || v === "true";
    else v = v === undefined || v === null ? "" : String(v);
    // A {name} left unfilled counts as no value.
    if (typeof v === "string" && /^\{[A-Za-z][\w.]*\}$/.test(v.trim())) v = "";
    if (i.required && v === "") missing.push(i.label || i.name);
    values[i.name] = v;
  }
  return { values, missing };
}

/** Inputs as a file check's environment: DASH_CHECK_<NAME>. */
function inputEnv(values) {
  const env = {};
  for (const [k, v] of Object.entries(values || {})) {
    env[`DASH_CHECK_${k.toUpperCase()}`] =
      typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  }
  return env;
}

/** What a package says it is, for a picker or an install review. */
function packageSummary(manifest, extra = {}) {
  return {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    author: manifest.author,
    kind: manifest.kind,
    inputs: manifest.inputs,
    needs: manifest.needs,
    ...extra,
  };
}

module.exports = {
  cleanCheckManifest,
  readCheckFiles,
  parsePackageRef,
  inputValues,
  inputEnv,
  packageSummary,
  NAME_RE,
};
