/**
 * Static wiring pins for the Bots view backend (bot-teams TEAM-011 / B1): run
 * history over IPC, and replies that continue a bot's conversation. The
 * controller needs Electron, so — like other controller pins — these check
 * the source for the load-bearing guarantees.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "botApi.js"),
  "utf8",
);
const events = require("../events/botEvents");

describe("botController — Bots view backend", () => {
  it("run() can continue the bot's conversation (reply to continue)", () => {
    assert.match(
      ctrl,
      /run\(botId, prompt, \{ continueConversation = false, planId = null \} = \{\}\)/,
    );
    // The options themselves are tested in userRun.test.js.
    assert.match(
      ctrl,
      /userRunOptions\(this\._store\.get\(botId\), \{[\s\S]*?continueConversation,\s*planId: inPlan \? planId : null,/,
    );
  });

  it("getRuns() returns the bot's latest runs (decrypted by the store)", () => {
    assert.match(ctrl, /getRuns\(botId, \{ limit = 50 \} = \{\}\)/);
    assert.match(ctrl, /this\._store\.getRuns\(botId\)/);
  });

  it("listRecentRuns() merges every bot's runs via the decrypting store (B3)", () => {
    assert.match(ctrl, /require\("\.\.\/bots\/recentRuns"\)/);
    assert.match(ctrl, /listRecentRuns\(\{ limit = 10 \} = \{\}\)/);
    assert.match(
      ctrl,
      /recentRuns\(\{\s*bots: this\._activeBots\(\),\s*getRuns: \(id\) => this\._store\.getRuns\(id\),/,
    );
  });

  it("lastRuns() gives each user bot's latest run — not the Dash team's (TEAM-015)", () => {
    assert.match(
      ctrl,
      /const \{ recentRuns, lastRuns \} = require\("\.\.\/bots\/recentRuns"\);/,
    );
    assert.match(
      ctrl,
      /lastRuns\(\) \{\s*return lastRuns\(\{\s*bots: this\.list\(\),/,
    );
  });

  it("listRunning() reports each run's start and dashboard (B3)", () => {
    assert.match(ctrl, /startedAt: this\._runner\.startedAt\(id\)/);
    assert.match(ctrl, /workspaceId:/);
  });
});

describe("botController — run sources (TEAM-011 gaps)", () => {
  it("event runs pass what triggered them through to the runner", () => {
    assert.match(ctrl, /source: sourceFromEvent\(bot, event\)/);
    assert.match(
      ctrl,
      /this\._runner\.run\(botId, \{[\s\S]{0,200}source: opts\.source \|\| null,/,
    );
  });
});

describe("botApi / events — Bots view IPC", () => {
  it("defines the run-history channel", () => {
    assert.equal(events.BOTS_GET_RUNS, "bots-get-runs");
  });

  it("defines and exposes the recent-runs channel (B3 monitor)", () => {
    assert.equal(events.BOTS_LIST_RECENT_RUNS, "bots-list-recent-runs");
    assert.match(
      api,
      /listRecentRuns: \(limit\) =>\s*ipcRenderer\.invoke\(BOTS_LIST_RECENT_RUNS, \{ limit \}\)/,
    );
  });

  it("defines and exposes the last-runs channel (TEAM-015)", () => {
    assert.equal(events.BOTS_LAST_RUNS, "bots-last-runs");
    assert.match(
      api,
      /lastRuns: \(\) => ipcRenderer\.invoke\(BOTS_LAST_RUNS\)/,
    );
  });

  it("exposes getRuns and run(…, { continueConversation })", () => {
    assert.match(api, /getRuns: \(botId, limit\) =>/);
    assert.match(
      api,
      /run: \(botId, prompt, continueConversation = false, opts = \{\}\) =>[\s\S]{0,120}continueConversation/,
    );
  });
});

describe("Bots changed broadcast (TEAM-011 refresh)", () => {
  it("defines the event and exposes onListChanged", () => {
    assert.equal(events.BOT_LIST_CHANGED, "bot-list-changed");
    assert.match(
      api,
      /onListChanged: \(callback\) => _addListener\(BOT_LIST_CHANGED, callback\)/,
    );
  });

  it("the controller broadcasts (coalesced) when bot definitions change", () => {
    assert.match(ctrl, /require\("\.\.\/bots\/coalesce"\)/);
    assert.match(
      ctrl,
      /this\._notifyListChanged = coalesce\(\(\) =>\s*this\._broadcast\(BOT_LIST_CHANGED, \{\}\),?\s*\)/,
    );
    assert.match(
      ctrl,
      /this\._offStoreChange = this\._store\.onChange\(\(\) =>\s*this\._notifyListChanged\(\),?\s*\)/,
    );
  });
});

describe("botController — memory context (private memory)", () => {
  it("passes the calling bot's id to the memory tools", () => {
    assert.match(
      ctrl,
      /handleMemoryTool\(\s*this\._memory,\s*\{\s*workspaceId: opts\.workspaceId,\s*botId: opts\.botId,\s*planId: opts\.planId \|\| null,\s*\},/,
    );
  });
});

describe("botController — delete clears private memory", () => {
  it("forgets the deleted bot's private memory", () => {
    assert.match(
      ctrl,
      /delete\(botId\) \{[\s\S]{0,1000}this\._memory\.forgetBot\(botId\)[\s\S]{0,200}return this\._store\.delete\(botId\);/,
    );
  });
});

describe("botController — asking a lead from the Assistant (TEAM-004)", () => {
  it("askLead takes `via` and _run forwards it to the runner", () => {
    assert.match(
      ctrl,
      /askLead\(botId, question, \{ continueConversation = false, via = null \} = \{\}\)/,
    );
    assert.match(ctrl, /continueSession: !!continueConversation,\s*via,/);
    assert.match(ctrl, /via: opts\.via \|\| null,/);
  });

  it("leadAvailability reports paused and over budget", () => {
    assert.match(
      ctrl,
      /leadAvailability\(botId\) \{[\s\S]{0,300}paused: this\._pause\.isPaused\(botId\)[\s\S]{0,200}overBudget: this\._budgets\.isOverBudget\(/,
    );
  });
});

describe("Lead drafts — removed (Phase 2c-2)", () => {
  it("no drafts store, hook, events or api", () => {
    assert.doesNotMatch(
      ctrl,
      /DraftStore|_proposeBot|listDrafts|dismissDraft|BOT_DRAFTS_CHANGED/,
    );
    assert.equal(events.BOTS_LIST_DRAFTS, undefined);
    assert.equal(events.BOTS_DISMISS_DRAFT, undefined);
    assert.equal(events.BOT_DRAFTS_CHANGED, undefined);
    assert.doesNotMatch(api, /listDrafts|dismissDraft|onDraftsChanged/);
  });
});

describe("botController — results (team-dashboards TD-001/TD-002)", () => {
  it("gives declared-result bots send_result, auto-allowed like memory", () => {
    assert.match(
      ctrl,
      /internalServers: \[\s*MEMORY_SERVER,\s*TEAM_SERVER,\s*RESULTS_SERVER,/,
    );
    assert.match(
      ctrl,
      /for \(const tool of resultToolsFor\(bot\)\) \{\s*tools\.push\(tool\);\s*toolServer\[tool\.name\] = RESULTS_SERVER;/,
    );
  });

  it("routes send_result to sendResult with the store and the bus", () => {
    assert.match(
      ctrl,
      /if \(serverName === RESULTS_SERVER\) \{[\s\S]{0,120}return sendResult\(\s*\{ store: this\._store, publisher: this\._events \},\s*opts\.botId,\s*args,/,
    );
  });

  it("serves the latest result by event type", () => {
    assert.match(
      ctrl,
      /getLatestResult\(eventType\) \{\s*return latestResult\(this\._store, eventType\);/,
    );
  });
});

describe("botApi / events — latest result IPC (TD-002)", () => {
  it("defines and exposes the latest-result channel", () => {
    assert.equal(events.BOTS_GET_LATEST_RESULT, "bots-get-latest-result");
    assert.match(
      api,
      /getLatestResult: \(eventType\) =>\s*ipcRenderer\.invoke\(BOTS_GET_LATEST_RESULT, \{ eventType \}\)/,
    );
  });
});

describe("botController — budgets stop runs (US-019)", () => {
  it("an over-budget bot doesn't start (it would still spend on the model)", () => {
    assert.match(
      ctrl,
      /return this\._budgets\.isOverBudget\(botId, bot\.workspaceId\)\s*\? "this bot is over its budget"/,
    );
  });
  it("budgetStatus covers user bots; keeping one running refreshes lists", () => {
    assert.match(
      ctrl,
      /budgetStatus\(\) \{[\s\S]{0,200}for \(const bot of this\.list\(\)\)[\s\S]{0,120}this\._budgets\.botStatus\(bot\.id, bot\.workspaceId\)/,
    );
    assert.match(
      ctrl,
      /resumeOverBudget\(botId\);\s*\/\/ Lists showing "Over budget" refresh\.\s*this\._broadcast\(BOT_LIST_CHANGED, \{\}\);/,
    );
    assert.equal(events.BOTS_BUDGET_STATUS, "bots-budget-status");
    assert.match(
      api,
      /budgetStatus: \(\) => ipcRenderer\.invoke\(BOTS_BUDGET_STATUS\)/,
    );
  });
});

describe("botController — spending summary (US-019 slice B)", () => {
  it("summarizes this month for user bots and dashboards", () => {
    assert.match(
      ctrl,
      /const \{ summarizeSpending \} = require\("\.\.\/bots\/spending"\);/,
    );
    assert.match(
      ctrl,
      /spendingSummary\(\) \{[\s\S]{0,700}summarizeSpending\(\{[\s\S]{0,300}bots: this\.list\(\),/,
    );
    assert.equal(events.BOTS_SPENDING_SUMMARY, "bots-spending-summary");
    assert.match(
      api,
      /spendingSummary: \(\) => ipcRenderer\.invoke\(BOTS_SPENDING_SUMMARY\)/,
    );
  });
});

describe("botController — quitting with runs in progress (US-018 AC6)", () => {
  it("interruptAll stops every run as quit; whenIdle waits for them", () => {
    assert.match(
      ctrl,
      /interruptAll\(\{ timeoutMs = 5000 \} = \{\}\) \{[\s\S]{0,120}return interruptAllRuns\(/,
    );
    assert.match(
      ctrl,
      /whenIdle\(\{ timeoutMs = null \} = \{\}\) \{\s+return waitUntilIdle\(/,
    );
  });
});

describe("botController — saved audit log (US-003 AC5, US-014 AC9, US-019 AC6)", () => {
  it("gives the log to the gate (via the runner), pause and budgets", () => {
    assert.match(ctrl, /createAuditLog\(\{ file: host\.paths\.auditLog \}\)/);
    assert.match(
      ctrl,
      /new PauseController\(\{[\s\S]{0,250}audit: \(entry\) => this\._logAudit\(entry\),/,
    );
    assert.match(ctrl, /audit: \(entry\) => this\._logBudgetAudit\(entry\),/);
    assert.match(
      ctrl,
      /const logged = fromGateEntry\(entry\);\s+if \(logged\) this\._logAudit\(logged\);/,
    );
  });

  it("logs approvals where they're created, with how they were answered", () => {
    assert.match(
      ctrl,
      /this\._logAudit\(\{ type: "approval-asked", \.\.\.about \}\);/,
    );
    assert.match(
      ctrl,
      /type: "approval-allowed",\s+\.\.\.about,\s+always: !!decision\.remember,/,
    );
    assert.match(ctrl, /type: "approval-denied",/);
  });

  it("logs stop, quit, access and bots created or deleted", () => {
    for (const type of [
      "run-stopped",
      "runs-interrupted",
      "grant-saved",
      "grant-revoked",
      "bot-created",
      "bot-deleted",
    ]) {
      assert.match(ctrl, new RegExp(`type: "${type}"`), type);
    }
  });

  it("never logs per-run usage", () => {
    assert.doesNotMatch(ctrl, /type: "usage"/);
  });

  it("reads it over IPC", () => {
    assert.equal(events.BOTS_AUDIT_LOG, "bots-audit-log");
    assert.match(
      api,
      /auditLog: \(filters\) => ipcRenderer\.invoke\(BOTS_AUDIT_LOG, filters \|\| \{\}\)/,
    );
    assert.match(ctrl, /auditLog\(filters = \{\}\) \{/);
  });
});

describe("botController — events for paused bots (US-011 AC8)", () => {
  it("handleEvent keeps or skips events for held bots instead of dropping them", () => {
    assert.match(
      ctrl,
      /if \(this\._isHeld\(bot\.id\)\) \{\s+this\._holdEvent\(bot, event\);\s+continue;/,
    );
    assert.doesNotMatch(
      ctrl,
      /if \(this\._pause\.isPaused\(bot\.id\)\) continue;/,
    );
    assert.match(ctrl, /bot\.whilePaused === "drop"/);
    assert.match(ctrl, /this\._pausedQueue\.add\(bot\.id, event\.eventType,/);
  });

  it("held means paused or over budget", () => {
    assert.match(
      ctrl,
      /this\._pause\.isPaused\(botId\) \|\|\s+this\._budgets\.isOverBudget\(botId, bot\.workspaceId\)/,
    );
  });

  it("resuming runs what waited; deleting a bot drops its queue", () => {
    assert.match(
      ctrl,
      /this\._pause\.resumeBot\(botId\);\s+this\._drainQueued\(\[botId\]\);/,
    );
    assert.match(
      ctrl,
      /this\._pause\.resumeAll\(\);\s+this\._drainQueued\(\);/,
    );
    assert.match(
      ctrl,
      /resumeOverBudget\(botId\);[\s\S]{0,200}this\._drainQueued\(\[botId\]\);/,
    );
    assert.match(
      ctrl,
      /this\._pausedQueue\.clear\(botId\);[\s\S]{0,200}return this\._store\.delete\(botId\);/,
    );
    assert.match(ctrl, /queued: this\._pausedQueue\.counts\(\)/);
  });
});

describe("botController — bot notifications (US-019 AC3, US-018 AC5)", () => {
  it("takes the host's notify hook", () => {
    assert.match(ctrl, /notify = null,[\s\S]{0,200}\} = deps;/);
    assert.match(
      ctrl,
      /this\._notify = typeof notify === "function" \? notify : null;/,
    );
  });

  it("budget notices compare the status before and after the run's usage", () => {
    assert.match(
      ctrl,
      /const before = this\._budgets\.status\(u\.botId, u\.workspaceId\);\s+const r = this\._budgets\.recordUsage\(u\);\s+this\._sendNotice\(\s+budgetNotice\(\{/,
    );
  });

  it("a failed run notifies when it ends", () => {
    assert.match(
      ctrl,
      /this\._sendNotice\(failureNotice\(this\._store\.get\(botId\), record\)\);/,
    );
  });

  it("a notify failure never breaks the run", () => {
    assert.match(
      ctrl,
      /_sendNotice\(notice\) \{\s+if \(!notice \|\| !this\._notify\) return;\s+try \{/,
    );
  });
});

describe("botController — background-mode settings (US-018 AC1-AC4)", () => {
  it("setBotSettings takes background, startAtLogin and keepAwake as booleans", () => {
    for (const key of ["background", "startAtLogin", "keepAwake"]) {
      assert.match(
        ctrl,
        new RegExp(`if \\(${key} !== undefined\\) next\\.${key} = !!${key};`),
      );
    }
  });
});

describe("botController — opening a bot from a notification (US-018 AC5)", () => {
  it("keeps the request until a window takes it, and tells open windows", () => {
    assert.match(
      ctrl,
      /requestOpen\(botId = null\) \{\s+this\._openRequest = \{ botId: botId \? String\(botId\) : null \};\s+this\._broadcast\(BOT_OPEN_REQUEST, \{\}\);/,
    );
    assert.match(
      ctrl,
      /takeOpenRequest\(\) \{\s+const req = this\._openRequest \|\| null;\s+this\._openRequest = null;\s+return req;/,
    );
    assert.equal(events.BOTS_TAKE_OPEN_REQUEST, "bots-take-open-request");
    assert.equal(events.BOT_OPEN_REQUEST, "bot-open-request");
    assert.match(
      api,
      /takeOpenRequest: \(\) => ipcRenderer\.invoke\(BOTS_TAKE_OPEN_REQUEST\)/,
    );
    assert.match(
      api,
      /onOpenRequest: \(callback\) => _addListener\(BOT_OPEN_REQUEST, callback\)/,
    );
  });
});
