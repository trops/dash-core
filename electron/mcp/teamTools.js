/**
 * teamTools.js — the AI Assistant talks to team leads (bot-teams TEAM-004).
 *
 * Dash MCP tools:
 *   list_teams      — dashboards with a team (lead or bots): name, bot count,
 *                     whether it has a lead, last activity.
 *   ask_team_lead   — run a dashboard's lead with a question and return its
 *                     answer, labelled with the team. Recorded on the lead's
 *                     run as "via the AI Assistant".
 *
 * A paused or over-budget lead returns that status instead of an answer; a
 * question that fans out to many teams is capped (5 leads per 2 minutes).
 * Handlers take their dependencies so they're testable without Electron.
 */
"use strict";

const {
  summarizeTeams,
  resolveDashboard,
  AskCap,
} = require("../bots/teamDirectory");

const CAP_LIMIT = 5;

const TEAM_TOOLS = [
  {
    name: "list_teams",
    description:
      "List the user's bot teams: each dashboard that has a team lead or bots, with its name, id, number of bots, whether it has a lead, and when the team last ran. Use this before ask_team_lead, and to answer questions like 'what teams do I have?'.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ask_team_lead",
    description: `Ask a dashboard's team lead a question about its team (what its bots did, found, or failed at) and get the lead's answer. 'dashboard' is the dashboard's name or id from list_teams. Each call is a real run of the lead, so ask only the teams the question is about; for a question about all teams, ask each lead once, at most ${CAP_LIMIT} per question. Relay the answer and say which team it came from.`,
    inputSchema: {
      type: "object",
      properties: {
        dashboard: {
          type: "string",
          description: "The dashboard's name or id (from list_teams).",
        },
        question: {
          type: "string",
          description: "The question for the team lead.",
        },
      },
      required: ["dashboard", "question"],
    },
  },
];

const reply = (text, isError = false) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

const sameId = (a, b) =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);

/**
 * @param {{ getWorkspaces: () => object[],
 *           bots: { list, getRuns, leadAvailability, askLead },
 *           cap?: AskCap }} deps
 */
function makeTeamToolHandlers({
  getWorkspaces,
  bots,
  cap = new AskCap({ limit: CAP_LIMIT }),
}) {
  const lastRunAt = (botId) => {
    try {
      const runs = bots.getRuns(botId, { limit: 1 }) || [];
      const last = runs[runs.length - 1];
      return (last && (last.endedAt || last.at || last.startedAt)) || null;
    } catch (_e) {
      return null;
    }
  };

  return {
    async list_teams() {
      const teams = summarizeTeams({
        workspaces: getWorkspaces(),
        bots: bots.list(),
        lastRunAt,
      });
      return reply(
        JSON.stringify({
          teams,
          note: teams.length
            ? "Ask a team's lead with ask_team_lead(dashboard, question)."
            : "No dashboard has a team yet. Bots are added in a dashboard's Bots view.",
        }),
      );
    },

    async ask_team_lead(args = {}) {
      const question = String((args && args.question) || "").trim();
      if (!question) return reply("ask_team_lead needs a 'question'.", true);

      const workspaces = getWorkspaces();
      const found = resolveDashboard(workspaces, args.dashboard);
      if (found.none) {
        const teams = summarizeTeams({
          workspaces,
          bots: bots.list(),
          lastRunAt,
        });
        return reply(
          `No dashboard matches "${args.dashboard || ""}". Teams: ${
            teams.map((t) => `${t.name} (id ${t.id})`).join(", ") || "none yet"
          }.`,
        );
      }
      if (found.ambiguous) {
        return reply(
          `Several dashboards match "${args.dashboard}": ${found.ambiguous
            .map((w) => `${w.name} (id ${w.id})`)
            .join(", ")}. Ask the user which one, then call again with its id.`,
        );
      }
      const ws = found.match;
      const name = ws.name || "Untitled";
      const lead = bots
        .list()
        .find((b) => b.role === "lead" && sameId(b.workspaceId, ws.id));
      if (!lead) {
        return reply(
          `${name} has no team lead. The user can turn one on in that dashboard's Bots view (the Dashboard | Bots switch next to its name → "Team lead is off · Turn on").`,
        );
      }
      const avail = bots.leadAvailability(lead.id) || {};
      if (avail.paused) {
        return reply(
          `${name}'s team lead is paused, so it can't answer. The user can resume it in the dashboard's Bots view.`,
        );
      }
      if (avail.overBudget) {
        return reply(
          `${name}'s team lead is over its budget, so it can't answer right now. The user can raise the budget in Settings › Bots.`,
        );
      }
      if (!cap.take()) {
        return reply(
          `Already asked ${capLimitOf(cap)} team leads in the last couple of minutes — each ask is a real run. Summarize what you have, or ask the user before asking more.`,
        );
      }

      const askedAt = Date.now();

      const result = await bots.askLead(lead.id, question, {
        via: "assistant",
      });
      if (result && result.skipped) {
        return reply(
          `${name}'s team lead is busy answering another question. Try again in a moment.`,
        );
      }
      if (!result || result.status === "failed" || result.error) {
        return reply(
          `${name}'s team lead couldn't answer: ${
            (result && result.error) || "unknown error"
          }`,
        );
      }
      // A draft the lead made during this ask (propose_bot, TEAM-005).
      const drafts = (
        bots.listDrafts ? bots.listDrafts(ws.id) || [] : []
      ).filter(
        (d) =>
          d.leadId === lead.id && Date.parse(d.createdAt) >= askedAt - 1000,
      );
      const draftNote = drafts.length
        ? "\n\n" +
          drafts
            .map(
              (d) =>
                `Draft "${d.definition.name}" is waiting for the user's review in ${name}'s Bots view (under Drafts) — it is not created until they save it.`,
            )
            .join("\n")
        : "";
      return reply(
        `Team: ${name} (lead: ${lead.name})\n\n${result.output || "(no answer)"}${draftNote}`,
      );
    },
  };
}

function capLimitOf(cap) {
  return cap && typeof cap._limit === "number" ? cap._limit : CAP_LIMIT;
}

/** Register the team tools with the Dash MCP server (app startup). */
function registerTeamTools() {
  const {
    registerTool,
    getServerContext,
  } = require("../controller/mcpDashServerController");
  const workspaceController = require("../controller/workspaceController");
  const botController = require("../controller/botController");

  const handlers = makeTeamToolHandlers({
    getWorkspaces: () => {
      const ctx = getServerContext();
      if (!ctx)
        throw new Error("MCP server is not running or has no active window");
      const result = workspaceController.listWorkspacesForApplication(
        ctx.win,
        ctx.appId,
      );
      return (result && result.workspaces) || [];
    },
    bots: {
      list: () => botController.list(),
      getRuns: (id, opts) => botController.getRuns(id, opts),
      leadAvailability: (id) => botController.leadAvailability(id),
      listDrafts: (wsId) => botController.listDrafts(wsId),
      askLead: (id, q, opts) => botController.askLead(id, q, opts),
    },
  });

  for (const tool of TEAM_TOOLS) {
    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: (args) => handlers[tool.name](args),
    });
  }
}

module.exports = { TEAM_TOOLS, makeTeamToolHandlers, registerTeamTools };
