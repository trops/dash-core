/**
 * flowBotHooks.js
 *
 * What flows need from the bots (flowController.useBots), built from the
 * bot controller: run a step's bot, make and delete a flow's bots, call a
 * read-only tool for a check, say which bots act on the world, and the
 * simple graph of a dashboard with no flows (frame 21).
 */
"use strict";

const { isLead } = require("../bots/teamLeads");
const { isDashTeam } = require("../bots/dashTeam");
const { isOnTeam } = require("../bots/teams");
const { normalizeMcpResult } = require("../bots/mcpResult");
const { ensureBotServers } = require("../bots/toolSources");
const { READ_NAME } = require("../checks/kinds/toolCall");
const { readProposal } = require("./proposals");

// A tool whose name says it reaches outside: sends, posts, changes. (Wider
// than permissionGate's write pattern, which is about paths.)
const ACTS =
  /send|post|reply|create|update|edit|delete|remove|merge|publish|write|comment|push|pay|transfer|invite|share|upload|append|move|rename|mkdir|chmod/i;
const isWriteTool = (name) => ACTS.test(String(name || ""));
const ACTING_TYPES = ["gmail", "slack"];

// A run for a bot's checks job: its flow is `checks_<botId>`
// (botChecks.checksFlow), named in the run's `via`.
const finishesJob = (opts) =>
  /^flow:checks_/.test(String((opts && opts.via) || ""));

const DAYS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/** A schedule in a few words: "Every 15 min", "Daily 7:00", "Fridays 9:00". */
function cronText(cron) {
  const p = String(cron || "")
    .trim()
    .split(/\s+/);
  if (p.length !== 5) return "On a schedule";
  const [m, h, dom, mon, dow] = p;
  const every = /^\*\/(\d+)$/.exec(m);
  if (every && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${every[1]} min`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*") {
    const t = `${Number(h)}:${String(m).padStart(2, "0")}`;
    if (dow === "*") return `Daily ${t}`;
    if (/^\d$/.test(dow)) return `${DAYS[Number(dow) % 7]} ${t}`;
    if (dow === "1-5") return `Weekdays ${t}`;
  }
  return "On a schedule";
}

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
    getBot: (botId) => ctl._store.get(botId) || null,
    listBots: (workspaceId) =>
      ctl._store.list().filter((b) => isOnTeam(b, workspaceId)),
    saveBot: (def) => ctl.save(def),
    deleteBot: (botId) => ctl.delete(botId),
    resumeBot: (botId) => ctl.resumeBot(botId),
    providers: () =>
      providerList().map((p) => ({ name: p.name, type: p.type || null })),

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

    /** Does what this bot does reach outside Dash (send, post, change)? */
    actsOutward: (botId) => {
      const bot = ctl._store.get(botId);
      if (!bot) return false;
      const picked = Object.values(bot.toolSelections || {})
        .flat()
        .map(String);
      if (picked.some((n) => ACTS.test(n))) return true;
      const types = providerList()
        .filter((p) => (bot.mcpServers || []).includes(p.name))
        .map((p) => String(p.type || "").toLowerCase());
      return types.some(
        (t) => ACTING_TYPES.includes(t) && !(bot.toolSelections || {})[t],
      );
    },

    /**
     * A dashboard with no flows (frame 21): each of its bots with what it
     * reads and where its results show.
     */
    graphRows: (workspaceId) => {
      let ws = null;
      try {
        ws = ctl._loadWorkspace(workspaceId);
      } catch (_e) {
        ws = null;
      }
      const items = [];
      const walk = (list) => {
        for (const it of Array.isArray(list) ? list : []) {
          if (!it || typeof it !== "object") continue;
          if (it.component) items.push(it);
          walk(it.items);
          walk(it.layout);
        }
      };
      if (ws) {
        walk(ws.layout);
        for (const p of ws.pages || []) walk(p && p.layout);
        walk(ws.sidebarLayout);
      }
      return ctl._store
        .list()
        .filter((b) => isOnTeam(b, workspaceId) && !isLead(b) && !isDashTeam(b))
        .map((b) => {
          const sources = (b.mcpServers || []).filter(Boolean);
          const widget = items.find(
            (it) =>
              (it.userPrefs && it.userPrefs.botId === b.id) ||
              (it.prefs && it.prefs.botId === b.id),
          );
          const sched = (b.schedules || []).find((s) => s && s.cron);
          return {
            source: sources.length
              ? { name: sources.join(" + "), note: "Provider" }
              : { name: "What you ask", note: "When you ask" },
            bot: {
              id: b.id,
              name: b.name,
              note: sched ? cronText(sched.cron) : "When you ask",
            },
            widget: widget
              ? {
                  name: widget.title || widget.name || "Bot results",
                  note: "Shows its results",
                }
              : null,
          };
        });
    },

    /**
     * Ask the dashboard's lead to propose a flow (frames 22–23): its answer
     * carries the flow as JSON in <flow></flow>. Nothing is made.
     */
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

    proposeFlow: async (workspaceId, text, schemaNote) => {
      const lead = ctl._store
        .list()
        .find((b) => isLead(b) && isOnTeam(b, workspaceId));
      if (!lead) return { error: "This dashboard has no lead to ask." };
      const bots = ctl._store
        .list()
        .filter((b) => isOnTeam(b, workspaceId) && !isLead(b) && !isDashTeam(b))
        .map((b) => `- ${b.name} (id ${b.id})`)
        .join("\n");
      const providers = providerList()
        .map((p) => `- ${p.name}${p.type ? ` (${p.type})` : ""}`)
        .join("\n");
      const prompt = [
        `The user wants a flow on this dashboard: "${String(text || "").slice(0, 2000)}"`,
        "",
        "Propose it. A flow is the steps a piece of work goes through: a source that starts goals (on a schedule or from tickets/notes), AI steps that do the work, checks with no AI that prove it (rules, a command, a script, or a read-only tool call), and the user where a person must approve. Every AI step is checked by something; a check only reads; the user approves before anything goes out.",
        "",
        `The team's bots now:\n${bots || "- (none)"}`,
        `Connected providers:\n${providers || "- (none)"}`,
        "",
        schemaNote,
        "",
        "Answer in two or three plain sentences, then the flow as JSON inside <flow></flow>, with no code fence. Use an existing bot with botId when it already does a step; otherwise describe a new bot with `bot`. Make nothing yourself.",
      ].join("\n");
      const record = await ctl._run(lead.id, {
        prompt,
        trigger: "ask",
        via: "flow-proposal",
      });
      if (!record || record.skipped) {
        return {
          error: (record && record.reason) || "The lead didn't answer.",
        };
      }
      const answer = String(record.output || "");
      const proposal = readProposal(answer);
      return proposal
        ? {
            proposal,
            text: answer.replace(/<flow>[\s\S]*?<\/flow>/i, "").trim(),
          }
        : {
            error:
              "The lead answered without a flow. Try saying what it should do in more detail.",
            text: answer,
          };
    },
  };
}

module.exports = { flowBotHooks, cronText, finishesJob };
