/**
 * BotRunner.js
 *
 * Executes a bot in the main process by driving the tool-loop engine (Slice 1)
 * with a fully-built RunContext (PRD FR-002 / US-002). One active run per bot;
 * streams normalized BotEvents to a caller-supplied `emit`; persists engine
 * session state (US-005) and appends a run record after every run; supports
 * abort.
 *
 * Portable (NFR-006): every Electron-coupled collaborator is injected —
 * provider/credential resolution, tool discovery, and MCP tool execution. The
 * only static dependency is the (portable) bot PermissionGate factory. The
 * Electron wiring lives in electron/controller/botController.js.
 *
 * Injected deps:
 *   engines            { getEngine(id) }                       — engine registry
 *   store              BotStore                                — get/saveSession/appendRun
 *   approvals          ApprovalRegistry                        — create(request)
 *   resolveRunProfile  async (bot) => { engineId, adapterId, baseURL, model, credentials, providerId }
 *   resolveTools       async (bot, runOpts) => { tools, resolveServer(toolName) => serverName|null }
 *   callTool           async (serverName, toolName, args, { workspaceId }) => { text, isError }
 *   audit?             (entry) => void
 *   now?               () => string (ISO)
 *   makeRequestPermission? / gate?  — test seams (default: real PermissionGate)
 */
"use strict";

const { createRequestPermission } = require("./PermissionGate");
const { truncateText } = require("./botEvents");
const { appendAnswerText } = require("./answerText");

const { MAX_ATTEMPTS, classifyError, retryDelay } = require("./retryPolicy");

const QUIT = Symbol("quit");

/** Wait `ms`, or less if the run is stopped meanwhile. */
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal) signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Two attempts' token usage added together (either may be null). Sums every
 * numeric field, so Claude Code's reportedUsd carries through (runCost's
 * addUsage keeps only the token counts).
 */
function sumUsage(a, b) {
  if (!b) return a || null;
  if (!a) return { ...b };
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = typeof v === "number" ? (out[k] || 0) + v : v;
  }
  return out;
}

/**
 * The engine's events — until Dash quits mid-run (US-018 AC6). Then stop
 * waiting for the engine to wind down: it can take longer than Dash has
 * left, and the run's record must be written before Dash exits. A run the
 * user stops still waits, so the engine can report what it used.
 */
