/**
 * package.js — a check from a check package (DASH-106).
 *
 * { kind: "package", package: "plan-has-sections" | "@scope/name",
 *   inputs?: { … }, timeoutSec? }
 *
 * A file package runs its file the way a repo check runs (checks/kinds/
 * repo.js): in the job's workspace, with the input as JSON in $DASH_INPUT
 * and on stdin, plus its inputs as DASH_CHECK_<NAME> and .check.inputs.
 * A tool package calls its read-only tool on a provider of the type it
 * needs (e.g. the bot's Jira provider) and checks the answer's rules.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runCommand } = require("./command");
const { runToolCall } = require("./toolCall");
const { parsePackageRef, inputValues, inputEnv } = require("../checkPackage");

const RUNNERS = {
  ".js": "node",
  ".cjs": "node",
  ".mjs": "node",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python3",
};
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** What's wrong with a package step's settings, or null. */
function packageCheckError(check) {
  const c = check || {};
  if (!parsePackageRef(c.package)) {
    return 'a package check names its package, e.g. "plan-has-sections" or "@scope/name"';
  }
  if (
    c.inputs !== undefined &&
    (typeof c.inputs !== "object" || Array.isArray(c.inputs))
  ) {
    return "a package check's inputs must be an object";
  }
  return null;
}

/**
 * Run a package's file from its files (in a temp folder), in `cwd`.
 * Shared with a repo check kept as a package folder.
 */
async function runPackageFiles(
  { manifest, files, label },
  input,
  values,
  opts,
) {
  const dir = fs.mkdtempSync(
    path.join(opts.tmpDir || os.tmpdir(), "dash-check-pkg-"),
  );
  try {
    for (const [f, body] of Object.entries(files)) {
      if (f === "check.json") continue;
      fs.writeFileSync(path.join(dir, f), body, { mode: 0o755 });
    }
    const file = path.join(dir, manifest.run);
    const first = String(files[manifest.run] || "").split(/\r?\n/, 1)[0] || "";
    const runner = first.startsWith("#!")
      ? null
      : RUNNERS[path.extname(file).toLowerCase()] || "sh";
    const command = runner ? `${runner} ${quote(file)}` : quote(file);
    const res = await runCommand(
      { command, timeoutSec: opts.timeoutSec, passWhen: { type: "exit0" } },
      { ...(input || {}), check: { name: manifest.name, inputs: values } },
      {
        cwd: opts.cwd,
        tmpDir: opts.tmpDir,
        ...(opts.spawn ? { spawn: opts.spawn } : {}),
        env: { ...(opts.env || {}), ...inputEnv(values) },
      },
    );
    const said = /^(Passed|Failed) \(exit/.test(String(res.reason || ""));
    return { ...res, reason: said ? `${label}: ${res.reason}` : res.reason };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {object} check  { kind: "package", package, inputs?, timeoutSec? }
 * @param {object} input  the standard input
 * @param {{ getPackage: (ref) => ({ manifest, files }|null),
 *           cwd?, env?, tmpDir?, spawn?,
 *           serverForType?: (type) => string|null, callTool?, isReadOnly? }} deps
 */
async function runPackageCheck(check, input, deps = {}) {
  const bad = packageCheckError(check);
  if (bad) return { pass: false, reason: `This check can't run: ${bad}` };
  const ref = parsePackageRef(check.package);
  const pkg = deps.getPackage ? deps.getPackage(ref.id) : null;
  if (!pkg) {
    return {
      pass: false,
      reason: ref.scope
        ? `The check package ${ref.id} isn't installed: install it from the registry (Bots › Checks › Add check)`
        : `There's no check package "${ref.id}"`,
    };
  }
  const { manifest, files } = pkg;
  const { values, missing } = inputValues(manifest, check.inputs || {});
  if (missing.length) {
    return {
      pass: false,
      reason: `${manifest.name} needs ${missing.join(", ")}: set ${missing.length === 1 ? "it" : "them"} in the step`,
    };
  }
  if (manifest.kind === "tool") {
    const type = manifest.tool.type;
    const server = deps.serverForType ? deps.serverForType(type) : null;
    if (!server) {
      return {
        pass: false,
        reason: `${manifest.name} needs a ${type} provider: give the bot one`,
      };
    }
    const res = await runToolCall(
      {
        server,
        tool: manifest.tool.tool,
        args: manifest.tool.args,
        answerRules: manifest.tool.answerRules,
      },
      { ...(input || {}), check: { name: manifest.name, inputs: values } },
      { callTool: deps.callTool, isReadOnly: deps.isReadOnly },
    );
    return { ...res, reason: `${manifest.name}: ${res.reason}` };
  }
  const cwd = deps.cwd;
  if (!cwd || !fs.existsSync(cwd)) {
    return { pass: false, reason: "The folder it runs in isn't there" };
  }
  return runPackageFiles(
    { manifest, files, label: manifest.name },
    input,
    values,
    {
      cwd,
      env: deps.env,
      tmpDir: deps.tmpDir,
      spawn: deps.spawn,
      timeoutSec: check.timeoutSec,
    },
  );
}

module.exports = { runPackageCheck, runPackageFiles, packageCheckError };
