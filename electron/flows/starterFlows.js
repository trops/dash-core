/**
 * starterFlows.js
 *
 * Ready-made flows to start from (flows PRD, frame 22): Ticket to PR;
 * Draft, check, send; Daily brief; Blank. Each is a proposal — the same
 * shape the Dash Lead proposes (frame 23) — that becomes a flow, and makes
 * its bots, only when the user says "Make this flow".
 *
 *   proposal { name, brief, maxRounds,
 *              steps: [ { key, kind, name, note, bot?, botId?, check?,
 *                         outputs?, judgment?, action? } ],
 *              edges: [ { from: key, to: key, kind, label } ],
 *              needs: { providers: [ { label, anyOf: [types] } ], folder } }
 *
 * `bot` on a step is a bot to make: its name, instructions and schedule.
 * Wording is generic: Dash is for anyone.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const field = (name, kind, required = true) => ({ name, kind, required });

const TICKET_TO_PR = {
  id: "ticket-to-pr",
  name: "Ticket to PR",
  summary: "Ticket reader → Builder → CI check → Reviewer → You",
  brief: "from your tickets, label auto",
  maxRounds: 3,
  needs: {
    providers: [
      {
        label: "Your tickets (GitHub Issues, Jira or Linear)",
        anyOf: ["github", "jira", "linear", "atlassian"],
      },
      { label: "GitHub, for pull requests and CI", anyOf: ["github"] },
    ],
    folder: true,
  },
  steps: [
    {
      key: "reader",
      kind: "source",
      name: "Ticket reader",
      note: "Every 15 minutes, finds tickets labelled auto and starts a goal with each ticket's criteria, locked.",
      bot: {
        name: "Ticket reader",
        instructions:
          'Find open tickets labelled "auto" that don\'t have a goal yet. For each one, call create_goal with the ticket\'s title, its text as the body, source {kind: "ticket", ref: its id or link, label: its key}, its acceptance criteria as criteria, and output {key, title, body, owner, repo, url} (owner and repo: the GitHub repository the change goes in). Only read tickets: change nothing.',
        schedules: [{ cron: "*/15 * * * *" }],
      },
      outputs: [
        field("key", "text"),
        field("title", "text"),
        field("body", "text"),
        field("owner", "text"),
        field("repo", "text"),
        field("url", "text", false),
      ],
    },
    {
      key: "builder",
      kind: "bot",
      name: "Builder",
      note: "Plans and builds the change in its own copy of the repo, runs the tests, and opens a pull request. Force push and publishing are blocked.",
      bot: {
        name: "Builder",
        instructions:
          "Build what the ticket asks in the work folder you're given: make the change, add or update tests that prove each criterion (each must fail before the change and pass after), run the project's checks, commit on a new branch, push it and open a pull request. Never push to the main branch, force push or publish. Record the branch, the commit, the pull request number and link, and the checks' exit code.",
        commands: {
          // Only the git it needs: all of git can run anything (aliases,
          // hooks, -c options).
          allowed: [
            "git status",
            "git diff",
            "git log",
            "git add",
            "git commit",
            "git checkout -b",
            "git switch -c",
            "git push -u origin",
            "git fetch",
            "npm run ci",
            "npm test",
            "npm install",
            "gh pr create",
            "gh pr view",
            "gh pr checks",
          ],
          blocked: [],
        },
      },
      outputs: [
        field("branch", "text"),
        field("commit", "text"),
        field("pr", "number"),
        field("prUrl", "text"),
        field("checksExit", "number", false),
      ],
    },
    {
      key: "ci",
      kind: "check",
      name: "GitHub CI",
      note: "Passes only if CI passed for the Builder's commit.",
      check: {
        kind: "tool",
        server: null,
        tool: "get_pull_request_status",
        args: {
          owner: { field: "from.ticketReader.owner" },
          repo: { field: "from.ticketReader.repo" },
          pullNumber: { field: "input.pr" },
        },
        answerRules: [
          { path: "state", op: "equals", value: "success" },
          { path: "sha", op: "equals", ref: "input.commit" },
        ],
      },
    },
    {
      key: "reviewer",
      kind: "bot",
      name: "Reviewer",
      judgment: true,
      note: "Read-only. Passes when every criterion has proof: a test, a screenshot or a CI line.",
      bot: {
        name: "Reviewer",
        instructions:
          "Review the pull request against the goal's criteria. Read the diff and the checks; change nothing. Pass only when every criterion has proof (a test that covers it, a screenshot, a CI line). Otherwise fail with a fix list, one line per thing to fix.",
        readOnly: true,
        commands: {
          allowed: [
            "git diff",
            "git log",
            "git show",
            "gh pr view",
            "gh pr diff",
            "gh pr checks",
          ],
          blocked: ["git commit", "git push", "npm publish"],
        },
      },
      outputs: [field("verdict", "text"), field("proof", "list")],
    },
    {
      key: "you",
      kind: "you",
      name: "You",
      note: "Merge the PR from Needs you.",
      action: "Merge the PR",
    },
  ],
  edges: [
    { from: "reader", to: "builder", kind: "next", label: "new" },
    { from: "builder", to: "ci", kind: "next", label: "built" },
    { from: "ci", to: "reviewer", kind: "next", label: "passed" },
    { from: "reviewer", to: "you", kind: "next", label: "ready" },
    { from: "ci", to: "builder", kind: "fail", label: "CI failed → fix list" },
    { from: "reviewer", to: "builder", kind: "fail", label: "Review fix list" },
  ],
};

