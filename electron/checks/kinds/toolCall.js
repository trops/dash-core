/**
 * toolCall.js — a check that asks a provider for a fact and checks the
 * answer (flows PRD, phase 2; frame 20). It calls one tool that can't
 * change anything, with inputs taken from the step's record (`build.pr`),
 * and passes when every rule on the answer holds — e.g. CI succeeded, and
 * on the Builder's commit, not an older one.
 *
 * The caller injects `callTool` and `isReadOnly`; a tool that could change
 * something is never called.
 */
"use strict";

const { valueAt } = require("../stepInput");

const OPS = [
  "equals",
  "notEquals",
  "contains",
  "notEmpty",
  "atLeast",
  "atMost",
];

/** Tool names that read: what a check may call when a server says nothing. */
// (Case matters: `getEvents` reads, `checkout_branch` doesn't. `query` and
// `execute` can run anything, so they need the server's read-only hint.)
const READ_NAME =
  /^(get|list|search|read|fetch|find|view|describe|show|lookup|count|status)([_-][a-z]|[A-Z])|^(get|list|search|read|fetch|find|view|describe|show|lookup)$/;

/** The value an argument or rule compares with: written in, or from the input. */
function resolveValue(spec, input) {
  if (spec && typeof spec === "object" && typeof spec.field === "string") {
    return valueAt(input, spec.field);
  }
  if (spec && typeof spec === "object" && "value" in spec) return spec.value;
  return spec;
}

function parseAnswer(result) {
  if (result && result.json !== undefined) return result.json;
  const text = result && typeof result.text === "string" ? result.text : "";
  try {
    return JSON.parse(text);
  } catch (_e) {
    return text;
  }
}

function checkRule(rule, answer, input) {
  const got = rule.path ? valueAt(answer, rule.path) : answer;
  const want = resolveValue(
    rule.ref ? { field: rule.ref } : { value: rule.value },
    input,
  );
  const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  let pass;
  switch (rule.op) {
    case "notEquals":
      pass = JSON.stringify(got) !== JSON.stringify(want);
      break;
    case "contains":
      pass =
        typeof got === "string"
          ? got.includes(String(want))
          : Array.isArray(got) &&
            got.some((x) => JSON.stringify(x) === JSON.stringify(want));
      break;
    case "notEmpty":
      pass =
        got !== undefined &&
        got !== null &&
        got !== "" &&
        !(Array.isArray(got) && !got.length);
      break;
    case "atLeast":
      pass = Number(got) >= Number(want);
      break;
    case "atMost":
      pass = Number(got) <= Number(want);
      break;
    default:
      pass =
        JSON.stringify(got) === JSON.stringify(want) ||
        (got != null && want != null && String(got) === String(want));
  }
  const label = `${rule.path || "answer"} ${rule.op || "equals"}${rule.op === "notEmpty" ? "" : ` ${show(want)}`}`;
  return {
    pass,
    reason: pass
      ? `${rule.path || "answer"} = ${show(got)}`
      : `${label}, but it's ${show(got)}`,
  };
}

/**
 * Run a tool call check.
 * @param {{ server: string, tool: string, args?: object, answerRules?: object[] }} check
 * @param {object} input
 * @param {{ callTool: (server, tool, args) => Promise<object>,
 *           isReadOnly: (server, tool) => boolean }} deps
 */
async function runToolCall(check, input, deps = {}) {
  const c = check || {};
  if (!c.server || !c.tool) return { pass: false, reason: "No tool is chosen" };
  if (!deps.isReadOnly || !deps.isReadOnly(c.server, c.tool)) {
    return {
      pass: false,
      reason: `Not run: ${c.tool} could change something. A check only uses tools that can't.`,
    };
  }
  if (!deps.callTool)
    return { pass: false, reason: "Tools can't be reached here" };
  const args = {};
  for (const [k, spec] of Object.entries(c.args || {})) {
    const v = resolveValue(spec, input);
    if (v !== undefined) args[k] = v;
  }
  let result;
  try {
    result = await deps.callTool(c.server, c.tool, args);
  } catch (e) {
    return {
      pass: false,
      reason: `${c.tool} failed: ${(e && e.message) || e}`,
    };
  }
  if (result && result.isError) {
    return {
      pass: false,
      reason: `${c.tool} answered with an error: ${String(result.text || "").slice(0, 300)}`,
    };
  }
  const answer = parseAnswer(result);
  const rules = (Array.isArray(c.answerRules) ? c.answerRules : []).filter(
    (r) => r && OPS.includes(r.op || "equals"),
  );
  if (!rules.length) {
    return {
      pass: false,
      reason: "No rules are set for the answer",
      details: { args },
    };
  }
  const results = rules.map((r) => checkRule(r, answer, input));
  const failed = results.filter((r) => !r.pass);
  return {
    pass: !failed.length,
    reason: failed.length
      ? failed.map((f) => f.reason).join(" · ")
      : results.map((r) => r.reason).join(" · "),
    details: { args, rules: results },
  };
}

module.exports = { runToolCall, READ_NAME, OPS, checkRule, parseAnswer };