async function* untilQuit(events, signal) {
  const it = events[Symbol.asyncIterator]();
  let onAbort = null;
  const quit = new Promise((resolve) => {
    if (signal.aborted) {
      if (signal.reason === "quit") resolve(QUIT);
      return;
    }
    onAbort = () => {
      if (signal.reason === "quit") resolve(QUIT);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    for (;;) {
      const next = it.next();
      // Lost the race to a quit: its later failure is nobody's concern.
      next.catch(() => {});
      const result = await Promise.race([next, quit]);
      if (result === QUIT || result.done) return;
      yield result.value;
    }
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (typeof it.return === "function") {
      Promise.resolve()
        .then(() => it.return())
        .catch(() => {});
    }
  }
}

class BotRunner {
  constructor(deps = {}) {
    for (const req of [
      "engines",
      "store",
      "approvals",
      "resolveRunProfile",
      "resolveTools",
      "callTool",
    ]) {
      if (!deps[req]) throw new Error(`BotRunner: missing dependency "${req}"`);
    }
    this._engines = deps.engines;
    this._store = deps.store;
    this._approvals = deps.approvals;
    this._resolveRunProfile = deps.resolveRunProfile;
    this._resolveTools = deps.resolveTools;
    this._callTool = deps.callTool;
    this._audit = deps.audit || (() => {});
    this._now = deps.now || (() => new Date().toISOString());
    this._makeRequestPermission =
      deps.makeRequestPermission || createRequestPermission;
    this._gate = deps.gate; // forwarded to PermissionGate ctx (optional)
    // Virtual servers whose tools are auto-allowed (e.g. "bot-memory") — the
    // bot's own sandbox, not external actions. Forwarded to the gate ctx.
    this._internalServers = deps.internalServers || [];
    this._isPaused = deps.isPaused || (() => false);
    // (botId) → reason string | null: a run that may not start at all (a
    // paused bot, CRE-011 AC3). Optional.
    this._startBlocker = deps.startBlocker || (() => null);
    // Called after each run with the run's token usage so budgets (Slice 5)
    // can accrue cost. Optional — default no-op keeps the runner portable.
    this._onUsage = deps.onUsage || null;
    // ({ providerId, model, usage }) → { usd, includedInPlan, estimated,
    // equivalentUsd } — the run's cost on its record (CRE-012).
    this._costOf = deps.costOf || null;
    // Retries (US-023): attempts and jitter source; `sleep(ms, signal)`
    // waits between attempts and ends early when the run is stopped.
    this._retry = {
      maxAttempts: MAX_ATTEMPTS,
      random: Math.random,
      ...(deps.retry || {}),
    };
    this._sleep = deps.sleep || abortableSleep;
    /** @type {Map<string, AbortController>} */
    this._active = new Map();
    /** @type {Map<string, string>} botId → ISO start of its in-flight run */
    this._startedAt = new Map();
  }

  isRunning(botId) {
    return this._active.has(botId);
  }

  listActive() {
    return [...this._active.keys()];
  }

  /** When the bot's in-flight run started (ISO), or null when idle. */
  startedAt(botId) {
    return this._startedAt.get(botId) || null;
  }

  /**
   * Abort an in-flight run. `reason` "quit" (Dash is quitting, US-018 AC6)
   * records it as "interrupted"; otherwise it was stopped by the user.
   * @returns {boolean} whether a run was aborted
   */
  abort(botId, reason) {
    const controller = this._active.get(botId);
    if (!controller) return false;
    controller.abort(reason === "quit" ? "quit" : "stop");
    return true;
  }

  /**
   * Run a bot to completion.
   * @param {string} botId
   * @param {{ prompt?: string, trigger?: string, emit?: (e: object) => void }} opts
   * @returns {Promise<object>} the appended run record (or a skip marker)
   */
  async run(botId, opts = {}) {
    const emit = typeof opts.emit === "function" ? opts.emit : () => {};

    if (this._active.has(botId)) {
      const skip = {
        botId,
        skipped: true,
        reason: "a run is already in progress",
      };
      emit({ type: "skipped", reason: skip.reason });
      return skip;
    }

    const bot = this._store.get(botId);
    if (!bot) throw new Error(`BotRunner.run: no bot "${botId}"`);

    const blocked = this._startBlocker(botId);
    if (blocked) {
      emit({ type: "skipped", reason: blocked });
      return { botId, skipped: true, reason: blocked };
    }

    const trigger = opts.trigger || "manual";
    // A run may override the bot's approval policy — the Dash team's runs
    // inside an approved plan build (the plan was the consent, CRE-003 AC3).
    const approvalPolicy = opts.approvalPolicy || bot.approvalPolicy;
    const startedAt = this._now();
    // Approval decisions made during this run, for the run record (Bots view
    // › Activity). Names only — never the tool's input.
    const approvalLog = [];
    const createApproval = (request) => {
      // The run it came from goes with it, for the audit log.
      const pending = this._approvals.create({
        ...request,
        runStartedAt: startedAt,
      });
      Promise.resolve(pending && pending.promise)
        .then((decision) => {
          approvalLog.push({
            tool: (request && request.toolName) || "tool",
            provider: (request && request.serverName) || null,
            decision:
              decision && decision.allow
                ? decision.remember
                  ? "allowed-always"
                  : "allowed"
                : "denied",
          });
        })
        .catch(() => {});
      return pending;
    };
    const controller = new AbortController();
    this._active.set(botId, controller);
    this._startedAt.set(botId, startedAt);

    let status = "completed";
    let usage = null;
    let errorMessage = null;
    let runProfile = null;
    // The run's answer (its text), kept on the run record — what a team lead
    // reads back. Capped to the last 8 KB; the store seals it at rest.
    let answer = "";
    let afterTool = false;
    // Tool-call summary for the conversation view: tool, provider, ok —
    // never arguments or results (they can hold email content).
    const toolCalls = [];
    const callIndex = new Map();
    let providerOf = () => null;
    let attempts = 0;

    try {
      const profile = await this._resolveRunProfile(bot);
      runProfile = profile;
      const engine = this._engines.getEngine(profile.engineId);
      if (!engine) {
        throw new Error(`no engine registered for "${profile.engineId}"`);
      }

      const {
        tools,
        resolveServer,
        // Virtual servers this run is configured with beyond the bot's
        // providers (the Dash team's build tools, CRE-011) — the gate asks
        // about their tools instead of refusing them as unconfigured.
        servers: extraServers = [],
      } = await this._resolveTools(bot, opts);
      providerOf = (name) => {
        try {
          return resolveServer(name) || null;
        } catch (_e) {
          return null;
        }
      };

      // Tools their server declares read-only (MCP readOnlyHint, or the
      // catalog's readOnlyTools) — the gate runs these without a prompt
      // unless the bot asks before every tool.
      const readOnly = new Set(
        (tools || [])
          .filter(
            (t) => t && t.annotations && t.annotations.readOnlyHint === true,
          )
          .map((t) => t.name),
      );
      const requestPermission = this._makeRequestPermission({
        botId,
        workspaceId: bot.workspaceId,
        allowedTools: bot.allowedTools || [],
        mcpServers: [...(bot.mcpServers || []), ...extraServers],
        internalServers: this._internalServers,
        resolveServer,
        createApproval,
        approvalPolicy,
        isReadOnly: (toolName) => readOnly.has(toolName),
        // Read-only tools that ran without asking show in the run's
        // approvals too, so the user can see what ran.
        audit: (entry) => {
          if (entry && entry.outcome === "read-only") {
            approvalLog.push({
              tool: entry.toolName || "tool",
              provider: entry.serverName || null,
              decision: "read-only",
            });
          }
          this._audit({ ...entry, runStartedAt: startedAt });
        },
        isPaused: () => this._isPaused(botId),
        gate: this._gate,
      });

      const executeTool = async (toolName, input) => {
        const serverName = resolveServer(toolName);
        if (!serverName) {
          return {
            text: `No MCP server for tool "${toolName}".`,
            isError: true,
          };
        }
        return this._callTool(serverName, toolName, input, {
          workspaceId: bot.workspaceId,
          // Lets the caller apply this bot's per-provider tool limits.
          botId,
          // A Dash team run inside a Create plan: its memory (4e-1).
          ...(opts.planId ? { planId: opts.planId } : {}),
        });
      };

      // A run does the bot's job against current data → fresh conversation.
      // Resume only when explicitly continuing (reply-to-continue) AND the
      // stored session was produced by this engine. Anything a bot should
      // carry between runs belongs in its memory tools.
      const session =
        opts.continueSession && bot.session && bot.session.engine === engine.id
          ? bot.session.state
          : null;

      const ctx = {
        botId,
        prompt: opts.prompt,
        model: profile.model,
        credentials: profile.credentials,
        adapterId: profile.adapterId,
        baseURL: profile.baseURL,
        systemPrompt: bot.instructions,
        tools,
        session,
        maxTurns: bot.maxTurns,
        signal: controller.signal,
        requestPermission,
        executeTool,
        workspaceId: bot.workspaceId,
        // For engines with their own agent loop + native tools (claude-agent):
        // a sandbox dir, the approval policy, and a direct approval channel.
        workingDir: profile.workingDir,
        approvalPolicy,
        createApproval,
      };
      // Engine built-ins this bot may use: a team lead gets none (bot-teams
      // TEAM-002 AC4); Dash team roles get what their job needs (CRE-011) —
      // the run profile says which.
      if (bot.role === "lead") ctx.builtinTools = "none";
      else if (profile.builtinTools) ctx.builtinTools = profile.builtinTools;

      // Attempts (US-023 AC1): a run that fails on temporary trouble — before
      // it used any tool — is tried again after a growing wait. An attempt's
      // error is held back until we know it's final.
      for (;;) {
        attempts++;
        let failure = null;
        let usedTool = false;
        for await (const event of untilQuit(
          engine.run(ctx),
          controller.signal,
        )) {
          if (event.type === "error") {
            failure = event;
            // A failed attempt still used tokens.
            if (event.usage) usage = sumUsage(usage, event.usage);
            continue;
          }
          emit(event);
          if (event.type === "text" && event.text) {
            answer = appendAnswerText(answer, event.text, { afterTool });
            afterTool = false;
          }
          if (event.type === "tool_call") {
            afterTool = true;
            usedTool = true;
          }
          if (event.type === "tool_call" && event.name) {
            // Bridged tools arrive as "mcp__bot-mcp__<tool>" on the agent engine.
            const tool = String(event.name).replace(
              /^mcp__[^_]+(?:-[^_]+)*__/,
              "",
            );
            callIndex.set(event.id, toolCalls.length);
            toolCalls.push({ tool, provider: providerOf(tool), ok: null });
          } else if (event.type === "tool_result" && callIndex.has(event.id)) {
            toolCalls[callIndex.get(event.id)].ok = !event.isError;
          }
          if (event.type === "session") {
            this._store.saveSession(botId, engine.id, event.session);
          } else if (event.type === "done") {
            usage = sumUsage(usage, event.usage);
          }
        }
        if (!failure || controller.signal.aborted) break;

        const { transient, label } = classifyError(failure);
        const blocked = transient ? this._startBlocker(botId) : null;
        const retry =
          transient &&
          !usedTool &&
          !blocked &&
          attempts < this._retry.maxAttempts;
        if (!retry) {
          status = "failed";
          errorMessage = failure.message || "The run failed";
          if (transient && usedTool) {
            errorMessage += " — not retried: it had already used tools";
          } else if (transient && blocked) {
            errorMessage += ` — not retried: ${blocked}`;
          } else if (transient && attempts > 1) {
            errorMessage += ` (gave up after ${attempts} attempts)`;
          }
          emit({ ...failure, message: errorMessage });
          break;
        }
        const delayMs = retryDelay(
          attempts,
          failure.retryAfterMs,
          this._retry.random,
        );
        // The next attempt starts the answer over.
        answer = "";
        afterTool = false;
        emit({
          type: "retrying",
          reason: label,
          attempt: attempts + 1,
          of: this._retry.maxAttempts,
          delayMs,
          message: failure.message || "",
        });
        await this._sleep(delayMs, controller.signal);
        if (controller.signal.aborted) break;
      }
    } catch (err) {
      status = "failed";
      errorMessage = err.message || String(err);
      emit({
        type: "error",
        message: errorMessage,
        code: err.code || "RUNNER_ERROR",
      });
    } finally {
      this._active.delete(botId);
      this._startedAt.delete(botId);
    }
    // Stopped by the user (abort): neither completed nor failed — even when
    // the engine threw on its way out. Stopped because Dash quit:
    // "interrupted" (US-018 AC6).
    if (controller.signal.aborted) {
      status = controller.signal.reason === "quit" ? "interrupted" : "stopped";
      errorMessage = null;
    }

    const runRecord = {
      trigger,
      status,
      startedAt,
      endedAt: this._now(),
      usage,
      // Which model ran it and what it cost (CRE-012 AC4/AC5).
      provider: runProfile ? runProfile.providerId : null,
      model: runProfile ? runProfile.model : null,
      cost:
        usage && runProfile && this._costOf
          ? this._costOf({
              providerId: runProfile.providerId,
              model: runProfile.model,
              usage,
            })
          : null,
      error: errorMessage,
      output: truncateText(answer),
      // The conversation turn (Bots view, TEAM-011). The store seals the
      // prompt at rest like the answer.
      prompt: truncateText(opts.prompt || ""),
      continued: !!opts.continueSession,
      toolCalls,
      approvals: approvalLog,
    };
    // Tried more than once (US-023): how many attempts it took.
    if (attempts > 1) runRecord.attempts = attempts;
    // What triggered an event run (event label, publishing bot, chain).
    if (opts.source) runRecord.source = opts.source;
    // Who asked, when not the user directly (e.g. "assistant" — TEAM-004).
    if (opts.via) runRecord.via = opts.via;
    this._store.appendRun(botId, runRecord);

    // Feed usage to budgets (Slice 5). Optional hook; only when we captured
    // usage and know which provider/model produced it.
    if (usage && runProfile && this._onUsage) {
      this._onUsage({
        botId,
        workspaceId: bot.workspaceId,
        providerId: runProfile.providerId,
        model: runProfile.model,
        usage,
      });
    }

    return runRecord;
  }
}

module.exports = BotRunner;