const DRAFT_CHECK_SEND = {
  id: "draft-check-send",
  name: "Draft, check, send",
  summary: "Reader → Writer → Rules check → You approve → Sender",
  brief: "weekly, from your notes",
  maxRounds: 3,
  needs: {
    providers: [
      {
        label: "Where your notes are (Notion, Google Drive or a folder)",
        anyOf: ["notion", "google-drive", "filesystem"],
      },
      { label: "Where it's sent (email or Slack)", anyOf: ["gmail", "slack"] },
    ],
    folder: false,
  },
  steps: [
    {
      key: "reader",
      kind: "source",
      name: "Notes reader",
      note: "Every Friday, collects the notes tagged for the newsletter and starts a goal.",
      bot: {
        name: "Notes reader",
        instructions:
          "Collect this week's notes tagged \"newsletter\". Call create_goal titled with this week's date, with output {notes: [{title, text, url}]}. Only read: change nothing.",
        schedules: [{ cron: "0 9 * * 5" }],
      },
      outputs: [field("notes", "list")],
    },
    {
      key: "writer",
      kind: "bot",
      name: "Writer",
      note: "Writes the draft from the notes.",
      bot: {
        name: "Writer",
        instructions:
          "Write the newsletter from the notes you're given: use every note, keep links working, 400 to 900 words. Record the text, a subject line and every link you used.",
      },
      outputs: [
        field("text", "text"),
        field("subject", "text"),
        field("links", "links"),
        field("wordCount", "number", false),
      ],
    },
    {
      key: "check",
      kind: "check",
      name: "Draft check",
      note: "Links work · length · no banned words · every note used",
      check: {
        kind: "rules",
        rules: [
          { type: "linksWork", field: "input.links", on: true },
          { type: "words", field: "input.text", min: 400, max: 900, on: true },
          { type: "banned", field: "input.text", words: [], on: true },
          {
            type: "everyIncluded",
            list: "from.notesReader.notes",
            key: "title",
            in: "input.text",
            on: true,
          },
          { type: "maxLength", field: "input.subject", max: 60, on: false },
        ],
      },
    },
    {
      key: "you",
      kind: "you",
      name: "You approve",
      note: "Read the draft and approve the send.",
      action: "Approve the send",
    },
    {
      key: "sender",
      kind: "bot",
      name: "Sender",
      note: "Sends the approved draft.",
      bot: {
        name: "Sender",
        instructions:
          "Send the approved draft (its subject and text) to the list you're set up for. Send it once. Record where it went and how many it reached.",
        acts: true,
      },
      outputs: [field("sentTo", "text"), field("count", "number", false)],
    },
  ],
  edges: [
    { from: "reader", to: "writer", kind: "next", label: "notes" },
    { from: "writer", to: "check", kind: "next", label: "draft" },
    { from: "check", to: "you", kind: "next", label: "passed" },
    { from: "you", to: "sender", kind: "next", label: "approved" },
    { from: "check", to: "writer", kind: "fail", label: "failed → fix list" },
  ],
};

