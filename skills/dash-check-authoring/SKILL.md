---
name: dash-check-authoring
description: Write a deterministic Dash check with @trops/dash-check (a recipe, a .check.js file, a helper of your own, a repo check in .dash/checks, or a check package): the layers, the contract, templates, and how to try it with dash-check. Use when asked to write, fix or test a Dash check.
---

# How to Write a Dash Check

A check proves one thing about a bot's work, the same way every time. Dash runs it after the bot answers and holds the work until it passes. When it fails, its reason goes back to the bot, so the reason must say exactly what to fix.

## 1. The rule
- **Deterministic.** No AI, no guessing: the same input gives the same result. Read files, run the repo's own commands, call an API, compare.
- **Says what to fix.** "No test for: slug keeps dashes" beats "Failed". Name the file, the key, the item.
- **One thing.** A check that tests and lints and checks the PR is three checks.
- **Can't decide it in code?** ("Is this plan any good?") Don't write a check: add a reviewer step (another bot judges it) or a you step (a person approves).

## 2. The layers (@trops/dash-check)
Checks are built from [@trops/dash-check](https://github.com/trops/dash-check), in layers. Each layer is made only from the one below it, so pick the highest one that does the job.

**Layer 0: primitives** (`require("@trops/dash-check")`)
- `check(name, fn)`, `check.skip`, `check.only`, `describe(name, fn)`. `fn` gets `ctx` and may be async.
- `expect(value, label)` and its matchers: `toBe`, `toEqual`, `toBeDefined`, `toBeTruthy`, `toBeArray`, `toBeString`, `toBeNonEmptyString`, `toBeNumber`, `toBeEmpty`, `toHaveLength`, `toHaveLengthAtLeast`, `toContain`, `toBeOneOf`, `toHaveKeys`, `toMatch`, `toBeGreaterThan`, `toBeLessThan`, with `.not`, `.resolves` and `.rejects`. A matcher's last argument is the message a failure says: write it as the fix. Every failing expect is listed, and the check goes on.
- `ctx`: `ctx.handoff` (the answer's last ```json block, parsed), `ctx.answer`, `ctx.item`, `ctx.workspace`, `ctx.row`, `ctx.settings`, `ctx.env`; `ctx.fs` (exists, read, readJson, list), `ctx.run(cmd)`, `ctx.git` (branch, isClean, commitsSince, changedFiles…), `ctx.github` (pr, checksFor, waitForChecks, with GH_TOKEN) and `ctx.tool(provider, tool, args)`: a read-only call to one of the bot's providers. Dash refuses a tool that could change something.

**Layer 1: helpers** (`require("@trops/dash-check/helpers")`): ready-made, described blocks. Call one as `await git.committedSince(ctx, { base: "main" })`.
- handoff: has, status, eachHas; plan: hasSections, acceptanceEachHasTest;
- git: onBranch, committedSince, clean, changedOnly, noChangesTo;
- files: exist, contain, noneMatch; commands: passes, outputMatches;
- node: testsPass, lintPasses, noNewDependencies; github: prOpen, ciPassed;
- tracker: ticketExists, ticketHasLabel (through ctx.tool).

list_check_helpers lists every helper and matcher with its params and defaults (with `workspace`, the repo's own too). A team's own helper is a `defineHelper` file in `.dash/checks/helpers/`, built only from ctx and expect.

**Layer 2: recipes**: a check as JSON. It holds no code, so it's safe to keep on a bot, share and edit in a form:
```json
{
  "name": "the work is ready for review",
  "steps": [
    { "use": "git.committedSince", "with": { "base": "{repo.baseBranch}" } },
    { "use": "node.testsPass", "with": { "command": "npm test" } },
    { "expect": "handoff.files", "matcher": "toHaveLengthAtLeast", "args": [1],
      "message": "The handoff lists no changed files" }
  ]
}
```
- `use` names a helper and `with` holds its params; `{team settings}`, `{item.*}` and `{repo.*}` are filled in from the job.
- `expect` names a value by path (handoff.files, item.id, env.DASH_BRANCH), with a `matcher`, its `args`, and `"not": true` for the opposite.
- `when` skips a step unless a value is truthy (a path, or "{mergeWhenGreen}"; "!" turns it around). `message` replaces a step's failure text.

**Code: a `.check.js` file**, for what a recipe can't say:
```js
const { check, expect } = require("@trops/dash-check");
const { git, node } = require("@trops/dash-check/helpers");

check("the work is ready for review", async (ctx) => {
  await git.committedSince(ctx, { base: ctx.row.repo?.baseBranch || "main" });
  await node.testsPass(ctx);
  if (expect(ctx.handoff.tests, "handoff.tests").toBeArray("The handoff has no tests list")) {
    for (const t of ctx.handoff.tests) expect(t.file, t.acceptance).toBeNonEmptyString(`No test file for: ${t.acceptance}`);
  }
});
```

**Which to use:** a built-in kind (git-on-branch, git-committed, pr-ci, handoff-has) when one fits; else one helper as a step (kind "helper", e.g. git.changesMatchPlan); else a recipe; else a `.check.js` file; a plain executable (sh, python) only for a repo whose CI is already a script.

## 3. The contract (every file check)
- It runs in the job's **workspace** (the repo the bot works in): cwd is that folder.
- **Input:** the run as JSON, in the file named by `$DASH_INPUT` and on stdin (a `.check.js` file has it as ctx):
  - `.input.answer`: the bot's whole answer (its handoff is the last ```json block);
  - `.item`: the job's work item { id, title, url, source };
  - `.workspace`: { dir, branch };
  - `.handedOn`: { from, handoff }, the handoff the bot was handed by the bot before it in the job (when it was).
- **Environment:** DASH_INPUT, DASH_ITEM_ID, DASH_ITEM_TITLE, DASH_ITEM_URL, DASH_ITEM_SOURCE, DASH_WORKSPACE, DASH_BRANCH, DASH_STEP (the step's name), DASH_TEST ("1" in a team's self-test, where outward actions such as comments and pushes were skipped; also input.test), and DASH_TOOL_SOCKET (what answers ctx.tool). With a GitHub provider on the bot: GH_TOKEN, and git signed in. Never print the token.
- **Result:** exit 0 passes; anything else fails. To say why, print one JSON line last: `{"reason": "…", "details": {…}}`. The reason shows on the job and goes back to the bot. A `.check.js` file and a recipe do this for you, with each check's and each step's result in details.
- **Time:** 2 minutes unless the step sets timeoutSec (up to 30). Don't sleep-poll for long: a check that waits (for CI) has a deadline and says what it waited for.
- **Settings:** a step can give a check inputs ({ kind: "repo", name: "note-has-section", inputs: { heading: "Plan" } }); the check gets each as DASH_CHECK_<NAME> (DASH_CHECK_HEADING). Read them with a default, so the check works without them.
- **No work item?** A check that needs item.id (DASH_ITEM_ID) should say so and fail when it's run on a job without one. But `dash-check --ci` runs every check with no item and an empty answer: a check that can't decide anything without one can exit 0 with {"reason": "No work item: nothing to check"} when DASH_ITEM_ID is empty, or be left out of the --ci list.
- **Nothing to do:** print `{"reason": "…", "handOn": false}` and exit 0 to end the job quietly (better: the bot says "status": "none" in its handoff).

## 4. Where a check lives
- **In the repo (best):** `.dash/checks/<name>.check.json` (a recipe), `.dash/checks/<name>.check.js` (code), or a plain executable with any extension (validate.sh, lint.py). A step uses it by name: { kind: "repo", name: "validate" } finds validate.check.js, validate.check.json or validate.sh. Dash reads it, and `.dash/checks/helpers/`, from the repo's **base branch**, so the bot's own branch can't change the check that judges it. It's reviewed like code, and runs the same commands as the repo's CI.
- **How it runs:** a `.check.js` file in its own node, with the library's runner; a `.check.json` recipe in Dash, with the library's helpers (in its own node when it uses the repo's own); anything else by its #! line, else by extension: .js .cjs .mjs with node, .sh with bash, .py with python3, anything else with sh.
- **On the bot (a team copy):** a recipe step, { kind: "recipe", recipe: { name, steps } }. It's checked when the bot is saved and travels with a published team. It uses the library's helpers only: a repo's own helpers need a `.check.json` in the repo.
- **One helper on the bot:** { kind: "helper", use: "git.changesMatchPlan", with: { planKeys: "files, tests" }, handoffFrom: "handed" }: a one-step recipe, checked when saved. handoffFrom "handed" reads the handoff the bot was handed (the Planner's, for a Coder) instead of its own; that handoff is also in a check's input as .handedOn { from, handoff }.
- **A package** (shared, in the registry, or vendored): a folder `.dash/checks/<name>/` with a check.json manifest and its file (section 6).
- **Built in:** git-on-branch, git-committed, pr-ci and handoff-has need no file (get_setup_guide("bots") §5). They run on the same helpers.

## 5. Templates

**A recipe** (`.dash/checks/plan-complete.check.json`): read the handoff.
```json
{
  "name": "the plan is complete",
  "steps": [
    { "use": "plan.hasSections", "with": { "key": "plan", "sections": ["cause", "fix", "test"] } },
    { "use": "handoff.eachHas", "with": { "list": "tests", "keys": ["acceptance", "file"] } }
  ]
}
```

**A helper of your own** (`.dash/checks/helpers/changelog.js`): a block a recipe can `use`.
```js
const { defineHelper, expect, note } = require("@trops/dash-check");

module.exports = defineHelper({
  id: "team.changelogUpdated",
  group: "Your helpers",
  label: "Changelog updated",
  sentence: "{file} changed since {base}",
  params: {
    file: { type: "path", label: "Changelog", default: "CHANGELOG.md" },
    base: { type: "text", label: "Base branch", default: "{repo.baseBranch}" },
  },
  reads: ["git"],
  async run(ctx, { file, base }) {
    const ref = `origin/${base || (await ctx.git.defaultBranch()) || "main"}`;
    expect(await ctx.git.changedFiles(ref), `files changed since ${ref}`).toContain(file, `${file} isn't updated: add a line for ${ctx.item.id || "this change"}`);
    note(`${file} is updated`);
  },
});
```

**sh** (`.dash/checks/validate.sh`): run the repo's own CI commands.
```sh
#!/usr/bin/env bash
set -u
out=$(npm test 2>&1) || {
  echo "$out" | tail -20
  echo '{"reason": "npm test failed: see the output above"}'
  exit 1
}
echo '{"reason": "npm test passed"}'
```

**plain node** (`.dash/checks/plan-complete.js`), without the library:
```js
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.env.DASH_INPUT, "utf8"));
const answer = String((input.input && input.input.answer) || "");
const blocks = [...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
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
```

**python** (`.dash/checks/changelog.py`): look at the work.
```python
import json, os, subprocess, sys
base = "origin/main"
changed = subprocess.run(["git", "diff", "--name-only", base + "...HEAD"], capture_output=True, text=True).stdout.split()
if changed and "CHANGELOG.md" not in changed:
    print(json.dumps({"reason": "CHANGELOG.md isn't updated: add a line for " + os.environ.get("DASH_ITEM_ID", "this change")}))
    sys.exit(1)
print(json.dumps({"reason": "CHANGELOG.md is updated"}))
```

**A tool check** (no file: a read-only provider tool, then rules on its answer). In a step: { kind: "tool", server: "Atlassian MCP", tool: "getJiraIssue", args: { issueIdOrKey: "{item.id}" }, answerRules: [...] }. In a recipe or a `.check.js` file, the tracker helpers and ctx.tool do the same. As a package, its check.json says the provider type it needs (section 6), so the same check works for anyone with that kind of provider.

## 6. The check.json manifest (a check package)
```json
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
```
- **kind "file":** "run" names the file in the folder; it follows the contract above. Its inputs reach it as DASH_CHECK_<NAME> (DASH_CHECK_SECTIONS) and as .check.inputs in $DASH_INPUT.
- **kind "tool":** no file; "tool": { "type": "jira", "tool": "getJiraIssue", "args": { "issueIdOrKey": "{item.id}" }, "answerRules": [...] }, and "needs": { "provider": "jira" }. Trackers share inputs ({item.id}), so jira-ticket-exists, github-issue-exists and linear-issue-exists swap for each other.
- **inputs** are declared like team settings (name, label, type, default). A step fills them, and can use {team settings}, {item.*} and {workspace.*}.
- **needs:** the commands it runs, or the provider type it calls. Installing shows them, with its source and author.

## 7. Try it by hand
In the repo, write a sample input to a file (the answer only matters to checks that read the handoff):
```json
{ "input": { "answer": "Done." }, "item": { "id": "DASH-1" }, "workspace": { "dir": ".", "branch": "fix/DASH-1" } }
```
Then:
```sh
npx -p @trops/dash-core dash-check new ready --recipe   # a recipe and its sample input
npx -p @trops/dash-core dash-check validate --input sample.json
DASH_CHECK_HEADING=Goal npx -p @trops/dash-core dash-check note-has-section --input sample.json
npx -p @trops/dash-core dash-check --list
npx -p @trops/dash-core dash-check --list-helpers       # every helper and matcher
npx -p @trops/dash-core dash-check --explain .dash/checks/ready.check.json
npx -p @trops/dash-core dash-check --ci     # every check, as CI would
```
- dash-check is @trops/dash-check's CLI (`npx dash-check` works too in a repo that has it). It sets the same environment Dash does, DASH_ITEM_* from the sample's item included. It runs the workspace's copy (what you're editing); --base runs the base branch's, as Dash does, and needs a remote (origin/HEAD, origin/main or origin/master).
- With no --input, `<name>.sample.json` next to the check is used.
- A pass prints "✓ name: reason"; a fail prints the check's output, then "✗ name: reason". Exit code: 0 passed, 1 failed, 2 no such check or bad arguments.
- --ci runs every check (or --ci a,b those) with an empty answer and no item, so it suits checks that look at the repo (validate, lint), not ones about a job's work.
- In a step, name a check without its extension: { kind: "repo", name: "validate" } finds validate.check.js, validate.check.json or validate.sh.

Try it twice: once with an input that should pass, and once with one that should fail. The failure's reason must say what to fix.

## 8. Ship it
- **Repo check:** commit `.dash/checks/<name>.check.json` (or `.check.js`, or a script) in a PR. Once merged it's on the base branch, and every bot's { kind: "repo", name } step uses it. Run `dash-check --ci` in the repo's CI so the bots and CI agree.
- **Recipe on the bot:** a step { kind: "check", check: { kind: "recipe", recipe } } (update_bot or create_bot). It's validated when saved: a wrong helper id, param or matcher is refused, saying which.
- **Package:** a folder with check.json and its file. Vendor it into `.dash/checks/<name>/`, or publish it to the registry so any team can install it.
- **In a bot:** a step { kind: "repo", name: "<name>" }, with fallback or ifMissing: "skip" for repos that don't have it yet. check_team_setup tells you which repos are missing it.
