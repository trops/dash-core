/**
 * auditText — how the bots' audit log reads (bot-factory US-003 AC5).
 */
import { auditKindLabel, auditSentence, auditWhen } from "./auditText";

const bot = { botId: "b1", botName: "Writer" };
const tool = { ...bot, tool: "send_email", provider: "Gmail" };

test("approvals", () => {
  expect(auditSentence({ type: "approval-asked", ...tool })).toBe(
    "Writer asked to use send_email on Gmail",
  );
  expect(auditSentence({ type: "approval-allowed", ...tool })).toBe(
    "Allowed Writer to use send_email on Gmail",
  );
  expect(
    auditSentence({ type: "approval-allowed", ...tool, always: true }),
  ).toBe("Always allowed Writer to use send_email on Gmail");
  expect(
    auditSentence({
      type: "approval-denied",
      ...tool,
      reason: "approval denied",
    }),
  ).toBe("Denied Writer the use of send_email on Gmail");
  expect(
    auditSentence({
      type: "approval-denied",
      ...tool,
      reason: "denied by user",
    }),
  ).toBe("Denied Writer the use of send_email on Gmail");
  expect(
    auditSentence({ type: "approval-denied", ...tool, reason: "run stopped" }),
  ).toBe("Didn't let Writer use send_email on Gmail — run stopped");
  // Built-in tools have no provider.
  expect(
    auditSentence({
      type: "approval-asked",
      ...bot,
      tool: "Write",
      provider: null,
    }),
  ).toBe("Writer asked to use Write");
});

test("ran or refused without asking", () => {
  expect(
    auditSentence({ type: "ran-read-only", ...tool, tool: "search_emails" }),
  ).toBe("Writer ran read-only search_emails on Gmail without asking");
  expect(auditSentence({ type: "ran-granted", ...tool })).toBe(
    "Writer used send_email on Gmail without asking — it's always allowed",
  );
  expect(auditSentence({ type: "ran-policy", ...tool })).toMatch(
    /Allow without prompting$/,
  );
  expect(auditSentence({ type: "refused-paused", ...tool })).toBe(
    "Refused send_email on Gmail for Writer — the bot is paused",
  );
  expect(auditSentence({ type: "refused-unconfigured", ...tool })).toMatch(
    /isn't on one of the bot's providers$/,
  );
});

test("access, pause and stop", () => {
  expect(auditSentence({ type: "grant-saved", ...tool })).toBe(
    "Writer can now use send_email on Gmail without asking",
  );
  expect(auditSentence({ type: "grant-revoked", ...tool })).toBe(
    "Writer has to ask before using send_email on Gmail again",
  );
  expect(auditSentence({ type: "pause-bot", ...bot })).toBe("Paused Writer");
  expect(auditSentence({ type: "resume-all" })).toBe("Resumed all bots");
  expect(auditSentence({ type: "run-stopped", ...bot })).toBe(
    "Stopped Writer's run",
  );
  expect(
    auditSentence({ type: "run-stopped", botId: "b", botName: "Inbox Bots" }),
  ).toBe("Stopped Inbox Bots' run");
  expect(
    auditSentence({ type: "runs-interrupted", count: 2, botNames: ["A", "B"] }),
  ).toBe("Stopped 2 runs when Dash quit (A, B)");
});

test("budgets", () => {
  expect(
    auditSentence({ type: "budget-set", scope: "bot", monthlyUsd: 5, ...bot }),
  ).toBe("Set Writer's monthly limit to $5.00");
  expect(
    auditSentence({
      type: "budget-set",
      scope: "bot",
      monthlyUsd: null,
      ...bot,
    }),
  ).toBe("Removed Writer's monthly limit");
  expect(
    auditSentence({
      type: "budget-set",
      scope: "workspace",
      monthlyUsd: 20,
      dashboardName: "Sales",
    }),
  ).toBe("Set the Sales dashboard's monthly limit to $20.00");
  expect(
    auditSentence({ type: "budget-set", scope: "global", monthlyUsd: 50 }),
  ).toBe("Set the overall monthly limit to $50.00");
  expect(
    auditSentence({
      type: "budget-override",
      ...bot,
      budgetUsd: 5,
      budgetScope: "bot",
    }),
  ).toBe("Kept Writer running this month over its $5.00 budget");
  expect(
    auditSentence({
      type: "budget-override",
      ...bot,
      budgetUsd: 20,
      budgetScope: "workspace",
    }),
  ).toBe("Kept Writer running this month over its dashboard's $20.00 budget");
});

test("bots, and a bot that's gone", () => {
  expect(auditSentence({ type: "pause-bot", botId: "x" })).toBe("Paused a bot");
  expect(auditSentence({ type: "approval-asked", botId: "x", tool: "t" })).toBe(
    "A bot asked to use t",
  );
  expect(auditSentence({ type: "bot-created", ...bot })).toBe("Created Writer");
  expect(auditSentence({ type: "bot-deleted", botId: "x" })).toBe(
    "Deleted a bot",
  );
});

test("kind labels and when", () => {
  expect(auditKindLabel("auto")).toBe("Ran without asking");
  expect(auditKindLabel("nope")).toBe("");
  expect(auditWhen({ at: "2026-10-15T12:00:00.000Z" })).toBe(
    new Date("2026-10-15T12:00:00.000Z").toLocaleString(),
  );
  expect(
    auditWhen({
      at: "2026-10-15T12:00:00.000Z",
      runStartedAt: "2026-10-15T11:58:00.000Z",
    }),
  ).toMatch(/ · run started /);
});