const DAILY_BRIEF = {
  id: "daily-brief",
  name: "Daily brief",
  summary: 'Calendar + email → Writer → "All events in it" check',
  brief: "daily 7:00",
  maxRounds: 3,
  needs: {
    providers: [
      { label: "Your calendar", anyOf: ["google-calendar"] },
      { label: "Your email", anyOf: ["gmail"] },
    ],
    folder: false,
  },
  steps: [
    {
      key: "source",
      kind: "source",
      name: "Calendar + email",
      note: "Daily 7:00: today's events and new mail.",
      bot: {
        name: "Calendar + email",
        instructions:
          "Read today's calendar events and the email that came in since yesterday morning. Call create_goal titled \"Brief for\" and today's date, with output {events: [{id, title, start}], emails: [{id, from, subject}]}. Only read: change nothing.",
        schedules: [{ cron: "0 7 * * *" }],
      },
      outputs: [field("events", "list"), field("emails", "list")],
    },
    {
      key: "writer",
      kind: "bot",
      name: "Brief writer",
      note: "Writes the morning brief.",
      bot: {
        name: "Brief writer",
        instructions:
          "Write a short morning brief from today's events and new email: what's on, what needs a reply. Mention every event. Record the brief's text and the id of every event you put in it.",
      },
      outputs: [field("text", "text"), field("eventIds", "list")],
    },
    {
      key: "check",
      kind: "check",
      name: "All events in it",
      note: "Compares event ids with the calendar.",
      check: {
        kind: "rules",
        rules: [
          {
            type: "everyIncluded",
            list: "from.calendarEmail.events",
            key: "id",
            in: "input.eventIds",
            on: true,
          },
          { type: "required", field: "input.text", on: true },
        ],
      },
    },
    {
      key: "you",
      kind: "you",
      name: "You",
      note: "Read it on the dashboard.",
      action: "Read it",
    },
  ],
  edges: [
    { from: "source", to: "writer", kind: "next", label: "items" },
    { from: "writer", to: "check", kind: "next", label: "brief" },
    { from: "check", to: "you", kind: "next", label: "passed" },
    {
      from: "check",
      to: "writer",
      kind: "fail",
      label: "missing events → fix list",
    },
  ],
};

const BLANK = {
  id: "blank",
  name: "Blank",
  summary: "Start with one step and add from there",
  brief: "",
  maxRounds: 3,
  needs: { providers: [], folder: false },
  steps: [
    {
      key: "step",
      kind: "bot",
      name: "First step",
      note: "Choose the bot that does this step.",
    },
    {
      key: "you",
      kind: "you",
      name: "You",
      note: "Look at the result.",
      action: "Approve",
    },
  ],
  edges: [{ from: "step", to: "you", kind: "next", label: "" }],
};

const STARTERS = [TICKET_TO_PR, DRAFT_CHECK_SEND, DAILY_BRIEF, BLANK];

/** The starters, as the New flow screen lists them. */
function listStarters() {
  return STARTERS.map((s) => ({ id: s.id, name: s.name, summary: s.summary }));
}

/** A starter as a proposal (a fresh copy to change). */
function starterProposal(id) {
  const s = STARTERS.find((x) => x.id === id);
  return s ? JSON.parse(JSON.stringify(s)) : null;
}

module.exports = { STARTERS, listStarters, starterProposal };
