/**
 * trackerSetting.test.js — the "tracker" setting type (DASH-135) in the main
 * process: declared and saved on a bot, filled into its run in words (and
 * by part), and checked by Check setup (no project chosen, not connected,
 * no provider for it).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeBotSettings,
  normalizeBotSettings,
  withTeamValues,
  mergeTeamValues,
} = require("./teamValues");
const { settingProblems, preflight } = require("./preflight");
const { withBotSettings } = require("../../src/utils/botSettings");

const TICKETS = {
  name: "tickets",
  label: "Where tickets come from",
  type: "tracker",
  required: true,
};

const ticketBot = (value, extra = {}) => ({
  id: "bot_t",
  name: "Ticket Bot",
  workspaceId: "7",
  instructions:
    "Find the next ticket in {tickets}. Its project is {tickets.project}.",
  settings: [TICKETS],
  settingValues: value === undefined ? {} : { tickets: value },
  ...extra,
});

describe("declaring and saving a tracker", () => {
  it("is a setting type a bot (or a team) can declare", () => {
    const r = mergeBotSettings(null, {
      declare: [TICKETS],
      values: { tickets: { source: "github", project: "you/app" } },
    });
    assert.deepEqual(r.errors, []);
    assert.equal(r.settings[0].type, "tracker");
    assert.deepEqual(r.settingValues.tickets, {
      source: "github",
      project: "you/app",
      assignee: "anyone",
    });
    const t = mergeTeamValues(null, { declare: [TICKETS] });
    assert.deepEqual(t.errors, []);
  });
  it("refuses a value that isn't a ticket source", () => {
    const r = mergeBotSettings(
      { settings: [TICKETS] },
      { values: { tickets: { source: "trello" } } },
    );
    assert.match(r.errors[0], /source must be one of/);
    const n = normalizeBotSettings({
      settings: [TICKETS],
      settingValues: { tickets: "project = X" },
    });
    assert.match(n.errors[0], /ticket source/);
  });
  it("keeps None as a value", () => {
    const n = normalizeBotSettings({
      settings: [TICKETS],
      settingValues: { tickets: { source: "none" } },
    });
    assert.deepEqual(n.errors, []);
    assert.deepEqual(n.settingValues.tickets, { source: "none" });
  });
});

describe("a tracker in a bot's run", () => {
  it("fills {tickets} in words and {tickets.project} with its part", () => {
    const bot = ticketBot({
      source: "jira",
      project: "SANDBOX",
      status: "To Do",
      assignee: "anyone",
    });
    const { bot: out, missing } = withTeamValues(
      bot,
      withBotSettings(null, bot),
    );
    assert.deepEqual(missing, []);
    assert.match(out.instructions, /Jira: project SANDBOX, status "To Do"/);
    assert.match(out.instructions, /Search \(JQL\): project = "SANDBOX"/);
    assert.match(out.instructions, /Its project is SANDBOX\./);
  });
  it("None fills in too: the bot works from its task", () => {
    const bot = ticketBot({ source: "none" });
    const { bot: out, missing } = withTeamValues(
      bot,
      withBotSettings(null, bot),
    );
    assert.deepEqual(missing, []);
    assert.match(out.instructions, /work only on the task you're given/);
    assert.match(out.instructions, /Its project is \./);
  });
  it("an empty one stops the run, saying where to fill it in", () => {
    const bot = ticketBot({ source: "jira" });
    const { missing } = withTeamValues(bot, withBotSettings(null, bot));
    assert.equal(missing.length, 1);
    assert.equal(missing[0].name, "tickets");
    assert.equal(missing[0].owner, "bot");
  });
});

describe("Check setup and a tracker", () => {
  it("says no project is chosen", () => {
    const problems = settingProblems(ticketBot({ source: "jira" }), null, null);
    assert.equal(problems.length, 1);
    assert.equal(
      problems[0].message,
      "Ticket Bot: Where tickets come from is Jira, but no project is chosen: fill it in on its Settings tab",
    );
  });
  it("says when nothing is chosen at all", () => {
    const problems = settingProblems(ticketBot(), null, null);
    assert.match(problems[0].message, /has no ticket source chosen/);
  });
  it("reports a tracker that isn't connected, or that the bot has no provider for", async () => {
    const value = { source: "github", project: "you/app" };
    const off = await preflight(
      { bots: [ticketBot(value)] },
      { trackerStatus: () => ({ connected: false, granted: false }) },
    );
    assert.equal(off.ok, false);
    assert.equal(off.problems[0].kind, "tracker");
    assert.equal(off.problems[0].reason, "not-connected");
    assert.match(off.problems[0].message, /GitHub Issues isn't connected/);
    const ungranted = await preflight(
      { bots: [ticketBot(value)] },
      { trackerStatus: () => ({ connected: true, granted: false }) },
    );
    assert.equal(ungranted.problems[0].reason, "not-granted");
    const good = await preflight(
      { bots: [ticketBot(value)] },
      { trackerStatus: () => ({ connected: true, granted: true }) },
    );
    assert.equal(good.ok, true);
  });
  it("asks nothing about None", async () => {
    let asked = 0;
    const r = await preflight(
      { bots: [ticketBot({ source: "none" })] },
      {
        trackerStatus: () => {
          asked += 1;
          return { connected: false };
        },
      },
    );
    assert.equal(asked, 0);
    assert.equal(r.ok, true);
  });
});
