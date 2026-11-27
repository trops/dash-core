/**
 * selfTest.js — a team's self-test (DASH-109): the whole chain run against
 * a test item, with every outward action off.
 *
 * In a test job:
 *   - a provider tool that could change something (anything whose name
 *     doesn't read: comment, transition, merge, create…) isn't called: it's
 *     answered "Skipped in a test" and logged on the job, with what it
 *     would have sent;
 *   - shell commands that reach out (git push, gh pr create/merge/comment,
 *     gh issue, gh api, npm publish) are blocked;
 *   - the pr-ci check passes as skipped (there's no PR to wait for).
 *
 * A change to a team's bots or settings marks it "untested" until a test
 * job ends done.
 *
 * Pure.
 */
"use strict";

const { READ_NAME } = require("../checks/kinds/toolCall");

// Commands a test never runs: they reach outside this computer.
const TEST_BLOCKED = [
  "git push",
  "gh pr create",
  "gh pr merge",
  "gh pr comment",
  "gh pr close",
  "gh pr review",
  "gh issue",
  "gh api",
  "gh release",
  "npm publish",
];

const MAX_ARGS = 1500;

/** Is this provider tool one a test skips (it could change something)? */
function skipsInTest(toolName) {
  return !READ_NAME.test(String(toolName || ""));
}

/** The answer a skipped tool gets, and the job's note about it. */
function skippedAnswer(serverName, toolName, args) {
  let shown;
  try {
    shown = JSON.stringify(args == null ? {} : args);
  } catch (_e) {
    shown = "(unreadable)";
  }
  if (shown.length > MAX_ARGS) shown = `${shown.slice(0, MAX_ARGS)}…`;
  return {
    result: {
      text: `Skipped in a test: ${toolName} on ${serverName} wasn't called (it could change something). Carry on as if it worked, and say in your answer what you would have done.`,
      isError: false,
    },
    note: { server: serverName, tool: toolName, args: shown },
  };
}

/** A bot as it runs in a test: the outward commands blocked too. */
function withTestBlocks(bot) {
  if (!bot) return bot;
  const commands =
    (bot.commands && typeof bot.commands === "object" && bot.commands) || {};
  const blocked = Array.isArray(commands.blocked) ? commands.blocked : [];
  return {
    ...bot,
    commands: {
      ...commands,
      blocked: [
        ...blocked,
        ...TEST_BLOCKED.filter((c) => !blocked.includes(c)),
      ],
    },
  };
}

/** What the chain's first bot is told when a self-test starts. */
function testPrompt(item) {
  const it =
    item && item.id
      ? `${item.id}${item.title ? ` — ${item.title}` : ""}`
      : "the team's test item";
  return [
    `Self-test: work on ${it} as you normally would.`,
    "This is a test run of the whole team: anything that would change something outside this computer (comments, transitions, merges, pushes) is skipped and logged instead, so go ahead as usual.",
  ].join("\n");
}

/** A test item, cleaned: { id, title?, url?, source? } or null. */
function cleanTestItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim().slice(0, 200) : "";
  if (!id) return null;
  const str = (v, n) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
  return {
    id,
    ...(str(item.title, 300) ? { title: str(item.title, 300) } : {}),
    ...(str(item.url, 500) ? { url: str(item.url, 500) } : {}),
    ...(str(item.source, 40) ? { source: str(item.source, 40) } : {}),
  };
}

/** The "untested" marker a change sets: { since, what }. */
function untestedMark(what, now = new Date()) {
  return {
    since: now.toISOString(),
    what: String(what || "a change").slice(0, 200),
  };
}

const UNTESTED_NOTE =
  "This team has an untested change: run a self-test (test_team, or Test team on the team's page) to check the whole chain on its test item before real work.";

module.exports = {
  TEST_BLOCKED,
  skipsInTest,
  skippedAnswer,
  withTestBlocks,
  testPrompt,
  cleanTestItem,
  untestedMark,
  UNTESTED_NOTE,
};
