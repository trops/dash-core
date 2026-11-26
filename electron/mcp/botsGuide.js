/**
 * botsGuide.js: get_setup_guide({ topic: "bots" }) (DASH-80).
 *
 * How to build a team of bots that works, for an AI doing it over MCP.
 * The tool descriptions say what each field is; this says how the parts fit,
 * with what building the Code Factory taught (DASH-51, DASH-58).
 */
"use strict";

const BOTS_GUIDE = `# How to Build a Team of Bots

A team is a dashboard with bots on it. Bots do work with their AI model, their built-in tools and their providers' tools. They hand work to each other, and checks hold each bot's work until it's right. Look first: list_teams, list_bots and list_providers show what's there.

## 1. Plan the team before making bots
- One bot, one job, with one clear answer. "Take a ticket", "plan it", "code it", "open the PR" work better than one bot that does everything.
- Decide where work starts: a schedule (cron), a widget event, the team's lead (give_task), or the user.
- Decide what each bot hands to the next, and write it down as a JSON shape. Bots read the previous bot's answer, so a fixed shape is what makes a chain reliable.
- Decide what "right" means for each bot's work. That becomes its checks.

## 2. Roles
- **Lead**: talks to the user and gives work to its members. give_task reaches a team through its lead, and only when the lead's "Takes tasks via MCP" is on (the lead's Settings tab in Dash; the user turns it on).
- **Members**: do the work. A member that starts from a schedule or another bot needs no lead to run.

## 3. Chains: subscriptions
A bot starts when another bot on its team finishes: subscriptions [{ bot: "Planner", event: "completed" }]. Use "failed" to start a bot that reports or cleans up when something breaks (e.g. one Reporter subscribed to every bot's failed).
- The whole chain, started by a schedule, a trigger or a lead, is one job in Dash's Jobs view.
- A bot that's still busy when work reaches it waits in a queue and runs next. Nothing is dropped.
- A "failed" event says what broke and what the bot was working on: the error, the input the failed bot was given (the answer handed to it, so the ticket's key is in its JSON) and the job's picked table rows (e.g. repo). Tell the Reporter to take the ticket from that input, and if it can't find one, to say so rather than guess from a search.

## 4. Answers that hand on
End every answer with one \`\`\`json block, last: the **handoff**. Dash reads every answer one way: the whole answer when it's JSON, else its last \`\`\`json block (picks, the work item and the checks all read it like this). Say so in the instructions with the exact keys.

**Turn on the standard handoff** for a team whose bots hand work on (set_team_settings usesHandoffs: true, or "Standard handoff" on the team's page). Then:
- A few keys are Dash's: **status** ("ok", the default; "none"; "ask"; "split"), **item**, **workspace**, **question** (with ask), **items** (with split: the new items' ids, or { id, title }), **summary** (one line for the job and the next bot), and each table's pick ("repo"). Everything else is the bot's own data for the next bot (the Planner adds files, steps, tests).
- Dash handles the statuses, so no bot needs a check for them. **none**: nothing to do (an empty queue): the job ends quietly and nothing is handed on. **ask**: the bot needs a person: the job waits with its question; the user's answer goes back to the same bot, which goes on, or the user closes it and its failed event carries the question. **split**: the work became other items: the job ends saying "Split into …" and nothing is handed on.
- **Dash's Handoff check** runs first, before the bot's own checks: the block parses, the status is known, item.id is the job's, and workspace.dir is inside the bot's folders. A wrong one goes back to the bot with exactly what's wrong.
- The next bot is told the job's work item, workspace and picks, the bot before's summary, and its own data (marked untrusted), instead of the raw event. So bots never copy key, dir or branch forward: write instructions that use {item.id} and {workspace.dir}, and have each bot add only what's new.

Without it, the next bot gets the raw event (the answer as text), so have each bot copy forward the keys later bots need.

**What the job is about, and where its files are.** A job carries a **work item** and a **workspace**, so no bot has to copy them forward:
- **item**: { id, title?, url?, source? }: the one ticket, note or issue the job is about ("DASH-93", "Projects/Spool.md", "trops/app#12"). The task can name it (give_task's item), or the first bot that knows names it in its last json block: "item": { "id": "DASH-93", "title": "...", "url": "...", "source": "jira" }. Once set, its id never changes for that job.
- **workspace**: { dir, branch? }: the folder the job's work is in, named the same way ("workspace": { "dir": "~/DashFactory/DASH-93", "branch": "fix/DASH-93-..." }) by the bot that makes it. It must be inside that bot's folders.
- Every later bot uses {item.id}, {item.title}, {item.url}, {item.source}, {workspace.dir} and {workspace.branch} in its instructions, folders and checks; Dash fills them in from the job. A bot that uses one before the job has it fails saying so.
- Its completed and failed events carry item and jobId, so a bot that reports (the Reporter) comments on {item.id} and never searches for the ticket.

## 5. Checks: gates that don't trust the AI's word
checks: { steps, onFail, maxTries, handsOn }. The bot's answer is held until every step passes, then handed on. handsOn is "answer" (the default) or "summary" (its first paragraph).
- **check, kind "command"**: a shell command, run in the job's workspace when it has one, else the bot's first folder. It gets the run as JSON in $DASH_INPUT (and on stdin): the answer is at .input.answer, and the job's item and workspace at .item and .workspace. Its environment has DASH_ITEM_ID, DASH_ITEM_TITLE, DASH_ITEM_URL, DASH_ITEM_SOURCE, DASH_WORKSPACE and DASH_BRANCH. Exit 0 passes. Make the last line of output {"reason": "..."} to say why; that line shows on the job.
- **check, kind "script"**: function check(input) { return { pass, reason } } in a sealed runner. Use it for checks on the answer itself (keys present, a list not empty).
- **check, kind "rules"** and **"tool"**: ready-made rules, or a read-only provider tool.
- **reviewer**: another bot on the team judges the work. Give it read-only tools; it reads files and says pass or fail item by item.
- **you**: waits for the user to approve.
- onFail: "retry" sends the work back to the bot with what failed (up to maxTries), then to the user. "stop" ends it and sends "failed" (your Reporter runs). "you" asks the user at once. Use retry where the bot can fix it (tests, review); use stop where it can't (CI on a PR).
- when: a step that runs only when a team setting says so, e.g. { kind: "you", name: "Approve the plan", when: "{approvePlans}" }. Dash fills it in each run and leaves the step out when it reads no, so plan approval turns on and off from Team settings.
- **Nothing to do:** with the standard handoff, the bot says "status": "none". Without it, when there's no work (an empty queue on a schedule), the check returns pass with handOn false: a script returns { pass: true, handOn: false, reason }, a command prints {"reason": "...", "handOn": false} last and exits 0. The run ends quietly: no completed event, nothing downstream runs, no job is kept.

Anything code can decide belongs in a check, not in the instructions: "tests pass", "the branch exists", "CI is green", "the folder is gone".

## 6. Team settings, not hard-coded values
Repo URLs, branches, folders, commands, queries and yes/no switches go in team settings (set_team_settings). Bots use them as {name} in instructions, check commands, folders and schedule prompts. The user sees them as one form on the team's page, and they travel when the team is published (values don't), so someone else can install the team and only fill in the form. Tokens are never settings: they belong in a provider.

A team that works on several repos (or apps, or stores) keeps them in a **table** setting: type "table" with columns (e.g. url, baseBranch, setupCmd, validateCmd), one row per repo, each with a key ("dash-core"). Bots use {repo.url}, {repo.validateCmd} and {repo.key}. Each job uses one row: the first bot that knows which (a ticket bot or planner) names it in its answer's last json block ("repo": "dash-core"), and every later run and check in that job is filled from that row. The answer only names a row, so a ticket's text never becomes a command. A bot that uses {repo.*} before any bot in its job picked a row fails saying so: put the picking bot first in the chain.

## 7. Safety: approvals, folders, tools
- approvalPolicy: "ask", "ask-every", "allow" or "unattended". Unattended never waits for anyone, so it needs folders: inside them everything runs, outside them is refused.
- projects (folders): give each bot only the folder it works in, e.g. "{workRoot}".
- builtinTools: "none", "read-only" or "all". Reviewers and planners only need read-only.
- Provider tools: name each tool the bot needs, by its real name on that provider. Names differ between providers that do the same thing (connectors especially), and an unknown name is refused, with suggestions. list_bots shows what a bot has.

## 8. Lessons from building the Code Factory
- **Don't make a bot wait.** The engine blocks long \`sleep\` commands, and a bot polling for minutes burns tokens. Let the bot start the thing (open the PR) and let a command check do the waiting, with a deadline.
- **Checks get the bot's GitHub sign-in.** A command check of a bot with a GitHub provider has GH_TOKEN and git signed in. Use curl -w '%{http_code}' and fail with the HTTP code: a check that treats an error as "still pending" waits until it times out instead of saying why.
- **Edit files with Write or Edit, not shell heredocs.** The folder fence reads anything like an absolute path in a shell command, and code in a heredoc (a /** comment) can be refused as outside the bot's folders.
- **Repo rules belong in the repo.** Point the validate command at the repo's own CI script, so a failure goes back to the coding bot to fix. Rules that depend on other PRs (like the version number) belong in the repo's release workflow, not in a PR.
- **The setup step should leave the work tree clean.** If installing creates files (a lockfile), commit them to the repo, or the coding bot commits them with its change.
- **Test with a sandbox first.** A small repo and a query that only matches test tickets, before pointing the team at real work.

## 9. Saving
create_bot, update_bot and set_team_settings usually wait for confirm_bot: show the user the whole summary and ask for their task passphrase. Never guess or reuse one. update_bot's checks and providers replace the whole list, so send all of them.`;

module.exports = { BOTS_GUIDE };
