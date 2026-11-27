/**
 * checksGuide.js: get_setup_guide({ topic: "checks" }) (DASH-107).
 *
 * How to write a deterministic check, for an AI (or a person) doing it:
 * the contract a check runs under, the check.json manifest, templates for
 * sh, node and python file checks and for a tool check, how to try one by
 * hand, and where it goes. The same text ships as the agent skill
 * skills/dash-check-authoring/SKILL.md (a test keeps them the same).
 */
"use strict";

const CHECKS_GUIDE = `# How to Write a Dash Check

A check proves one thing about a bot's work, the same way every time. Dash runs it after the bot answers and holds the work until it passes. When it fails, its reason goes back to the bot, so the reason must say exactly what to fix.

## 1. The rule
- **Deterministic.** No AI, no guessing: the same input gives the same result. Read files, run the repo's own commands, call an API, compare.
- **Says what to fix.** "No test for: slug keeps dashes" beats "Failed". Name the file, the key, the item.
- **One thing.** A check that tests and lints and checks the PR is three checks.
- **Can't decide it in code?** ("Is this plan any good?") Don't write a check: add a reviewer step (another bot judges it) or a you step (a person approves).

## 2. The contract (every file check)
- It runs in the job's **workspace** (the repo the bot works in): cwd is that folder.
- **Input:** the run as JSON, in the file named by \`$DASH_INPUT\` and on stdin:
  - \`.input.answer\`: the bot's whole answer (its handoff is the last \`\`\`json block);
  - \`.item\`: the job's work item { id, title, url, source };
  - \`.workspace\`: { dir, branch }.
- **Environment:** DASH_INPUT, DASH_ITEM_ID, DASH_ITEM_TITLE, DASH_ITEM_URL, DASH_ITEM_SOURCE, DASH_WORKSPACE, DASH_BRANCH, DASH_STEP (the step's name). With a GitHub provider on the bot: GH_TOKEN, and git signed in. Never print the token.
- **Result:** exit 0 passes; anything else fails. To say why, print one JSON line last: \`{"reason": "…", "details": {…}}\`. The reason shows on the job and goes back to the bot.
- **Time:** 2 minutes unless the step sets timeoutSec (up to 30). Don't sleep-poll for long: a check that waits (for CI) has a deadline and says what it waited for.
- **Nothing to do:** print \`{"reason": "…", "handOn": false}\` and exit 0 to end the job quietly (better: the bot says "status": "none" in its handoff).

## 3. Where a check lives
- **In the repo (best):** \`.dash/checks/<name>\` with any extension (validate.sh, plan-complete.js, lint.py). A step uses it as { kind: "repo", name: "validate" }. Dash reads it from the repo's **base branch**, so the bot's own branch can't change the check that judges it. It's reviewed like code, and runs the same commands as the repo's CI.
- **How it runs:** its #! line, else by extension: .js .cjs .mjs with node, .sh with bash, .py with python3, anything else with sh.
- **A package** (shared, in the registry, or vendored): a folder \`.dash/checks/<name>/\` with a check.json manifest and its file (section 5).
- **Built in:** git-on-branch, git-committed, pr-ci and handoff-has need no file (get_setup_guide("bots") §5).

## 4. Templates

**sh** (\`.dash/checks/validate.sh\`): run the repo's own CI commands.
\`\`\`sh
#!/usr/bin/env bash
set -u
out=$(npm test 2>&1) || {
  echo "$out" | tail -20
  echo '{"reason": "npm test failed: see the output above"}'
  exit 1
}
echo '{"reason": "npm test passed"}'
\`\`\`

**node** (\`.dash/checks/plan-complete.js\`): read the handoff.
\`\`\`js
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.env.DASH_INPUT, "utf8"));
const answer = String((input.input && input.input.answer) || "");
const blocks = [...answer.matchAll(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/g)];
let h = {};
try { h = JSON.parse(blocks.length ? blocks[blocks.length - 1][1] : answer); } catch (e) {
  console.log(JSON.stringify({ reason: "The handoff doesn't parse: " + e.message }));
  process.exit(1);
}
const missing = ["cause", "fix", "test"].filter((k) => !String((h.plan || {})[k] || "").trim());
if (missing.length) {
  console.log(JSON.stringify({ reason: "The plan has no " + missing.join(", "), details: { missing } }));
  process.exit(1);
}
console.log(JSON.stringify({ reason: "The plan has cause, fix and test" }));
\`\`\`

**python** (\`.dash/checks/changelog.py\`): look at the work.
\`\`\`python
import json, os, subprocess, sys
base = "origin/main"
changed = subprocess.run(["git", "diff", "--name-only", base + "...HEAD"], capture_output=True, text=True).stdout.split()
if changed and "CHANGELOG.md" not in changed:
    print(json.dumps({"reason": "CHANGELOG.md isn't updated: add a line for " + os.environ.get("DASH_ITEM_ID", "this change")}))
    sys.exit(1)
print(json.dumps({"reason": "CHANGELOG.md is updated"}))
\`\`\`

**A tool check** (no file: a read-only provider tool, then rules on its answer). In a step: { kind: "tool", server: "Atlassian MCP", tool: "getJiraIssue", args: { issueIdOrKey: "{item.id}" }, answerRules: [...] }. As a package, its check.json says the provider type it needs (section 5), so the same check works for anyone with that kind of provider.

## 5. The check.json manifest (a check package)
\`\`\`json
{
  "name": "plan-has-sections",
  "description": "The handoff's plan has cause, fix and test.",
  "version": "1.0.0",
  "author": "you",
  "kind": "file",
  "run": "check.js",
  "inputs": [
    { "name": "sections", "label": "Sections", "type": "text", "default": "cause,fix,test" }
  ],
  "needs": { "commands": ["node"] }
}
\`\`\`
- **kind "file":** "run" names the file in the folder; it follows the contract above. Its inputs reach it as DASH_CHECK_<NAME> (DASH_CHECK_SECTIONS) and as .check.inputs in $DASH_INPUT.
- **kind "tool":** no file; "tool": { "type": "jira", "tool": "getJiraIssue", "args": { "issueIdOrKey": "{item.id}" }, "answerRules": [...] }, and "needs": { "provider": "jira" }. Trackers share inputs ({item.id}), so jira-ticket-exists, github-issue-exists and linear-issue-exists swap for each other.
- **inputs** are declared like team settings (name, label, type, default). A step fills them, and can use {team settings}, {item.*} and {workspace.*}.
- **needs:** the commands it runs, or the provider type it calls. Installing shows them, with its source and author.

## 6. Try it by hand
In the repo, with a sample input:
\`\`\`sh
echo '{"input": {"answer": "Done.\\n\\n\`\`\`json\\n{\\"summary\\": \\"x\\"}\\n\`\`\`"}, "item": {"id": "DASH-1"}}' > /tmp/sample.json
npx -p @trops/dash-core dash-check validate --input /tmp/sample.json
npx -p @trops/dash-core dash-check --list
npx -p @trops/dash-core dash-check --ci     # every check, as CI would
\`\`\`
dash-check runs the workspace's copy (what you're editing); --base runs the base branch's, as Dash does. Try it twice: once with an input that should pass, and once with one that should fail. The failure's reason must say what to fix.

## 7. Ship it
- **Repo check:** commit \`.dash/checks/<name>\` in a PR. Once merged it's on the base branch, and every bot's { kind: "repo", name } step uses it. Run \`dash-check --ci\` in the repo's CI so the bots and CI agree.
- **Package:** a folder with check.json and its file. Vendor it into \`.dash/checks/<name>/\`, or publish it to the registry so any team can install it.
- **In a bot:** a step { kind: "repo", name: "<name>" }, with fallback or ifMissing: "skip" for repos that don't have it yet. check_team_setup tells you which repos are missing it.
`;

module.exports = { CHECKS_GUIDE };
