/**
 * flowBotHooks.js
 *
 * What a bot's checks need from the bots (flowController.useBots), built
 * from the bot controller: run a job's bot or reviewer, find a bot, call a
 * read-only tool for a check, and have the lead write a script check.
 */
"use strict";

const { isLead } = require("../bots/teamLeads");
const { isOnTeam } = require("../bots/teams");
const { normalizeMcpResult } = require("../bots/mcpResult");
const { ensureBotServers } = require("../bots/toolSources");
const { READ_NAME } = require("../checks/kinds/toolCall");

// A tool whose name says it reaches outside: sends, posts, changes. (Wider
// than permissionGate's write pattern, which is about paths.)
const ACTS =
  /send|post|reply|create|update|edit|delete|remove|merge|publish|write|comment|push|pay|transfer|invite|share|upload|append|move|rename|mkdir|chmod/i;
const isWriteTool = (name) => ACTS.test(String(name || ""));

// A run for a bot's checks job: its flow is `checks_<botId>`
// (botChecks.checksFlow), named in the run's `via`.
const finishesJob = (opts) =>
  /^flow:checks_/.test(String((opts && opts.via) || ""));

function flowBotHooks(ctl) {
  const win = () => ctl._getMainWindow();
  const providerList = () => {
    try {
      const { providers = [] } =
        ctl._providers.listProviders(win(), ctl._appId) || {};
      return providers.filter(Boolean);
    } catch (_e) {
      return [];
    }
  };
  const toolDefs = (server) => {
    const live = ctl._connectedServers().find((c) => c.serverName === server);
    return live && Array.isArray(live.tools) ? live.tools : null;
  };
  const isReadOnlyTool = (server, tool) => {
    const defs = toolDefs(server);
    const def = defs ? defs.find((t) => t && t.name === tool) : null;
    const a = (def && def.annotations) || {};
    if (a.readOnlyHint === true) return true;
    if (a.readOnlyHint === false || a.destructiveHint === true) return false;
    return (
      READ_NAME.test(String(tool)) &&
      !isWriteTool(tool) &&
      !ACTS.test(String(tool))
    );
  };
  const startServer = async (server, workspaceId) => {
    if (!ctl._mcp || !ctl._mcp.startServer || !ctl._providers) return;
    await ensureBotServers({
      bot: { id: "flow-check", mcpServers: [server], workspaceId },
      connected: ctl._connectedServers(),
      getProvider: async (name) =>
        ctl._providers.getProvider(win(), ctl._appId, name),
      startServer: (name, mcpConfig, credentials, ws) =>
        ctl._mcp.startServer(
          win(),
          name,
          mcpConfig,
          credentials,
          ws,
          null,
          ctl._appId,
        ),
    });
  };

  return {
    runBot: (botId, opts = {}) => {
      const run = () =>
        ctl._run(botId, {
          prompt: opts.prompt,
          trigger: opts.trigger || "flow",
          via: opts.via || null,
          goal: opts.goal || null,
          ...(opts.workingDir ? { workingDir: opts.workingDir } : {}),
          ...(opts.limits ? { limits: opts.limits } : {}),
        });
      // A bot's checks job (its own retries, a reviewer's verdict) finishes
      // work already started, so a paused bot still does it — like a run
      // the user starts (only its own pause, not the bots it asks). Pause
      // all still stops it (DASH-12).
      return finishesJob(opts) && ctl._asJobRun
        ? ctl._asJobRun(botId, run)
        : run();
    },
    isBusy: (botId) => ctl._runner.listActive().includes(botId),
    // As it runs: its team's settings filled in (DASH-57).
    // `ctx.goalId`: a check's goal — filled from that goal's job (DASH-100),
    // so a {repo.*} or {workspace.*} folder is the job's.
    getBot: (botId, ctx = null) => {
      const jobId =
        ctx && ctx.goalId && ctl._jobs && ctl._jobs.jobForGoal
          ? ctl._jobs.jobForGoal(ctx.goalId)
          : null;
      return (
        (ctl.resolvedBot
          ? ctl.resolvedBot(botId, jobId ? { jobId } : null)
          : ctl._store.get(botId)) || null
      );
    },
    // The work item and workspace of a check's job (DASH-100), or null.
    jobContext: (goalId) => {
      if (!ctl._jobs || !ctl._jobs.jobForGoal || !ctl._jobs.contextOf) {
        return null;
      }
      const jobId = ctl._jobs.jobForGoal(goalId);
      return jobId ? ctl._jobs.contextOf(jobId) : null;
    },
    // The bot's GitHub sign-in for its command checks (DASH-66), or null.
    // Never logged.
    gitToken: async (botId) => {
      const bot = ctl._store.get(botId);
      if (!bot || !ctl._gitTokenFor) return null;
      return ctl._gitTokenFor(bot);
    },
    listBots: (workspaceId) =>
      ctl._store.list().filter((b) => isOnTeam(b, workspaceId)),

    /** A check's tool call: the provider started if needed, never a write. */
    callTool: async (server, tool, args, workspaceId = null) => {
      if (!isReadOnlyTool(server, tool)) {
        return { isError: true, text: `${tool} could change something.` };
      }
      await startServer(server, workspaceId);
      const result = await ctl._mcp.callTool(
        win(),
        server,
        tool,
        args,
        null,
        null,
        workspaceId || null,
        null,
      );
      return normalizeMcpResult(result);
    },
    isReadOnlyTool,
    // Check packages (DASH-106): one by ref, and a provider of a type.
    getCheckPackage: (ref) =>
      ctl.getCheckPackage ? ctl.getCheckPackage(ref) : null,
    serverForType: (botId, type) =>
      ctl.serverForType ? ctl.serverForType(botId, type) : null,

    /** Per provider, the tools a tool call check may use. */
    readOnlyTools: async (workspaceId) => {
      const out = [];
      for (const p of providerList()) {
        if (!p.mcpConfig) continue;
        try {
          await startServer(p.name, workspaceId);
        } catch (_e) {
          // Listed as not connected below.
        }
        const defs = toolDefs(p.name);
        out.push({
          server: p.name,
          type: p.type || null,
          connected: !!defs,
          tools: (defs || [])
            .filter((t) => t && isReadOnlyTool(p.name, t.name))
            .map((t) => ({
              name: t.name,
              description: String(t.description || "").slice(0, 200),
              params: Object.keys(
                (t.inputSchema && t.inputSchema.properties) || {},
              ),
            })),
        });
      }
      return out;
    },

    /** A script check's function, written by the dashboard's lead. */
    writeScript: async (workspaceId, ask, fields) => {
      const lead = ctl._store
        .list()
        .find((b) => isLead(b) && isOnTeam(b, workspaceId));
      if (!lead) return { error: "This dashboard has no lead to ask." };
      const list = (Array.isArray(fields) ? fields : [])
        .slice(0, 60)
        .map((f) => `- ${f.path} (${f.kind}): ${f.sample}`)
        .join("\n");
      const prompt = [
        `Write a JavaScript check: ${String(ask).slice(0, 1000)}`,
        "",
        "It's one function, `function check({ goal, input, from, files }) { … }`, that returns { pass: true|false, reason: one short sentence, details: anything that helps (a list of what's missing) }.",
        "It runs sealed off: no require, no fetch, no files, no process — only plain JavaScript on the fields it gets:",
        list || "- (no fields yet)",
        "",
        "Answer with the code only, inside <script></script>, with no code fence.",
      ].join("\n");
      const record = await ctl._run(lead.id, {
        prompt,
        trigger: "ask",
        via: "flow-script",
      });
      if (!record || record.skipped) {
        return {
          error: (record && record.reason) || "The lead didn't answer.",
        };
      }
      const m = /<script>([\s\S]*?)<\/script>/i.exec(
        String(record.output || ""),
      );
      return m
        ? {
            script: m[1]
              .trim()
              .replace(/^```(?:js|javascript)?\s*|\s*```$/g, ""),
          }
        : { error: "The lead answered without a script." };
    },
  };
}

module.exports = { flowBotHooks, finishesJob };
