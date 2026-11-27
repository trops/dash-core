/**
 * starterPackages.js — the check packages that ship with Dash (DASH-106).
 *
 * Each is a package like any from the registry (check.json and its file),
 * kept here as text so it needs no install: a step names it by its plain
 * name ({ kind: "package", package: "plan-has-sections" }).
 *
 * Dash's built-in checks (DASH-103) are listed as packages too, so the
 * picker shows them in one place; they run as their own kinds.
 */
"use strict";

const PLAN_HAS_SECTIONS = `// plan-has-sections: the handoff's plan has each section, not empty.
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.env.DASH_INPUT, "utf8"));
const answer = String((input.input && input.input.answer) || "");
const key = process.env.DASH_CHECK_KEY || "plan";
const sections = String(process.env.DASH_CHECK_SECTIONS || "cause,fix,test")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const blocks = [...answer.matchAll(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/g)];
let h;
try {
  h = JSON.parse(blocks.length ? blocks[blocks.length - 1][1] : answer);
} catch (e) {
  console.log(JSON.stringify({ reason: "The handoff doesn't parse: " + e.message }));
  process.exit(1);
}
const plan = h && typeof h === "object" ? h[key] : null;
if (!plan || typeof plan !== "object") {
  console.log(JSON.stringify({ reason: 'The handoff has no "' + key + '" with ' + sections.join(", ") }));
  process.exit(1);
}
const missing = sections.filter((s) => !String(plan[s] == null ? "" : plan[s]).trim());
if (missing.length) {
  console.log(JSON.stringify({ reason: "The plan has no " + missing.join(", "), details: { missing } }));
  process.exit(1);
}
console.log(JSON.stringify({ reason: "The plan has " + sections.join(", ") }));
`;

const NODE_TESTS_PASS = `#!/usr/bin/env bash
# node-tests-pass: the repo's tests pass (npm test, or the command given).
set -u
cmd="\${DASH_CHECK_COMMAND:-npm test}"
out=$(bash -c "$cmd" 2>&1)
code=$?
if [ $code -ne 0 ]; then
  printf '%s\\n' "$out" | tail -30
  node -e 'console.log(JSON.stringify({ reason: process.argv[1] + " failed (exit " + process.argv[2] + "): see the output above" }))' "$cmd" "$code"
  exit 1
fi
node -e 'console.log(JSON.stringify({ reason: process.argv[1] + " passed" }))' "$cmd"
`;

const STARTERS = [
  {
    manifest: {
      name: "plan-has-sections",
      description:
        "The handoff's plan has each section (cause, fix and test by default), not empty.",
      version: "1.0.0",
      author: "Dash",
      kind: "file",
      run: "check.js",
      inputs: [
        {
          name: "key",
          label: "The plan's key in the handoff",
          type: "text",
          default: "plan",
        },
        {
          name: "sections",
          label: "Sections, comma-separated",
          type: "text",
          default: "cause,fix,test",
        },
      ],
      needs: { commands: ["node"] },
    },
    files: { "check.js": PLAN_HAS_SECTIONS },
  },
  {
    manifest: {
      name: "node-tests-pass",
      description: "The repo's tests pass: npm test, or the command you give.",
      version: "1.0.0",
      author: "Dash",
      kind: "file",
      run: "check.sh",
      inputs: [
        {
          name: "command",
          label: "Test command",
          type: "command",
          default: "npm test",
        },
      ],
      needs: { commands: ["bash", "node"] },
    },
    files: { "check.sh": NODE_TESTS_PASS },
  },
  {
    manifest: {
      name: "jira-ticket-exists",
      description: "The job's work item is a Jira ticket that exists.",
      version: "1.0.0",
      author: "Dash",
      kind: "tool",
      tool: {
        type: "jira",
        tool: "getJiraIssue",
        args: {
          cloudId: { field: "check.inputs.cloudId" },
          issueIdOrKey: { field: "check.inputs.key" },
        },
        answerRules: [{ path: "key", op: "equals", ref: "check.inputs.key" }],
      },
      inputs: [
        {
          name: "cloudId",
          label: "Jira cloud id",
          type: "text",
          required: true,
        },
        {
          name: "key",
          label: "Ticket key",
          type: "text",
          default: "{item.id}",
        },
      ],
      needs: { provider: "jira" },
    },
    files: {},
  },
  {
    manifest: {
      name: "github-issue-exists",
      description: "The job's work item is a GitHub issue that exists.",
      version: "1.0.0",
      author: "Dash",
      kind: "tool",
      tool: {
        type: "github",
        tool: "get_issue",
        args: {
          owner: { field: "check.inputs.owner" },
          repo: { field: "check.inputs.repo" },
          issue_number: { field: "check.inputs.number" },
        },
        answerRules: [{ path: "number", op: "notEmpty" }],
      },
      inputs: [
        { name: "owner", label: "Owner", type: "text", required: true },
        { name: "repo", label: "Repo", type: "text", required: true },
        { name: "number", label: "Issue number", type: "text", required: true },
      ],
      needs: { provider: "github" },
    },
    files: {},
  },
];

// Dash's own kinds (DASH-103), shown with the packages.
const BUILT_INS = [
  {
    name: "git-on-branch",
    description: "The job's workspace is on its branch.",
    kind: "git-on-branch",
  },
  {
    name: "git-committed",
    description:
      "At least one commit past the base branch, nothing uncommitted.",
    kind: "git-committed",
  },
  {
    name: "pr-ci",
    description: "The PR in the handoff has CI that passed.",
    kind: "pr-ci",
  },
  {
    name: "handoff-has",
    description: "The handoff has these keys, not empty.",
    kind: "handoff-has",
  },
];

function starterPackage(name) {
  const s = STARTERS.find((p) => p.manifest.name === name);
  return s ? { manifest: s.manifest, files: s.files, source: "dash" } : null;
}

module.exports = { STARTERS, BUILT_INS, starterPackage };
