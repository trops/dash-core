/**
 * checkRunner.js — runs one check of any kind on a step's standard input
 * and answers { pass, reason, details } (flows PRD, phase 2; G2). The check
 * never takes a bot's word for anything: it works from the record and from
 * facts outside the bots (a command's exit code, a provider's answer, the
 * links themselves), so "Builder said: passed" can sit next to "Dash
 * checked: failed" (frame 3).
 *
 * Every kind only looks: rules compare fields, a command runs in the flow's
 * folder with the always-blocked commands refused, a script runs sealed
 * off, and a tool call only uses tools that can't change anything.
 */
"use strict";

const { runRules } = require("./kinds/rules");
const { runCommand } = require("./kinds/command");
const { runScript } = require("./kinds/script");
const { runToolCall } = require("./kinds/toolCall");

const KIND_LABELS = {
  rules: "Rules",
  command: "Command",
  script: "Script",
  tool: "Tool call",
};

/**
 * @param {object} check   the step's check settings ({ kind, … })
 * @param {object} input   the standard input (stepInput.buildInput)
 * @param {{ fetchStatus?, callTool?, isReadOnly?, cwd?: string,
 *           tmpDir?: string, readScript?: (ref) => string|null,
 *           now?: () => number }} deps
 * @returns {Promise<{ pass: boolean, reason: string, details: any,
 *                     output?: string, kind: string, ms: number }>}
 */
async function runCheck(check, input, deps = {}) {
  const now = deps.now || Date.now;
  const started = now();
  const kind = check && check.kind;
  let res;
  try {
    if (kind === "rules") {
      res = await runRules(check, input, { fetchStatus: deps.fetchStatus });
    } else if (kind === "command") {
      res = await runCommand(check, input, {
        cwd: deps.cwd,
        tmpDir: deps.tmpDir,
      });
    } else if (kind === "script") {
      // A script kept in the flow's folder (phase 6) is read fresh each run.
      let source;
      if (check.scriptFile && deps.readScript) {
        source = deps.readScript(check.scriptFile);
        if (source == null) {
          res = { pass: false, reason: `${check.scriptFile} isn't there` };
        }
      }
      if (!res)
        res = await runScript(check, input, { tmpDir: deps.tmpDir, source });
    } else if (kind === "tool") {
      res = await runToolCall(check, input, {
        callTool: deps.callTool,
        isReadOnly: deps.isReadOnly,
      });
    } else {
      res = { pass: false, reason: "This check has no kind set" };
    }
  } catch (e) {
    res = {
      pass: false,
      reason: `The check failed to run: ${(e && e.message) || e}`,
    };
  }
  return {
    pass: res.pass === true,
    reason: String(res.reason || (res.pass ? "Passed" : "Failed")).slice(
      0,
      2000,
    ),
    details: res.details === undefined ? null : res.details,
    // Passed, with nothing to hand on (DASH-65): the work ends here.
    ...(res.pass === true && res.handOn === false ? { handOn: false } : {}),
    ...(res.output ? { output: String(res.output).slice(-4000) } : {}),
    ...(res.exitCode !== undefined ? { exitCode: res.exitCode } : {}),
    kind: kind || null,
    ms: Math.max(0, now() - started),
  };
}

module.exports = { runCheck, KIND_LABELS };
