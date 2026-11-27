/**
 * botTools.js — apps connected to Dash's MCP server list, create and change
 * bots (DASH-37). The point of MCP is acting from outside Dash, so these are
 * approved outside it too: with the user's task passphrase (bots/mcpTasks.js
 * — the same one, lock and tries as give_task) unless the user turned that
 * off in Settings › MCP Server › Tools.
 *
 * Dash MCP tools (all off until the user turns them on):
 *   list_bots    — the bots on the teams the user chose ("Which teams"),
 *                  with everything they may do.
 *   create_bot   — a new bot on one of those teams. Never a lead or a Dash
 *                  team bot.
 *   update_bot   — change only the fields given. A lead's role, team and
 *                  built-in tools stay Dash's.
 *   set_team_settings — declare a team's settings and set their values
 *                  (DASH-57): its bots use them as {name}. Waits for the
 *                  passphrase like a change.
 *   confirm_bot  — the passphrase for a waiting create or change (on while
 *                  create_bot, update_bot or set_team_settings is).
 *
 * A create or change is checked first, exactly as a save is
 * (botController.checkSave): one that wouldn't save returns every reason
 * and nothing waits. Otherwise it waits up to 10 minutes for the passphrase
 * with a plain summary of everything it saves — or saves now when no
 * passphrase is asked for. Saved: the bot (botController.save), the
 * provider tools it may run without asking (its grant — only the tools
 * named in runWithoutAsking, never more), on unless asked to start paused,
 * an audit entry ("over MCP, by …") and a notification. Handlers take their
 * dependencies so they're testable without Electron.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveDashboard } = require("../bots/teamDirectory");
const { botEventType, botRef } = require("../bots/botEvents");
const { deletesOrSends } = require("../bots/riskyTools");
const { cleanFrom, TASK_EXPIRES_MS } = require("../bots/mcpTasks");
const { cleanBotChecks, checksError } = require("../bots/botChecks");

const BUILTIN = ["none", "read-only", "all"];
const POLICIES = ["ask", "ask-every", "allow", "unattended"];
const WHILE_PAUSED = ["queue", "drop"];
const BOT_EVENTS = ["completed", "failed"];
// A widget event's name, as widgets declare them.
const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
// Most requests waiting for the passphrase at once.
const MAX_PENDING = 50;
// The arguments the permission gate holds to folders (permissionGate.js
// PATH_ARG_KEYS; registerBotTools passes the real list).
const PATH_ARG_KEYS = ["path", "uri", "filepath", "file", "directory"];
// An argument name that looks like it names files.
const PATH_LIKE_RE = /path|file|dir|source|destination|uri/i;

// How the bot form and the plan card say these (BotDetail BUILTIN_HINTS,
// workspacePlan POLICY_WORDS).
const BUILTIN_WORDS = {
  none: "none — only its providers' tools: no files, no shell commands, no web fetches",
  "read-only":
    "read-only — can read and search files; can't write files or run shell commands",
  all: "all — can read, write and edit files, run shell commands and fetch web pages, as its approvals allow",
};
const POLICY_WORDS = {
  ask: "asks before it changes anything",
  "ask-every": "asks before every tool",
  allow:
    "uses its tools without asking, except deleting or sending when its lead asks",
  unattended:
    "never asks, on any run: everything inside its folders runs, anything outside them is refused",
};
const WHILE_PAUSED_WORDS = {
  queue: "what starts it is kept for when it's turned on",
  drop: "what starts it is dropped",
};
const ALWAYS_BLOCKED =
  "Always blocked, whatever is listed: git push --force, git reset --hard, rm -rf, pushing to the main branch, and publishing a package.";
// More of each is wider access.
const BUILTIN_RANK = { none: 0, "read-only": 1, all: 2 };
const POLICY_RANK = { "ask-every": 0, ask: 1, allow: 2, unattended: 3 };

const SET_UP_TEAMS =
  'The user can choose teams in Dash: Settings › MCP Server › Tools › Bots › "Which teams".';

// ---- tool definitions ---------------------------------------------------

const PROVIDER_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The provider's name in Dash." },
    tools: {
      type: "array",
      items: { type: "string" },
      description:
        "Only these of its tools. Leave out for every tool the provider allows.",
    },
    runWithoutAsking: {
      type: "array",
      items: { type: "string" },
      description:
        "Its tools that run without asking first, each by name (no '*'); each must be one of its tools. Replaces what ran without asking; [] makes every tool ask again.",
    },
    readFolders: {
      type: "array",
      items: { type: "string" },
      description:
        "The folders the runWithoutAsking tools may read. Folders only matter for tools that run without asking; without runWithoutAsking they save nothing.",
    },
    writeFolders: {
      type: "array",
      items: { type: "string" },
      description:
        "The folders the runWithoutAsking tools may change. Folders only matter for tools that run without asking.",
    },
  },
  required: ["name"],
};

// The fields create_bot and update_bot share.
const BOT_FIELDS = {
  name: { type: "string", description: "The bot's name." },
  instructions: {
    type: "string",
    description: "What the bot does and how, in full.",
  },
  model: {
    type: "string",
    description: "A model id. Leave out for the user's default.",
  },
  aiProvider: {
    type: "string",
    description:
      "The AI provider id the model is on (e.g. 'anthropic'). Leave out for the user's default.",
  },
  builtinTools: {
    type: "string",
    enum: BUILTIN,
    description:
      "What it may do on the computer itself: 'none' (only its providers' tools), 'read-only' (read and search files) or 'all' (also write files and run shell commands). New bots: 'none' unless given.",
  },
  approvalPolicy: {
    type: "string",
    enum: POLICIES,
    description:
      "'ask' (asks before anything that changes things), 'ask-every' (before every tool) or 'allow' (without asking; deleting or sending still asks when its lead asks) or 'unattended' (never asks, on any run: inside its folders everything runs, outside them is refused; it needs folders). New bots: 'ask' unless given.",
  },
  providers: {
    type: "array",
    items: PROVIDER_SCHEMA,
    description:
      "The providers it uses, all of them (this replaces the list; a provider left out stops running anything without asking). Each by name, with the tools it may use and those that run without asking.",
  },
  commands: {
    type: "object",
    properties: {
      allowed: {
        type: "array",
        items: { type: "string" },
        description: "Shell commands that run without asking (one each).",
      },
      blocked: {
        type: "array",
        items: { type: "string" },
        description: "Shell commands that never run.",
      },
    },
    description: "Only apply with builtinTools 'all'.",
  },
  runLimits: {
    type: "object",
    properties: {
      steps: { type: "number" },
      minutes: { type: "number" },
      costPerRun: { type: "number", description: "US dollars." },
    },
    description: "Most a run may take. 0 removes a limit.",
  },
  projects: {
    type: "array",
    items: { type: "string" },
    description:
      "Folders it works in: whole paths, or one of its team's settings like '{workFolder}' or '{workFolder}/repo' (set_team_settings), filled in when it runs.",
  },
  schedules: {
    type: "array",
    items: {
      type: "object",
      properties: {
        cron: {
          type: "string",
          description: "A cron expression, e.g. '0 8 * * *'.",
        },
        prompt: { type: "string", description: "What to ask it each time." },
      },
      required: ["cron"],
    },
    description: "When it runs on its own (replaces the list).",
  },
  subscriptions: {
    type: "array",
    items: {
      type: "object",
      properties: {
        bot: {
          type: "string",
          description: "Another bot on its team (name or id).",
        },
        widget: {
          type: "string",
          description:
            "A widget on its team's dashboard (its id, or its title when that's unique).",
        },
        event: {
          type: "string",
          description:
            "For a bot: 'completed' or 'failed'. For a widget: the event it sends.",
        },
      },
      required: ["event"],
    },
    description:
      "What starts it (replaces the list): { bot, event } or { widget, event }, on its own team only.",
  },
  whilePaused: {
    type: "string",
    enum: WHILE_PAUSED,
    description:
      "What happens to what starts it while it's paused: 'queue' (kept for later) or 'drop'.",
  },
  publishes: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
    description: "Results it publishes for widgets.",
  },
  checks: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["check", "reviewer", "you"],
              description:
                "'check' (Dash runs it, no AI), 'reviewer' (another bot on its team judges the work) or 'you' (waits for the user to approve or send it back).",
            },
            name: { type: "string", description: "Shown on the job." },
            when: {
              type: "string",
              description:
                "Only when a team setting says so, e.g. '{approvePlans}': filled in when the bot runs, and the step is left out when it reads no (no, false, off, 0 or empty). Leave out for always.",
            },
            note: {
              type: "string",
              description: "What it looks for (for a reviewer or the user).",
            },
            check: {
              type: "object",
              description:
                "For kind 'check', as the Bots tab saves it. { kind: 'command', command, passWhen?, timeoutSec? }: runs in its job's workspace (else its first folder) and gets its answer as JSON on stdin and in $DASH_INPUT (with the job's item and workspace), and DASH_ITEM_ID, DASH_WORKSPACE, DASH_BRANCH in its environment; passWhen is { type: 'exit0' } (the default), { type: 'contains', text } (exit 0 and the output has it) or { type: 'matches', pattern } (the output matches the regex). { kind: 'tool', server, tool, args?, answerRules? }: a read-only provider tool. { kind: 'rules', rules }. { kind: 'script', script, timeoutSec? }: function check(input) returns { pass, reason }. Built in (no AI): { kind: 'git-on-branch', branch? }, { kind: 'git-committed', base? }, { kind: 'pr-ci', prKey?: 'prUrl', timeoutSec?, ifNoChecks?: 'pass'|'fail' }, { kind: 'handoff-has', keys }. { kind: 'repo', name, ifMissing?: 'fail'|'skip', fallback?, from?: 'base'|'workspace', base?, timeoutSec? }: runs the repo's .dash/checks/<name> (any extension) like a command, read from its base branch so the work can't change it; fallback is any other check, run when the repo has none. A script, or a command's last output line as JSON, may pass with handOn: false ({ pass: true, handOn: false, reason }): the work ends there, the rest of the checks don't run, and nothing is handed on (no completed or failed event) — for a bot that found nothing to do.",
            },
            bot: {
              type: "string",
              description:
                "For kind 'reviewer': the bot that reviews (name or id, on its team).",
            },
          },
          required: ["kind"],
        },
      },
      onFail: {
        type: "string",
        enum: ["retry", "you", "stop"],
        description:
          "A failed check: 'retry' (back to the bot with what failed, up to maxTries, then to the user), 'you' (straight to the user) or 'stop'.",
      },
      maxTries: { type: "number", description: "Tries for 'retry'." },
      handsOn: {
        type: "string",
        enum: ["answer", "summary"],
        description:
          "What passed work hands on to the next bots: its whole answer (the default) or its first paragraph.",
      },
    },
    description:
      "Its checks, all of them (this replaces them): they hold its work until they pass; only work that passed is handed on. { steps: [] } removes them.",
  },
  from: {
    type: "string",
    description:
      "Your app's short name (e.g. 'voice-assistant'), shown to the user in Dash.",
  },
};

const BOT_TOOLS = [
  {
    name: "list_bots",
    defaultOff: true,
    description:
      "List the bots on the teams the user lets MCP clients see, with everything each may do: team, role, paused, model, built-in tools, approvals, providers with their tools (and which run without asking, in which folders), commands, run limits, folders it works in, schedules, triggers, checks and instructions. 'team' (a dashboard name or id) narrows it to one team.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The team's dashboard name or id.",
        },
      },
      required: [],
    },
  },
  {
    name: "check_team_setup",
    defaultOff: true,
    description:
      "Check a team's setup without running anything (DASH-108): every provider its bots use starts and answers, every setting they use has a value, each repo in its tables can be read (and pushed to, when a bot pushes) with the GitHub provider's token, and every repo check a step names is on the repo's base branch. Returns ok and each problem with its fix. A team with the standard handoff runs this before each new job, and doesn't start one that fails. Run it after changing a team.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The team's dashboard name or id.",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "create_bot",
    defaultOff: true,
    description:
      "Make a new bot on one of the user's teams (one they let MCP clients change). It's checked the way Dash checks a save; one that wouldn't save comes back with every reason. Usually it then waits for the user: status 'waiting' with a summary and requestId — show the user the whole summary, ask for their task passphrase, and call confirm_bot. Never guess or reuse a passphrase the user didn't just say. A new bot is on once saved (it can take tasks) unless startPaused. Building a team? Read get_setup_guide({ topic: 'bots' }) first.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The team's dashboard name or id.",
        },
        ...BOT_FIELDS,
        startPaused: {
          type: "boolean",
          description: "Save it paused, for the user to turn on in Dash.",
        },
      },
      required: ["name", "team", "instructions"],
    },
  },
  {
    name: "update_bot",
    defaultOff: true,
    description:
      "Change a bot (from list_bots): give only the fields to change. 'bot' is its id, or its name when that's unique on the teams you can see. The summary says what changes, old → new, and when it gets more access. Like create_bot, it usually waits for confirm_bot. A team lead's role, team and built-in tools can't be changed. Its checks and providers replace the whole list; get_setup_guide({ topic: 'bots' }) has how to build checks that work.",
    inputSchema: {
      type: "object",
      properties: {
        bot: { type: "string", description: "The bot's id or name." },
        team: {
          type: "string",
          description: "Move it to this team (one you can see).",
        },
        ...BOT_FIELDS,
      },
      required: ["bot"],
    },
  },
  {
    name: "set_team_settings",
    defaultOff: true,
    description:
      "Declare a team's settings and set their values. Each bot on the team can use a setting as {name} in its instructions, its check commands (and their other fields), its folders, its schedules' prompts and its triggers' notes; Dash fills in the value when it runs, so the bots keep {name} and one change reaches all of them. A folder like '{workFolder}/repo' counts for the bot's folder fence once filled in. 'declare' adds settings or replaces ones of the same name, each { name (letters, digits, _), label, type: 'text'|'url'|'folder'|'command'|'boolean'|'number', default?, description? } — a folder is a whole path (/… or ~/…), a boolean reads as yes/no. A 'table' (DASH-84) is rows of the same fields, one per repo for example: declare it with 'columns' ([{ name, label, type }]) and set its value to a list of rows, each with a 'key' ([{ key: 'dash-core', url: '…', validateCmd: '…' }]). Bots use {repo.url}, {repo.validateCmd}, {repo.key}; each job uses the row a bot names in its answer's last json block ('repo': 'dash-core', or the table's 'pick' field), and a run that uses the table before a row is picked fails saying so. 'values' sets values by name ('' clears one, so its default is used). 'remove' takes settings away. Settings aren't secret: tokens belong in a provider. Settings travel when the team is published (their values don't); a run that uses a setting with no value fails saying which. Like update_bot it usually waits for confirm_bot. list_bots shows each team's settings.",
    inputSchema: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The team's dashboard name or id.",
        },
        declare: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "text",
                  "url",
                  "folder",
                  "command",
                  "boolean",
                  "number",
                  "table",
                ],
              },
              default: {},
              description: { type: "string" },
              columns: {
                type: "array",
                description:
                  "For a table: its fields (not 'key', which every row has).",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    label: { type: "string" },
                    type: {
                      type: "string",
                      enum: [
                        "text",
                        "url",
                        "folder",
                        "command",
                        "boolean",
                        "number",
                      ],
                    },
                    description: { type: "string" },
                  },
                  required: ["name"],
                },
              },
              pick: {
                type: "string",
                description:
                  "For a table: the answer's field that names the job's row (default: the table's name).",
              },
            },
            required: ["name"],
          },
          description: "Settings to add or replace.",
        },
        values: {
          type: "object",
          description:
            "Values by setting name; '' clears one (its default is used). A table's value is its rows: [{ key, ...columns }].",
        },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Names of settings to take away.",
        },
        usesHandoffs: {
          type: "boolean",
          description:
            "Turn the standard handoff on or off for the team's bots (DASH-101). On: every bot's answer ends with one json block (the handoff) that Dash checks first (Dash's Handoff check: it parses, status is ok/none/ask/split, item.id is the job's, workspace.dir is inside the bot's folders; a wrong one goes back to the bot with what's wrong). Dash handles status none (the job ends: nothing to do), ask (the job waits for the user's answer, which goes back to the bot) and split (the job ends: split into its items). The next bot is told the job's work item, workspace, picks and the handoff's summary and data instead of the raw event.",
        },
        from: {
          type: "string",
          description:
            "Your app's short name (e.g. 'voice-assistant'), shown to the user in Dash.",
        },
      },
      required: ["team"],
    },
  },
  {
    name: "confirm_bot",
    // No switch of its own: on while any tool it confirms is.
    onWith: ["create_bot", "update_bot", "set_team_settings"],
    description:
      "Save a waiting create_bot or update_bot with the task passphrase the user just said.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: {
          type: "string",
          description: "From create_bot or update_bot.",
        },
        passphrase: {
          type: "string",
          description: "The user's task passphrase, as they said it.",
        },
      },
      required: ["requestId", "passphrase"],
    },
  },
];

// ---- small helpers ------------------------------------------------------

const json = (body, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(body) }],
  ...(isError ? { isError: true } : {}),
});

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_e) {
    return iso;
  }
};

const sameId = (a, b) =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);

const isDashTeam = (b) => !!b && b.system === "dash-team";
const isLead = (b) => !!b && b.role === "lead";
const lower = (s) => String(s || "").toLowerCase();
const strings = (v) =>
  Array.isArray(v)
    ? v.map((x) => String(x == null ? "" : x).trim()).filter(Boolean)
    : [];
// A list that was given and has something in it, else null (an empty one
// is ignored).
const nonEmpty = (v) => {
  const list = uniq(strings(v));
  return list.length ? list : null;
};
const uniq = (list) => [...new Set(list)];
const sorted = (list) => [...list].sort();

/** JSON with keys in order, so equal values compare equal. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

const clip = (s, n = 300) => {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// Every widget on a dashboard, inside grid containers too — the same walk
// and id rule as botController's allWidgetItems / itemIdOf.
const itemIdOf = (item) =>
  item == null
    ? null
    : item.id !== undefined && item.id !== null
      ? String(item.id)
      : item.uuidString || item.uuid || null;
function widgetsOn(ws) {
  const out = [];
  const seen = new Set();
  const walk = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      if (item.component && itemIdOf(item) !== null) out.push(item);
      walk(item.items);
      walk(item.layout);
    }
  };
  walk(
    [
      ws && ws.layout,
      ...((ws && ws.pages) || []).map((p) => p && p.layout),
      ws && ws.sidebarLayout,
    ]
      .filter(Array.isArray)
      .flat(),
  );
  return out;
}
const widgetName = (item) => item.title || item.name || item.component;

// ---- a bot as MCP clients see it -----------------------------------------

const builtinOf = (bot) =>
  bot && BUILTIN.includes(bot.builtinTools) ? bot.builtinTools : "all";
const commandsOf = (bot) => ({
  allowed: strings(bot && bot.commands && bot.commands.allowed),
  blocked: strings(bot && bot.commands && bot.commands.blocked),
});
const limitsOf = (bot) => {
  const l = (bot && bot.runLimits) || {};
  const out = {};
  for (const k of ["steps", "minutes", "costPerRun"]) {
    if (Number(l[k]) > 0) out[k] = Number(l[k]);
  }
  return out;
};
const serversOf = (bot) =>
  Array.isArray(bot && bot.mcpServers) ? bot.mcpServers : [];
// Narrowing only for providers it uses (the form keeps it that way too).
const selectionsOf = (bot) => {
  const ts = (bot && bot.toolSelections) || {};
  const out = {};
  for (const name of serversOf(bot)) {
    if (Array.isArray(ts[name])) out[name] = [...ts[name]];
  }
  return out;
};
/** A provider's entry in the bot's grant: { tools, read, write }, or null. */
const grantEntryOf = (grant, name) => {
  const s = grant && grant.servers && grant.servers[name];
  if (!s) return null;
  return {
    tools: [...(s.tools || [])],
    read: [...(s.readPaths || [])],
    write: [...(s.writePaths || [])],
  };
};

/** A trigger as update_bot takes it back, when it can be said that way. */
function shorthandOf(sub) {
  const src = sub && sub.source;
  if (!src || !src.instanceId || !src.event) return null;
  if (src.kind === "bot") return { bot: src.instanceId, event: src.event };
  if (src.kind === "widget")
    return { widget: src.instanceId, event: src.event };
  return null;
}

function botView(bot, { workspaces, grant, paused }) {
  const ws = (workspaces || []).find((w) => sameId(w.id, bot.workspaceId));
  const selections = selectionsOf(bot);
  return {
    id: bot.id,
    name: bot.name,
    team: {
      id: bot.workspaceId != null ? String(bot.workspaceId) : null,
      name: (ws && ws.name) || null,
    },
    role: isLead(bot) ? "lead" : "member",
    paused: !!paused,
    model: bot.model || null,
    provider: bot.provider || null,
    builtinTools: builtinOf(bot),
    approvalPolicy: bot.approvalPolicy || "ask",
    providers: serversOf(bot).map((name) => {
      const g = grantEntryOf(grant, name) || { tools: [], read: [], write: [] };
      return {
        name,
        tools: selections[name] || null,
        runWithoutAsking: g.tools,
        readFolders: g.read,
        writeFolders: g.write,
      };
    }),
    commands: commandsOf(bot),
    runLimits: limitsOf(bot),
    projects: strings(bot.projects),
    schedules: Array.isArray(bot.schedules) ? bot.schedules : [],
    subscriptions: (Array.isArray(bot.subscriptions)
      ? bot.subscriptions
      : []
    ).map((s) => {
      const short = shorthandOf(s);
      return {
        label: s.label || s.eventType,
        eventType: s.eventType,
        ...(short ? { as: short } : {}),
      };
    }),
    whilePaused: bot.whilePaused || "queue",
    publishes: Array.isArray(bot.publishes) ? bot.publishes : [],
    checks: cleanBotChecks(bot.checks),
    instructions: bot.instructions || "",
  };
}

// ---- MCP fields → a bot definition ---------------------------------------

/**
 * The tools a bot is given that its provider doesn't have (DASH-72), said
 * with the provider's real names and the nearest one. `known` is null when
 * Dash can't list them (not connected): nothing is refused then.
 */
function unknownToolsProblem(name, chosen, known) {
  if (!Array.isArray(known) || !known.length) return null;
  const names = known
    .map((t) => (t && typeof t === "object" ? t.name : t))
    .filter((t) => typeof t === "string" && t);
  if (!names.length) return null;
  const have = new Set(names);
  const missing = (chosen || []).filter((t) => !have.has(t));
  if (!missing.length) return null;
  const hints = missing.map((t) => {
    const near = nearestName(t, names);
    return near ? `${t} (did you mean ${near}?)` : t;
  });
  return `${name} has no tool named ${hints.join(", ")}. Its tools: ${names.join(", ")}.`;
}

/** The closest of `names` to `word`, when it's close enough to suggest. */
function nearestName(word, names) {
  const mine = nameWords(word);
  let best = null;
  let bestScore = 0;
  for (const n of names) {
    const theirs = nameWords(n);
    let score = 0;
    for (const w of mine) if (theirs.has(w)) score++;
    if (score > bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** A tool name's words: addCommentToJiraIssue → add, comment, jira, issue. */
function nameWords(name) {
  return new Set(
    String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Read the fields given, as the bot form's formDefinition() would save
 * them. Only fields given come back. What runs without asking goes apart:
 * it's the bot's grant, not part of the bot.
 * @returns {{ fields: object, access: object, problems: string[] }}
 *   fields keyed by MCP name, each a definition fragment; access by
 *   provider: { tools?, read?, write? } as given
 */
function readFields(
  args,
  {
    current = null,
    members = [],
    selfId = null,
    dashboard = null,
    providerTools = () => null,
    pathArgKeys = PATH_ARG_KEYS,
    homeDir = os.homedir(),
  },
) {
  const problems = [];
  // Said with the summary, not refused (DASH-72).
  const notes = [];
  const fields = {};
  const access = {};
  const has = (k) => args[k] !== undefined && args[k] !== null;

  if (has("name")) {
    const name = String(args.name).trim();
    if (!name) problems.push("name can't be empty.");
    fields.name = { name };
  }
  if (has("instructions")) {
    fields.instructions = { instructions: String(args.instructions).trim() };
  }
  if (has("model")) {
    fields.model = { model: String(args.model).trim() || null };
  }
  if (has("aiProvider")) {
    fields.aiProvider = { provider: String(args.aiProvider).trim() || null };
  }
  if (has("builtinTools")) {
    if (!BUILTIN.includes(args.builtinTools)) {
      problems.push(`builtinTools must be one of ${BUILTIN.join(", ")}.`);
    } else {
      // "all" is saved as null, as the form saves it.
      fields.builtinTools = {
        builtinTools: args.builtinTools === "all" ? null : args.builtinTools,
      };
    }
  }
  if (has("approvalPolicy")) {
    if (!POLICIES.includes(args.approvalPolicy)) {
      problems.push(`approvalPolicy must be one of ${POLICIES.join(", ")}.`);
    } else {
      fields.approvalPolicy = { approvalPolicy: args.approvalPolicy };
    }
  }
  if (has("providers")) {
    if (!Array.isArray(args.providers)) {
      problems.push("providers must be a list.");
    } else {
      const mcpServers = [];
      const toolSelections = {};
      for (const p of args.providers) {
        const name = String((p && p.name) || "").trim();
        if (!name) {
          problems.push("Each provider needs a name.");
          continue;
        }
        if (mcpServers.includes(name)) continue;
        mcpServers.push(name);
        if (Array.isArray(p.tools)) {
          toolSelections[name] = uniq(strings(p.tools));
          // Names the provider doesn't have are refused (DASH-72): a bot
          // given one only finds out when its run is refused the tool.
          const known = providerTools(name);
          const problem = unknownToolsProblem(
            name,
            toolSelections[name],
            known,
          );
          if (problem) problems.push(problem);
          else if (!Array.isArray(known) && toolSelections[name].length) {
            notes.push(
              `${name} isn't connected, so its tool names weren't checked.`,
            );
          }
        }
        const run = Array.isArray(p.runWithoutAsking)
          ? uniq(strings(p.runWithoutAsking))
          : null;
        if (run && run.length) {
          const problem = runProblem(name, run, {
            chosen: toolSelections[name] || null,
            known: providerTools(name),
            pathArgKeys,
          });
          if (problem) problems.push(problem);
        }
        const read = readFolders(name, p.readFolders, problems, homeDir);
        const write = readFolders(name, p.writeFolders, problems, homeDir);
        if (run || read || write) {
          access[name] = {
            ...(run ? { tools: run } : {}),
            ...(read ? { read } : {}),
            ...(write ? { write } : {}),
          };
        }
      }
      fields.providers = { mcpServers, toolSelections };
    }
  }
  if (has("commands")) {
    const c = args.commands || {};
    const was = commandsOf(current);
    fields.commands = {
      commands: {
        allowed: c.allowed !== undefined ? strings(c.allowed) : was.allowed,
        blocked: c.blocked !== undefined ? strings(c.blocked) : was.blocked,
      },
    };
  }
  if (has("runLimits")) {
    const next = { ...limitsOf(current) };
    for (const k of ["steps", "minutes", "costPerRun"]) {
      const v = args.runLimits[k];
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        problems.push(`runLimits.${k} must be a number, 0 or more.`);
      } else if (n === 0) delete next[k];
      else next[k] = n;
    }
    fields.runLimits = { runLimits: next };
  }
  if (has("projects")) fields.projects = { projects: strings(args.projects) };
  if (has("schedules")) {
    if (!Array.isArray(args.schedules)) {
      problems.push("schedules must be a list.");
    } else {
      fields.schedules = {
        schedules: args.schedules.map((s) => ({
          cron: String((s && s.cron) || "").trim(),
          prompt: String((s && s.prompt) || "").trim(),
        })),
      };
    }
  }
  if (has("subscriptions")) {
    if (!Array.isArray(args.subscriptions)) {
      problems.push("subscriptions must be a list.");
    } else {
      const subs = [];
      for (const s of args.subscriptions) {
        const r = resolveSubscription(s, { members, selfId, dashboard });
        if (r.problem) problems.push(r.problem);
        else subs.push(r.subscription);
      }
      fields.subscriptions = { subscriptions: subs };
    }
  }
  if (has("whilePaused")) {
    if (!WHILE_PAUSED.includes(args.whilePaused)) {
      problems.push(`whilePaused must be one of ${WHILE_PAUSED.join(", ")}.`);
    } else fields.whilePaused = { whilePaused: args.whilePaused };
  }
  if (has("publishes")) {
    if (!Array.isArray(args.publishes)) {
      problems.push("publishes must be a list.");
    } else {
      // Only what a declared result has; a blank label falls back to the
      // result's name (as the form saves it). botSchema checks the names.
      fields.publishes = {
        publishes: args.publishes.map((p) => {
          const name = String((p && p.name) || "").trim();
          const description =
            p && typeof p.description === "string" ? p.description.trim() : "";
          return {
            name,
            label: String((p && p.label) || "").trim() || name,
            ...(description ? { description } : {}),
          };
        }),
      };
    }
  }
  if (has("checks")) {
    const r = readChecks(args.checks, { members, selfId });
    if (r.problems.length) problems.push(...r.problems);
    else fields.checks = { checks: r.checks };
  }
  return { fields, access, problems, notes };
}

/**
 * A bot's checks as given over MCP → as the Bots tab saves them (botChecks
 * cleanBotChecks), or null for none. A reviewer is named by bot (name or
 * id) on its team; the settings each check kind needs must be there — a
 * check that couldn't run is a problem, never dropped quietly.
 * @returns {{ checks: object|null, problems: string[] }}
 */
function readChecks(input, { members = [], selfId = null }) {
  const problems = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      checks: null,
      problems: [
        "checks must be an object: { steps, onFail?, maxTries?, handsOn? }.",
      ],
    };
  }
  if (input.steps !== undefined && !Array.isArray(input.steps)) {
    return { checks: null, problems: ["checks.steps must be a list."] };
  }
  const steps = (input.steps || []).map((s, i) => {
    const label = `Check ${i + 1}`;
    if (!s || typeof s !== "object") {
      problems.push(`${label} must be an object.`);
      return s;
    }
    const step = { ...s };
    if (s.kind === "reviewer") {
      const ref = String(s.bot || s.botId || "").trim();
      const found = members.filter(
        (b) => !isDashTeam(b) && (b.id === ref || lower(b.name) === lower(ref)),
      );
      if (!ref)
        problems.push(
          `${label}: a reviewer needs the bot that reviews ('bot').`,
        );
      else if (!found.length)
        problems.push(`${label}: no bot named "${ref}" on its team to review.`);
      else if (found.length > 1) {
        problems.push(
          `${label}: several bots on its team are named "${ref}": ${found.map((b) => b.id).join(", ")}. Use its id.`,
        );
      } else if (selfId && found[0].id === selfId) {
        problems.push(`${label}: a bot can't review its own work.`);
      } else step.botId = found[0].id;
      delete step.bot;
    }
    if (s.kind === "check") {
      const c = s.check && typeof s.check === "object" ? s.check : {};
      const blank = (v) => !String(v || "").trim();
      if (c.kind === "command" && blank(c.command)) {
        problems.push(`${label}: a command check needs its command.`);
      } else if (c.kind === "tool" && (blank(c.server) || blank(c.tool))) {
        problems.push(`${label}: a tool check needs its server and tool.`);
      } else if (
        c.kind === "rules" &&
        !(Array.isArray(c.rules) && c.rules.length)
      ) {
        problems.push(`${label}: a rules check needs at least one rule.`);
      } else if (c.kind === "script" && blank(c.script)) {
        problems.push(`${label}: a script check needs its script.`);
      }
    }
    return step;
  });
  if (problems.length) return { checks: null, problems };
  const raw = { ...input, steps };
  const err = checksError(raw, selfId);
  if (err) return { checks: null, problems: [`checks: ${err}.`] };
  return { checks: cleanBotChecks(raw), problems };
}

const ON_FAIL_WORDS = {
  retry: (n) =>
    `a fail goes back to it with what failed (up to ${n} tries), then to the user`,
  you: () => "a fail goes to the user",
  stop: () => "a fail stops it",
};

/** One check step in words. */
function checkStepText(step, nameOf) {
  const text = checkStepWhat(step, nameOf);
  // Only when a team setting says so (DASH-85).
  return step.when ? `${text} (only when ${oneLine(step.when)})` : text;
}

function checkStepWhat(step, nameOf) {
  const name = `"${oneLine(step.name)}"`;
  if (step.kind === "you") return `${name}: waits for the user to approve`;
  if (step.kind === "reviewer") {
    return `${name}: ${oneLine(nameOf(step.botId))} reviews the work`;
  }
  const c = step.check || {};
  // As command.js reads it: { type: "exit0" | "contains" | "matches" }.
  const when =
    (c.passWhen && typeof c.passWhen === "object" && c.passWhen) || {};
  const pass =
    when.type === "contains"
      ? `it exits 0 and its output contains ${JSON.stringify(String(when.text || ""))}`
      : when.type === "matches"
        ? `its output matches /${oneLine(when.pattern || "")}/`
        : "it exits 0";
  switch (c.kind) {
    case "command":
      return `${name}: runs \`${oneLine(c.command)}\`; passes when ${pass}${
        step.held
          ? " (off: it came with a package, so it doesn't run until it's turned on)"
          : ""
      }`;
    case "tool":
      return `${name}: asks ${oneLine(c.server)} › ${oneLine(c.tool)} (read-only)`;
    case "rules":
      return `${name}: ${(c.rules || []).length} rule(s)`;
    case "script":
      return `${name}: a script`;
    default:
      return name;
  }
}

/** A bot's checks in words, for a summary. */
function checksText(checks, nameOf = (id) => id) {
  const c = cleanBotChecks(checks);
  if (!c) return "none (its work goes straight on)";
  const steps = c.steps.map((s, i) => `${i + 1}. ${checkStepText(s, nameOf)}`);
  return `${steps.join("; ")}; ${ON_FAIL_WORDS[c.onFail](c.maxTries)}`;
}

/**
 * Why these can't run without asking, or null. Each must be a tool the bot
 * may use there: one chosen in 'tools', else one the provider has. A tool
 * that names files in an argument the gate doesn't hold to folders (move_file's
 * source, read_multiple_files' paths) can't — it would reach past them.
 * @param {Array<string|{name, inputSchema?}>|null} known  the provider's tools
 * @param {string[]} pathArgKeys  the arguments the gate checks folders on
 */
function runProblem(name, run, { chosen, known, pathArgKeys }) {
  if (run.some((t) => t.includes("*"))) {
    return `${name}: name each tool that runs without asking — "*" isn't accepted.`;
  }
  const info = Array.isArray(known)
    ? known
        .map((t) => (typeof t === "string" ? { name: t } : t))
        .filter((t) => t && t.name)
    : null;
  const allowed = chosen || (info ? info.map((t) => t.name) : null);
  if (!allowed) {
    return `${name}: Dash can't list its tools right now, so it can't check runWithoutAsking. Name its tools in 'tools' first.`;
  }
  const unknown = run.filter((t) => !allowed.includes(t));
  if (unknown.length) {
    return `${name}: ${unknown.join(", ")} ${
      unknown.length === 1 ? "isn't one of its tools" : "aren't among its tools"
    }${chosen ? " chosen in 'tools'" : ""}.`;
  }
  for (const tool of run) {
    const t = (info || []).find((x) => x.name === tool);
    // Its inputs unseen (not connected, a Claude connector, a provider Dash
    // can't list): it can't be checked, so it asks.
    if (!t || !t.inputSchema || typeof t.inputSchema !== "object") {
      return `${name}: Dash can't see ${tool}'s inputs on ${name} right now — connect the provider (or leave the tool to ask).`;
    }
    const props = t.inputSchema.properties
      ? Object.keys(t.inputSchema.properties)
      : [];
    const loose = props.find(
      (k) => PATH_LIKE_RE.test(k) && !pathArgKeys.includes(k),
    );
    if (loose) {
      return `${name}: ${tool} names files in '${loose}', which Dash can't hold to folders — leave it to ask.`;
    }
  }
  return null;
}

/**
 * Folders as given over MCP: each a full, plain path ("~/" is the home
 * folder). Anything the gate could read as "anywhere" — ".", a relative or
 * "/.."-style path, a trailing "/", the disk itself — is refused.
 */
function readFolders(name, list, problems, homeDir) {
  const given = nonEmpty(list);
  if (!given) return null;
  const out = [];
  for (const raw of given) {
    const p =
      raw === "~" || raw.startsWith("~/")
        ? path.join(homeDir, raw.slice(1))
        : raw;
    const plain =
      !/[\u0000-\u001f\u2028\u2029]/.test(p) &&
      path.isAbsolute(p) &&
      path.resolve(p) === p &&
      path.parse(p).root !== p;
    if (!plain) {
      problems.push(
        `${name}: "${oneLine(raw)}" isn't a full folder path. Give it from the top, like ${path.join(homeDir, "Notes")} — no ".", "..", trailing "/" or the whole disk.`,
      );
      continue;
    }
    // A link reaches wherever it points: only the real folder is taken.
    // The native call gives the folder's true case too (a Mac disk ignores
    // case, so "/users/me" would otherwise slip past the home check).
    let real = p;
    try {
      if (fs.existsSync(p)) real = fs.realpathSync.native(p);
    } catch (_e) {
      real = p;
    }
    if (real !== p) {
      problems.push(
        real.toLowerCase() === p.toLowerCase()
          ? `${name}: give "${oneLine(p)}" as "${oneLine(real)}".`
          : `${name}: "${oneLine(p)}" is a link to "${oneLine(real)}" — give the real folder.`,
      );
      continue;
    }
    // The home folder, anything holding it, or the whole disk.
    const home = homeDir.toLowerCase();
    const r = real.toLowerCase();
    if (
      r === home ||
      home.startsWith(r.endsWith(path.sep) ? r : r + path.sep) ||
      path.parse(real).root === real
    ) {
      problems.push(
        `${name}: "${oneLine(p)}" is ${path.parse(real).root === real ? "your whole disk" : r === home ? "your whole home folder" : "a folder holding your home folder"} — give a folder inside your home folder.`,
      );
      continue;
    }
    out.push(p);
  }
  return out.length ? uniq(out) : null;
}

/**
 * A trigger, on the bot's own team only: { bot, event } — another bot on
 * its team finishing or failing, made the way a lead's draft makes one
 * (botDrafts.js) — or { widget, event } on its team's dashboard, made the
 * way the trigger picker makes one (eventCatalog.widgetSubscription). The
 * label is always Dash's own.
 */
function resolveSubscription(s, { members, selfId, dashboard }) {
  if (!s || typeof s !== "object") {
    return { problem: "Each trigger must be an object." };
  }
  const event = String(s.event || "").trim();
  const botRefGiven = String(s.bot || "").trim();
  const widgetRef = String(s.widget || "").trim();
  if (!botRefGiven && !widgetRef) {
    return {
      problem:
        "Give each trigger as { bot, event } or { widget, event } on its own team; Dash makes the rest.",
    };
  }
  if (botRefGiven) {
    if (!BOT_EVENTS.includes(event)) {
      return {
        problem: `"${botRefGiven}" › "${event || "?"}": a bot's event must be 'completed' or 'failed'.`,
      };
    }
    const found = members.filter(
      (b) =>
        !isLead(b) &&
        !isDashTeam(b) &&
        b.id !== selfId &&
        (b.id === botRefGiven || lower(b.name) === lower(botRefGiven)),
    );
    if (!found.length) {
      return { problem: `No other bot named "${botRefGiven}" on its team.` };
    }
    if (found.length > 1) {
      return {
        problem: `Several bots on its team are named "${botRefGiven}": ${found
          .map((b) => b.id)
          .join(", ")}. Use its id.`,
      };
    }
    const member = found[0];
    return {
      subscription: {
        eventType: botEventType(member, event),
        label: `${member.name} › ${event}`,
        source: {
          kind: "bot",
          ref: botRef(member),
          instanceId: member.id,
          event,
          workspaceId: String(member.workspaceId),
        },
      },
    };
  }
  if (!EVENT_NAME_RE.test(event)) {
    return {
      problem: `"${widgetRef}": give the widget's event by name (e.g. 'clicked').`,
    };
  }
  const items = widgetsOn(dashboard);
  let found = items.filter((i) => itemIdOf(i) === widgetRef);
  if (!found.length) {
    found = items.filter((i) => lower(widgetName(i)) === lower(widgetRef));
  }
  if (!found.length) {
    return { problem: `No widget "${widgetRef}" on its team's dashboard.` };
  }
  if (found.length > 1) {
    return {
      problem: `Several widgets on its dashboard are called "${widgetRef}": ${found
        .map((i) => itemIdOf(i))
        .join(", ")}. Use its id.`,
    };
  }
  const item = found[0];
  const id = itemIdOf(item);
  return {
    subscription: {
      eventType: `${item.component}[${id}].${event}`,
      source: {
        kind: "widget",
        ref: item.component,
        instanceId: id,
        event,
        workspaceId: String(dashboard.id),
      },
      label: `${dashboard.name || "Untitled"} › ${widgetName(item)} › ${event}`,
    },
  };
}

// ---- what it says to the user ---------------------------------------------

// A value on one summary line: its line breaks can't start a new line that
// looks like Dash's own.
const oneLine = (v) =>
  String(v == null ? "" : v)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .trim();
// Text that may run over several lines (instructions, prompts): each line
// set in, under a bar, so none of it reads as part of the summary.
const block = (v) =>
  String(v == null ? "" : v)
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map((l) => `    | ${l}`)
    .join("\n");

const listOr = (list, none) =>
  list.length ? list.map(oneLine).join(", ") : none;

function toolsText(tools) {
  if (!tools) return "all its tools";
  if (!tools.length) return "no tools";
  const changers = tools.filter((t) => deletesOrSends(t));
  return `${listOr(tools)}${
    changers.length
      ? ` (${listOr(changers)} ${changers.length === 1 ? "changes or sends" : "change or send"} things)`
      : ""
  }`;
}

function limitsText(l) {
  const parts = [];
  if (l.steps) parts.push(`${l.steps} steps`);
  if (l.minutes) parts.push(`${l.minutes} minutes`);
  if (l.costPerRun) parts.push(`$${Number(l.costPerRun).toFixed(2)}`);
  return parts.length ? `up to ${parts.join(", ")} a run` : "Dash's defaults";
}

function foldersText(g) {
  const parts = [];
  if (g.read && g.read.length) parts.push(`reads ${listOr(g.read)}`);
  if (g.write && g.write.length) parts.push(`changes ${listOr(g.write)}`);
  return parts.join("; ");
}

/**
 * What runs without asking on a provider (a grant entry), in words. The
 * gate holds a call to folders only by its path/file argument; one that
 * names no file isn't held anywhere.
 */
function grantText(g) {
  if (!g || !g.tools.length) return "nothing";
  const where = foldersText(g);
  return `${toolsText(g.tools)} — ${
    where
      ? `a call's path/file argument must be in folders it ${where}; a call that names no file runs anywhere`
      : "only calls that name no file (one that names a file asks)"
  }`;
}

/** Does `to` let more run without asking than `from`? */
function grantWidens(from, to) {
  if (!to) return false;
  const f = from || { tools: [], read: [], write: [] };
  return (
    to.tools.some((t) => !f.tools.includes(t)) ||
    to.read.some((p) => !f.read.includes(p)) ||
    to.write.some((p) => !f.write.includes(p))
  );
}

// A lead has no lead, so "allow" is plain for it.
const policyWords = (policy, lead) =>
  lead && policy === "allow"
    ? "runs every tool without asking"
    : POLICY_WORDS[policy];

const subText = (s) => oneLine(s.label || s.eventType);
/** Schedules, one per line, each prompt in a block of its own. */
const schedLines = (list) =>
  (list || []).map(
    (s) =>
      `- ${oneLine(s.cron)}${s.prompt ? `, asking:\n${block(s.prompt)}` : ""}`,
  );
const publishText = (p) =>
  `${oneLine(p.name)}${
    p.label && p.label !== p.name ? ` ("${oneLine(p.label)}")` : ""
  }${p.description ? ` — ${oneLine(p.description)}` : ""}`;
function commandsText(c, builtin) {
  return `Shell commands that run without asking: ${listOr(c.allowed, "none")}. Never run: ${listOr(c.blocked, "none")}. ${
    builtin === "all"
      ? ALWAYS_BLOCKED
      : "These only apply with built-in tools 'all', so they do nothing now."
  }`;
}

function startsText(def, hasLead) {
  const ways = [];
  if ((def.schedules || []).length) ways.push("on its schedules (below)");
  for (const s of def.subscriptions || []) ways.push(`when ${subText(s)}`);
  if (hasLead) ways.push("when its team lead asks it");
  return ways.length ? ways.join("; ") : "only when someone runs it";
}

/** A new bot: everything it saves. */
/** A bot's name by id among these bots (for summaries), else the id. */
const nameIn = (bots) => (id) => {
  const b = (bots || []).find((x) => x.id === id);
  return (b && b.name) || String(id);
};

function describeNew(
  def,
  { teamName, grants, ignored, startPaused, hasLead, nameOf = (id) => id },
) {
  const builtin = builtinOf(def);
  const lines = [
    `Create "${oneLine(def.name)}" on ${oneLine(teamName)}.`,
    `Model: ${oneLine(def.model || "the user's default")}${def.provider ? ` (${oneLine(def.provider)})` : ""}.`,
    `Built-in tools: ${BUILTIN_WORDS[builtin]}.`,
    `Approvals: ${policyWords(def.approvalPolicy || "ask", false)}.`,
  ];
  const servers = serversOf(def);
  if (!servers.length) lines.push("Providers: none.");
  else {
    lines.push("Providers:");
    const sel = selectionsOf(def);
    for (const name of servers) {
      const g = grants[name] || null;
      lines.push(
        `- ${oneLine(name)}: ${toolsText(sel[name] || null)}; runs without asking: ${grantText(g)}${
          g ? " (more access)" : ""
        }`,
      );
    }
  }
  for (const name of ignored) {
    lines.push(
      `- ${oneLine(name)}: the folders given do nothing without runWithoutAsking, so nothing is saved for them.`,
    );
  }
  lines.push(`Folders it works in: ${listOr(strings(def.projects), "none")}.`);
  lines.push(commandsText(commandsOf(def), builtin));
  lines.push(`Run limits: ${limitsText(limitsOf(def))}.`);
  lines.push(`It starts ${startsText(def, hasLead)}.`);
  const scheds = schedLines(def.schedules);
  if (scheds.length) lines.push("Schedules:", ...scheds);
  lines.push(
    `While paused: ${WHILE_PAUSED_WORDS[def.whilePaused || "queue"]}.`,
  );
  lines.push(
    `Results it publishes: ${
      (def.publishes || []).length
        ? def.publishes.map(publishText).join(", ")
        : "none"
    }.`,
  );
  lines.push(`Checks: ${checksText(def.checks, nameOf)}.`);
  lines.push(
    startPaused
      ? "It's saved paused: the user turns it on in Dash."
      : "It's on as soon as it's saved.",
  );
  lines.push("Instructions, in full:", block(def.instructions));
  return lines.join("\n");
}

/**
 * Only what changes, old → new, each with whether it gives the bot more
 * access. `removedTriggers`: triggers a move to another team takes off.
 * @returns {{ lines: string[], wider: string[] }}
 */
function describeChanges(
  bot,
  changes,
  grantChanges,
  { teamName, removedTriggers = [], nameOf = (id) => id },
) {
  const lines = [];
  const wider = [];
  const lead = isLead(bot);
  const line = (label, from, to, widens) => {
    lines.push(`- ${label}: ${from} → ${to}${widens ? " (more access)" : ""}`);
    if (widens) wider.push(label.toLowerCase());
  };
  for (const key of Object.keys(changes)) {
    const next = changes[key];
    switch (key) {
      case "name":
        line("Name", `"${oneLine(bot.name)}"`, `"${oneLine(next.name)}"`);
        break;
      case "instructions":
        lines.push(
          "- Instructions, before:",
          block(clip(bot.instructions)),
          "  now, in full:",
          block(next.instructions),
        );
        break;
      case "model":
        line(
          "Model",
          oneLine(bot.model || "the user's default"),
          oneLine(next.model || "the user's default"),
        );
        break;
      case "aiProvider":
        line(
          "AI provider",
          oneLine(bot.provider || "the user's default"),
          oneLine(next.provider || "the user's default"),
        );
        break;
      case "builtinTools": {
        const from = builtinOf(bot);
        const to = next.builtinTools || "all";
        line(
          "Built-in tools",
          BUILTIN_WORDS[from],
          BUILTIN_WORDS[to],
          BUILTIN_RANK[to] > BUILTIN_RANK[from],
        );
        break;
      }
      case "approvalPolicy": {
        const from = bot.approvalPolicy || "ask";
        line(
          "Approvals",
          policyWords(from, lead),
          policyWords(next.approvalPolicy, lead),
          POLICY_RANK[next.approvalPolicy] > POLICY_RANK[from],
        );
        break;
      }
      case "providers": {
        const was = serversOf(bot);
        const wasSel = selectionsOf(bot);
        const now = next.mcpServers;
        for (const name of now.filter((n) => !was.includes(n))) {
          line(
            `Provider ${oneLine(name)}`,
            "not used",
            toolsText(next.toolSelections[name] || null),
            true,
          );
        }
        for (const name of was.filter((n) => !now.includes(n))) {
          line(
            `Provider ${oneLine(name)}`,
            toolsText(wasSel[name] || null),
            "not used",
          );
        }
        for (const name of now.filter((n) => was.includes(n))) {
          const from = wasSel[name] || null;
          const to = next.toolSelections[name] || null;
          if (stable(from) === stable(to)) continue;
          const widens = !to || (from && to.some((t) => !from.includes(t)));
          line(
            `Provider ${oneLine(name)}`,
            toolsText(from),
            toolsText(to),
            !!widens,
          );
        }
        break;
      }
      case "commands": {
        const from = commandsOf(bot);
        const to = next.commands;
        if (stable(from.allowed) !== stable(to.allowed)) {
          line(
            "Commands that run without asking",
            listOr(from.allowed, "none"),
            listOr(to.allowed, "none"),
            to.allowed.some((c) => !from.allowed.includes(c)),
          );
        }
        if (stable(from.blocked) !== stable(to.blocked)) {
          line(
            "Commands that never run",
            listOr(from.blocked, "none"),
            listOr(to.blocked, "none"),
            from.blocked.some((c) => !to.blocked.includes(c)),
          );
        }
        break;
      }
      case "runLimits": {
        const from = limitsOf(bot);
        const to = next.runLimits;
        const raised = ["steps", "minutes", "costPerRun"].some(
          (k) => from[k] && (!to[k] || to[k] > from[k]),
        );
        line("Run limits", limitsText(from), limitsText(to), raised);
        break;
      }
      case "projects": {
        const from = strings(bot.projects);
        line(
          "Folders it works in",
          listOr(from, "none"),
          listOr(next.projects, "none"),
          next.projects.some((p) => !from.includes(p)),
        );
        break;
      }
      case "schedules": {
        const before = schedLines(bot.schedules);
        const now = schedLines(next.schedules);
        lines.push(
          "- Schedules, before:",
          ...(before.length ? before : ["  none"]),
          "  now:",
          ...(now.length ? now : ["  none"]),
        );
        break;
      }
      case "subscriptions":
        // A move took them off: said below, with the team they were on.
        if (removedTriggers.length) break;
        line(
          "What starts it",
          listOr((bot.subscriptions || []).map(subText), "nothing"),
          listOr(next.subscriptions.map(subText), "nothing"),
        );
        break;
      case "whilePaused":
        line(
          "While paused",
          WHILE_PAUSED_WORDS[bot.whilePaused || "queue"],
          WHILE_PAUSED_WORDS[next.whilePaused],
        );
        break;
      case "publishes":
        line(
          "Results it publishes",
          (bot.publishes || []).map(publishText).join(", ") || "none",
          next.publishes.map(publishText).join(", ") || "none",
        );
        break;
      case "team":
        line("Team", oneLine(teamName.from), oneLine(teamName.to));
        break;
      case "checks": {
        // Fewer checks, or no longer waiting for the user, hold its work
        // to less: said as more access.
        const from = cleanBotChecks(bot.checks);
        const to = next.checks;
        const count = (c) => (c ? c.steps.length : 0);
        const asksYou = (c) => !!c && c.steps.some((s) => s.kind === "you");
        line(
          "Checks",
          checksText(from, nameOf),
          checksText(to, nameOf),
          count(to) < count(from) || (asksYou(from) && !asksYou(to)),
        );
        break;
      }
      default:
        break;
    }
  }
  if (removedTriggers.length) {
    lines.push(
      `- Triggers removed (they were on ${oneLine(teamName.from)}): ${removedTriggers
        .map(subText)
        .join(", ")}`,
    );
  }
  for (const name of Object.keys(grantChanges)) {
    const { from, to } = grantChanges[name];
    line(
      `What ${oneLine(name)} runs without asking`,
      grantText(from),
      grantText(to),
      grantWidens(from, to),
    );
  }
  return { lines, wider };
}

// ---- grants ---------------------------------------------------------------

/**
 * The bot's grant with these providers' entries set — { tools, read,
 * write }: those tools run without asking, in those folders — or taken out
 * (null). Nothing else in the grant changes; no tool is ever added that
 * wasn't named.
 */
function withProviderGrants(perms, changes) {
  const next =
    perms && typeof perms === "object" ? JSON.parse(JSON.stringify(perms)) : {};
  next.grantOrigin = next.grantOrigin || "manual";
  next.servers = next.servers || {};
  for (const [name, g] of Object.entries(changes || {})) {
    if (!g || !g.tools.length) delete next.servers[name];
    else {
      next.servers[name] = {
        tools: [...g.tools],
        readPaths: [...g.read],
        writePaths: [...g.write],
      };
    }
  }
  return next;
}

// ---- handlers -------------------------------------------------------------

/**
 * @param {{ getWorkspaces: () => object[],
 *           bots: { list, pauseState, getGrant, setGrant, checkSave, save,
 *                   resume, takesMcpBots, asksBotPassphrase, tasks,
 *                   logAudit, sendNotice, afterSave, providerTools? },
 *           isOn?: (toolName: string) => boolean,
 *           now?: () => number, newId?: () => string,
 *           maxPending?: number }} deps
 */
/**
 * A settings change in words: { lines, names (the settings it changes),
 * wider (a folder setting a bot works in, changed) }.
 */
function describeSettings(before, next, { usedBy = {} } = {}) {
  const lines = [];
  const names = [];
  const wider = [];
  const show = (d, v) =>
    v === undefined || v === null || v === ""
      ? "no value"
      : d && d.type === "boolean"
        ? v
          ? "yes"
          : "no"
        : `"${oneLine(String(v))}"`;
  const valueOf = (t, d) =>
    t.values && Object.prototype.hasOwnProperty.call(t.values, d.name)
      ? t.values[d.name]
      : d.default;
  const old = new Map((before.declared || []).map((d) => [d.name, d]));
  const now = new Map((next.declared || []).map((d) => [d.name, d]));
  for (const d of next.declared || []) {
    const was = old.get(d.name);
    const label = `${oneLine(d.label || d.name)} ({${d.name}})`;
    if (!was) {
      lines.push(
        `- New setting ${label}: ${d.type}${
          d.default !== undefined ? `, default ${show(d, d.default)}` : ""
        }; value ${show(d, valueOf(next, d))}.`,
      );
      names.push(d.name);
      continue;
    }
    if (stable(was) !== stable(d)) {
      lines.push(
        `- ${label} is declared again: ${d.type}${
          d.default !== undefined ? `, default ${show(d, d.default)}` : ""
        }.`,
      );
      names.push(d.name);
    }
    const a = valueOf(before, was);
    const b = valueOf(next, d);
    if (stable(a) !== stable(b)) {
      const users = usedBy[d.name] || [];
      lines.push(
        `- ${label}: ${show(was, a)} → ${show(d, b)}${
          users.length ? ` (used by ${users.map(oneLine).join(", ")})` : ""
        }.`,
      );
      if (!names.includes(d.name)) names.push(d.name);
      if (d.type === "folder" && users.length) {
        wider.push(
          `${users.map(oneLine).join(", ")} may work in ${show(d, b)}`,
        );
      }
    }
  }
  for (const d of before.declared || []) {
    if (now.has(d.name)) continue;
    const users = usedBy[d.name] || [];
    lines.push(
      `- Remove the setting ${oneLine(d.label || d.name)} ({${d.name}})${
        users.length
          ? ` — ${users.map(oneLine).join(", ")} still use it, and their runs will fail until it's back`
          : ""
      }.`,
    );
    names.push(d.name);
  }
  return { lines, names, wider };
}

function makeBotToolHandlers({
  getWorkspaces,
  bots,
  isOn = () => true,
  now = () => Date.now(),
  newId = () => `botreq_${crypto.randomBytes(6).toString("hex")}`,
  maxPending = MAX_PENDING,
  pathArgKeys = PATH_ARG_KEYS,
  homeDir = os.homedir(),
}) {
  // Creates and changes waiting for the passphrase; kept in memory only.
  const pending = new Map();
  // One past its time is dropped whenever the list is looked at.
  const dropExpired = () => {
    const t = now();
    for (const [id, r] of pending) {
      if (Date.parse(r.expiresAt) <= t) pending.delete(id);
    }
  };

  const off = (name) => json({ status: "off", message: offText(name) }, true);
  const offText = (name) =>
    `${name} is turned off in Dash (Settings › MCP Server › Tools).`;

  const takes = (id) => {
    try {
      return !!bots.takesMcpBots(id);
    } catch (_e) {
      return false;
    }
  };
  const allowedTeams = (workspaces) => workspaces.filter((w) => takes(w.id));
  const teamNames = (teams) =>
    teams.map((w) => `${w.name || "Untitled"} (id ${w.id})`).join(", ");
  // A provider's tool names, or null when Dash can't list them.
  const providerTools = (name) => {
    try {
      const list = bots.providerTools ? bots.providerTools(name) : null;
      return Array.isArray(list) ? list : null;
    } catch (_e) {
      return null;
    }
  };

  const pausedSet = () => {
    try {
      const p = bots.pauseState() || {};
      return { all: !!p.global, ids: new Set(p.bots || []) };
    } catch (_e) {
      return { all: false, ids: new Set() };
    }
  };
  const grantOf = (id) => {
    try {
      return bots.getGrant(id) || null;
    } catch (_e) {
      return null;
    }
  };
  // Other bots one of whose triggers is this bot's event.
  const startedBy = (bot) =>
    bots
      .list()
      .filter(
        (b) =>
          b &&
          b.id !== bot.id &&
          (b.subscriptions || []).some(
            (sub) =>
              sub &&
              ((sub.source && sub.source.instanceId === bot.id) ||
                String(sub.eventType || "").includes(`[${bot.id}].`)),
          ),
      );
  const visibleBots = (teams) =>
    bots
      .list()
      .filter(
        (b) =>
          b && !isDashTeam(b) && teams.some((w) => sameId(w.id, b.workspaceId)),
      );

  /** A team by name or id: { team } on an allowed one, else { reply }. */
  const findTeam = (workspaces, query) => {
    const teams = allowedTeams(workspaces);
    if (!teams.length) {
      return {
        reply: json({
          status: "no-teams",
          message: `No team lets MCP clients see or change its bots yet. ${SET_UP_TEAMS}`,
        }),
      };
    }
    const found = resolveDashboard(teams, query);
    if (found.match) return { team: found.match, teams };
    if (found.ambiguous) {
      return {
        reply: json({
          status: "needs-team",
          message: `Several teams match "${query}": ${teamNames(found.ambiguous)}. Ask the user which, then call again with its id.`,
        }),
      };
    }
    const elsewhere = resolveDashboard(workspaces, query);
    return {
      reply: json({
        status: "needs-team",
        message: elsewhere.match
          ? `${elsewhere.match.name || "That team"} doesn't let MCP clients see or change its bots. ${SET_UP_TEAMS} Teams you can use: ${teamNames(teams)}.`
          : `No team matches "${query || ""}". Teams you can use: ${teamNames(teams)}.`,
      }),
    };
  };

  /** Passphrase asked for: a waiting request; otherwise save now. */
  const askOrSave = (request) => {
    let asks = true;
    try {
      asks = bots.asksBotPassphrase() !== false;
    } catch (_e) {
      asks = true;
    }
    if (!asks) return commit(request);
    const tasks = bots.tasks();
    if (!tasks.passphraseSet()) {
      return json({
        status: "needs-passphrase",
        summary: request.summary,
        message:
          "The user hasn't set a task passphrase, so nothing was saved. They can set one in Dash: Settings › MCP Server › Task passphrase.",
      });
    }
    const locked = tasks.lockedUntil();
    if (locked) {
      return json({
        status: "locked",
        message: `Changes over MCP are locked after 5 wrong passphrases until ${timeOf(
          locked,
        )}, so nothing was saved. The user can unlock them in Dash: Settings › MCP Server.`,
      });
    }
    dropExpired();
    if (pending.size >= maxPending) {
      return json({
        status: "busy",
        message: `${maxPending} changes are already waiting for the passphrase, so this one wasn't kept. Confirm those first or wait 10 minutes for them to expire.`,
      });
    }
    const id = newId();
    const expiresAt = new Date(now() + TASK_EXPIRES_MS).toISOString();
    pending.set(id, { ...request, id, expiresAt });
    return json({
      status: "waiting",
      requestId: id,
      expiresAt,
      summary: request.summary,
      message:
        "Show the user this whole summary, ask for their task passphrase, then call confirm_bot(requestId, passphrase).",
    });
  };

  /** Save it: the bot, what runs without asking, on or paused, audit, notice. */
  const commit = async (request) => {
    if (request.kind === "settings") return commitSettings(request);
    const { kind, from } = request;
    const tool = kind === "create" ? "create_bot" : "update_bot";
    if (!isOn(tool)) return off(tool);
    // Still allowed? A team could have been taken off the list since.
    const workspaces = getWorkspaces();
    if (!takes(request.teamId)) {
      return json({
        status: "failed",
        message: `That team no longer lets MCP clients change its bots, so nothing was saved. ${SET_UP_TEAMS}`,
      });
    }
    if (kind === "update") {
      const still = bots.list().find((b) => b && b.id === request.botId);
      if (!still || isDashTeam(still) || !takes(still.workspaceId)) {
        return json({
          status: "failed",
          message:
            "That bot isn't one you can change any more; nothing was saved.",
        });
      }
    }
    // Checked again on today's bots: another request confirmed meanwhile
    // can't leave a trigger reaching across teams.
    const current =
      kind === "update"
        ? bots.list().find((b) => b && b.id === request.botId)
        : null;
    const teamNow =
      request.definition.workspaceId != null
        ? request.definition.workspaceId
        : current && current.workspaceId;
    if (
      current &&
      request.definition.workspaceId != null &&
      !sameId(request.definition.workspaceId, current.workspaceId)
    ) {
      const starters = startedBy(current);
      if (starters.length) {
        return json({
          status: "failed",
          message: `${oneLine(starters.map((b) => b.name).join(", "))} now start${starters.length === 1 ? "s" : ""} when ${oneLine(current.name)} finishes, so it can't move to another team; nothing was saved.`,
        });
      }
    }
    const subs =
      request.definition.subscriptions ||
      (current && current.subscriptions) ||
      [];
    const across = subs.filter((sub) => {
      const src = sub && sub.source;
      if (!src || src.kind !== "bot") return false;
      const from = bots.list().find((b) => b && b.id === src.instanceId);
      return !from || !sameId(from.workspaceId, teamNow);
    });
    if (across.length) {
      return json({
        status: "failed",
        message:
          "A trigger now points at a bot on another team (or one that's gone), so nothing was saved. Ask again.",
      });
    }
    const check = bots.checkSave(request.definition) || {};
    if (check.errors && check.errors.length) {
      return json({
        status: "invalid",
        reasons: check.errors,
        message: "It wouldn't save now, so nothing was saved:",
      });
    }
    let saved;
    try {
      saved = bots.save(request.definition, {
        audit: { via: "mcp", ...(from ? { from } : {}) },
      });
    } catch (err) {
      return json({
        status: "failed",
        message: (err && err.message) || String(err),
      });
    }
    const id = saved.id;
    const names = Object.keys(request.grants || {});
    if (names.length) {
      const next = withProviderGrants(grantOf(id), request.grants);
      if (bots.setGrant(id, next) === true) {
        for (const provider of names) {
          bots.logAudit({
            type: request.grants[provider] ? "grant-saved" : "grant-revoked",
            botId: id,
            tool: null,
            provider,
          });
        }
      }
    }
    // A new bot is saved paused (botController.save): on now, unless asked.
    if (kind === "create" && !request.startPaused) bots.resume(id);
    if (kind === "update") {
      bots.logAudit({
        type: "bot-changed",
        botId: id,
        via: "mcp",
        ...(from ? { from } : {}),
        fields: request.fields,
      });
    }
    const by = from || "an app over MCP";
    bots.sendNotice({
      kind: kind === "create" ? "mcp-created" : "mcp-changed",
      botId: id,
      title:
        kind === "create" ? "Bot created over MCP" : "Bot changed over MCP",
      body: `${saved.name || "A bot"} was ${kind === "create" ? "created" : "changed"} by ${by}.`,
    });
    bots.afterSave();
    const paused = pausedSet();
    return json({
      status: kind === "create" ? "created" : "changed",
      bot: botView(saved, {
        workspaces,
        grant: grantOf(id),
        paused: paused.all || paused.ids.has(id),
      }),
      message:
        kind === "create"
          ? `${saved.name} was created${request.startPaused ? " paused — the user turns it on in Dash" : " and is on"}.`
          : `${saved.name} was changed.`,
    });
  };

  /** A team's settings for list_bots: { declared, values, usedBy }. */
  const settingsOf = (teamId) => {
    try {
      const t = bots.teamValues ? bots.teamValues(teamId) : null;
      return t && Array.isArray(t.declared) && t.declared.length ? t : null;
    } catch (_e) {
      return null;
    }
  };

  /** Save a team's settings (set_team_settings, confirmed). */
  const commitSettings = (request) => {
    const tool = "set_team_settings";
    if (!isOn(tool)) return off(tool);
    if (!takes(request.teamId)) {
      return json({
        status: "failed",
        message: `That team no longer lets MCP clients change its bots, so nothing was saved. ${SET_UP_TEAMS}`,
      });
    }
    if (typeof request.usesHandoffs === "boolean" && bots.setUsesHandoffs) {
      bots.setUsesHandoffs(request.teamId, request.usesHandoffs);
    }
    const saved =
      request.change && Object.keys(request.change).length
        ? bots.setTeamValues(request.teamId, request.change)
        : bots.teamValues(request.teamId) || { declared: [], values: {} };
    if (!saved || (saved.errors && saved.errors.length)) {
      return json({
        status: "invalid",
        reasons: (saved && saved.errors) || ["It couldn't be saved."],
        message: "It wouldn't save now, so nothing was saved:",
      });
    }
    const by = request.from || "an app over MCP";
    // Each bot that uses a changed setting: in its audit log.
    const changed = new Set(request.names);
    for (const bot of visibleBots(
      getWorkspaces().filter((w) => sameId(w.id, request.teamId)),
    )) {
      const uses = Object.entries(saved.usedBy || {}).some(
        ([n, list]) => changed.has(n) && list.includes(bot.name || bot.id),
      );
      if (!uses) continue;
      bots.logAudit({
        type: "bot-changed",
        botId: bot.id,
        via: "mcp",
        ...(request.from ? { from: request.from } : {}),
        fields: ["team settings"],
      });
    }
    bots.sendNotice({
      kind: "mcp-changed",
      botId: null,
      title: "Team settings changed over MCP",
      body: `${request.teamName}'s settings were changed by ${by}.`,
    });
    return json({
      status: "changed",
      settings: saved,
      message: `${request.teamName}'s settings were changed.`,
    });
  };

  return {
    async list_bots(args = {}) {
      if (!isOn("list_bots")) return off("list_bots");
      const workspaces = getWorkspaces();
      let teams = allowedTeams(workspaces);
      if (!teams.length) {
        return json({
          bots: [],
          message: `No team lets MCP clients see its bots yet. ${SET_UP_TEAMS}`,
        });
      }
      if (args && args.team) {
        const found = findTeam(workspaces, args.team);
        if (found.reply) return found.reply;
        teams = [found.team];
      }
      const paused = pausedSet();
      return json({
        bots: visibleBots(teams).map((b) =>
          botView(b, {
            workspaces,
            grant: grantOf(b.id),
            paused: paused.all || paused.ids.has(b.id),
          }),
        ),
        teams: teams.map((w) => {
          const settings = settingsOf(w.id);
          return {
            id: String(w.id),
            name: w.name || "Untitled",
            ...(settings ? { settings } : {}),
            ...(bots.usesHandoffs && bots.usesHandoffs(w.id)
              ? { usesHandoffs: true }
              : {}),
          };
        }),
      });
    },

    async check_team_setup(args = {}) {
      if (!isOn("check_team_setup")) return off("check_team_setup");
      const workspaces = getWorkspaces();
      const found = findTeam(workspaces, (args || {}).team);
      if (found.reply) return found.reply;
      if (!bots.checkSetup) {
        return json({ error: "This version of Dash can't check a setup." });
      }
      const res = await bots.checkSetup(found.team.id);
      return json({
        team: found.team.name || "Untitled",
        ok: !!res.ok,
        problems: (res.problems || []).map((p) => ({
          kind: p.kind,
          ...(p.bot ? { bot: p.bot } : {}),
          ...(p.repo ? { repo: p.repo } : {}),
          message: p.message,
        })),
        message: res.text,
      });
    },

    async set_team_settings(args = {}) {
      if (!isOn("set_team_settings")) return off("set_team_settings");
      args = args || {};
      const workspaces = getWorkspaces();
      const found = findTeam(workspaces, args.team);
      if (found.reply) return found.reply;
      const ws = found.team;
      const change = {};
      if (args.declare !== undefined) change.declare = args.declare;
      if (args.values !== undefined) change.values = args.values;
      if (args.remove !== undefined) change.remove = args.remove;
      const handoffs =
        typeof args.usesHandoffs === "boolean" ? args.usesHandoffs : null;
      if (!Object.keys(change).length && handoffs === null) {
        return json(
          {
            status: "invalid",
            message:
              "Give declare, values, remove or usesHandoffs: nothing to change.",
          },
          true,
        );
      }
      if (!bots.setTeamValues || !bots.teamValues) {
        return json(
          { status: "failed", message: "Team settings need a newer Dash." },
          true,
        );
      }
      const before = bots.teamValues(ws.id) || { declared: [], values: {} };
      let lines = [];
      let names = [];
      let wider = [];
      if (Object.keys(change).length) {
        const next = bots.setTeamValues(ws.id, change, { dryRun: true });
        if (!next || (next.errors && next.errors.length)) {
          return json({
            status: "invalid",
            reasons: (next && next.errors) || ["It couldn't be checked."],
            message: "It wouldn't save, so nothing was saved:",
          });
        }
        ({ lines, names, wider } = describeSettings(before, next, {
          usedBy: before.usedBy || {},
        }));
      }
      if (
        handoffs !== null &&
        bots.usesHandoffs &&
        bots.usesHandoffs(ws.id) !== handoffs
      ) {
        lines = [
          ...lines,
          handoffs
            ? "- Turn on the standard handoff: Dash checks each bot's handoff first, handles none / ask / split, and gives the next bot the job's context."
            : "- Turn off the standard handoff: bots hand on their raw answers again.",
        ];
      }
      if (!lines.length) {
        return json({
          status: "unchanged",
          message: `${ws.name || "That team"} already has all of that; nothing to change.`,
        });
      }
      const summary = [
        `Change the settings of ${oneLine(ws.name || "the team")}:`,
        ...lines,
        ...(wider.length
          ? [`This gives bots more access (${wider.join("; ")}).`]
          : []),
      ].join("\n");
      return askOrSave({
        kind: "settings",
        teamId: String(ws.id),
        teamName: ws.name || "The team",
        change,
        ...(handoffs !== null ? { usesHandoffs: handoffs } : {}),
        names,
        from: cleanFrom(args.from),
        summary,
      });
    },

    async create_bot(args = {}) {
      if (!isOn("create_bot")) return off("create_bot");
      args = args || {};
      if (args.role === "lead" || args.system) {
        return json(
          {
            status: "invalid",
            message:
              "Team leads and Dash team bots are made by Dash; MCP clients can't create them.",
          },
          true,
        );
      }
      const workspaces = getWorkspaces();
      const found = findTeam(workspaces, args.team);
      if (found.reply) return found.reply;
      const ws = found.team;
      const members = visibleBots([ws]);
      const { fields, access, problems, notes } = readFields(args, {
        members,
        dashboard: ws,
        providerTools,
        pathArgKeys,
        homeDir,
      });
      if (!fields.name) problems.unshift("name is required.");
      if (problems.length) {
        return json({
          status: "invalid",
          reasons: problems,
          message: "Nothing was saved:",
        });
      }
      const pick = (k) => (fields[k] ? fields[k] : {});
      // As the form saves a new bot; MCP's new bots use no built-in tools
      // unless asked.
      const definition = {
        name: "",
        instructions: "",
        provider: null,
        model: null,
        approvalPolicy: "ask",
        builtinTools: "none",
        workspaceId: String(ws.id),
        mcpServers: [],
        projects: [],
        commands: { allowed: [], blocked: [] },
        toolSelections: {},
        schedules: [],
        subscriptions: [],
        whilePaused: "queue",
        publishes: [],
        runLimits: {},
        ...pick("name"),
        ...pick("instructions"),
        ...pick("model"),
        ...pick("aiProvider"),
        ...pick("builtinTools"),
        ...pick("approvalPolicy"),
        ...pick("providers"),
        ...pick("commands"),
        ...pick("runLimits"),
        ...pick("projects"),
        ...pick("schedules"),
        ...pick("subscriptions"),
        ...pick("whilePaused"),
        ...pick("publishes"),
        ...pick("checks"),
      };
      // Only tools named in runWithoutAsking ever run without asking.
      const grants = {};
      const ignored = [];
      for (const [name, a] of Object.entries(access)) {
        if (a.tools && a.tools.length) {
          grants[name] = {
            tools: a.tools,
            read: a.read || [],
            write: a.write || [],
          };
        } else if (a.read || a.write) ignored.push(name);
      }
      const check = bots.checkSave(definition) || {};
      if (check.errors && check.errors.length) {
        return json({
          status: "invalid",
          reasons: check.errors,
          message: "It wouldn't save, so nothing was saved:",
        });
      }
      const startPaused = args.startPaused === true;
      const hasLead = members.some(isLead);
      return askOrSave({
        kind: "create",
        definition,
        grants,
        startPaused,
        from: cleanFrom(args.from),
        teamId: String(ws.id),
        summary: [
          describeNew(definition, {
            teamName: ws.name || "Untitled",
            grants,
            ignored,
            startPaused,
            hasLead,
            nameOf: nameIn(members),
          }),
          ...(notes || []),
        ].join("\n"),
      });
    },

    async update_bot(args = {}) {
      if (!isOn("update_bot")) return off("update_bot");
      args = args || {};
      const workspaces = getWorkspaces();
      const teams = allowedTeams(workspaces);
      if (!teams.length) {
        return json({
          status: "no-teams",
          message: `No team lets MCP clients change its bots yet. ${SET_UP_TEAMS}`,
        });
      }
      const ref = String(args.bot || "").trim();
      const visible = visibleBots(teams);
      let bot = visible.find((b) => b.id === ref);
      if (!bot) {
        const named = visible.filter((b) => lower(b.name) === lower(ref));
        if (named.length > 1) {
          return json({
            status: "needs-bot",
            message: `Several bots are named "${ref}": ${named
              .map((b) => `${b.name} (id ${b.id})`)
              .join(", ")}. Call again with its id.`,
          });
        }
        bot = named[0];
      }
      if (!bot) {
        return json({
          status: "needs-bot",
          message: `No bot you can change matches "${ref}". list_bots shows them.`,
        });
      }
      if (args.role !== undefined && args.role !== bot.role) {
        return json(
          {
            status: "invalid",
            message: "A bot's role can't be changed over MCP.",
          },
          true,
        );
      }
      let target = workspaces.find((w) => sameId(w.id, bot.workspaceId));
      const lead = isLead(bot);
      const problems = [];
      if (args.team !== undefined && args.team !== null) {
        const found = findTeam(workspaces, args.team);
        if (found.reply) return found.reply;
        if (!sameId(found.team.id, bot.workspaceId)) {
          if (lead) problems.push("A team lead stays on its own team.");
          else {
            target = found.team;
            const starters = startedBy(bot);
            if (starters.length) {
              const here = workspaces.find((w) =>
                sameId(w.id, bot.workspaceId),
              );
              problems.push(
                `${starters.map((b) => oneLine(b.name)).join(" and ")} on ${oneLine(
                  (here && here.name) || "its team",
                )} ${starters.length === 1 ? "starts" : "start"} when ${oneLine(
                  bot.name,
                )} finishes — remove ${starters.length === 1 ? "that trigger" : "those triggers"} first.`,
              );
            }
          }
        }
      }
      if (lead && args.builtinTools !== undefined) {
        problems.push("A team lead's built-in tools are set by Dash.");
      }
      const dashboard = target || { id: bot.workspaceId };
      const read = readFields(args, {
        current: bot,
        members: visibleBots([dashboard]),
        selfId: bot.id,
        dashboard,
        providerTools,
        pathArgKeys,
        homeDir,
      });
      problems.push(...read.problems);
      if (problems.length) {
        return json({
          status: "invalid",
          reasons: problems,
          message: "Nothing was saved:",
        });
      }
      // Only what really changes.
      const currentOf = {
        name: { name: bot.name },
        instructions: { instructions: bot.instructions || "" },
        model: { model: bot.model || null },
        aiProvider: { provider: bot.provider || null },
        builtinTools: {
          builtinTools: builtinOf(bot) === "all" ? null : builtinOf(bot),
        },
        approvalPolicy: { approvalPolicy: bot.approvalPolicy || "ask" },
        providers: {
          mcpServers: serversOf(bot),
          toolSelections: selectionsOf(bot),
        },
        commands: { commands: commandsOf(bot) },
        runLimits: { runLimits: limitsOf(bot) },
        projects: { projects: strings(bot.projects) },
        schedules: { schedules: bot.schedules || [] },
        subscriptions: { subscriptions: bot.subscriptions || [] },
        whilePaused: { whilePaused: bot.whilePaused || "queue" },
        publishes: { publishes: bot.publishes || [] },
        checks: { checks: cleanBotChecks(bot.checks) },
      };
      const changes = {};
      for (const [k, frag] of Object.entries(read.fields)) {
        const same =
          k === "providers"
            ? stable(sorted(frag.mcpServers)) ===
                stable(sorted(currentOf.providers.mcpServers)) &&
              stable(frag.toolSelections) ===
                stable(currentOf.providers.toolSelections)
            : stable(frag) === stable(currentOf[k]);
        if (!same) changes[k] = frag;
      }
      let removedTriggers = [];
      if (target && !sameId(target.id, bot.workspaceId)) {
        changes.team = { workspaceId: String(target.id) };
        // Its triggers on the old team don't follow it — the new
        // subscriptions given were resolved on the new team already.
        if (!read.fields.subscriptions) {
          const subs = bot.subscriptions || [];
          const stays = (sub) =>
            sub && sub.source && sameId(sub.source.workspaceId, target.id);
          removedTriggers = subs.filter((sub) => !stays(sub));
          if (removedTriggers.length) {
            changes.subscriptions = { subscriptions: subs.filter(stays) };
          }
        }
      }
      // What runs without asking: as given, over what it had; a provider
      // it no longer uses keeps nothing.
      const grant = grantOf(bot.id);
      const grantChanges = {};
      for (const [name, a] of Object.entries(read.access)) {
        const from = grantEntryOf(grant, name);
        const tools = a.tools || (from ? from.tools : []);
        const to = tools.length
          ? {
              tools,
              read: a.read || (from ? from.read : []),
              write: a.write || (from ? from.write : []),
            }
          : null;
        if (stable(from) !== stable(to)) grantChanges[name] = { from, to };
      }
      if (read.fields.providers) {
        for (const name of serversOf(bot)) {
          if (read.fields.providers.mcpServers.includes(name)) continue;
          const from = grantEntryOf(grant, name);
          if (from) grantChanges[name] = { from, to: null };
        }
      }
      const fields = [
        ...Object.keys(changes),
        ...(Object.keys(grantChanges).length ? ["runWithoutAsking"] : []),
      ];
      if (!fields.length) {
        return json({
          status: "unchanged",
          message: `${bot.name} already has all of that; nothing to change.`,
        });
      }
      const definition = { id: bot.id };
      for (const frag of Object.values(changes))
        Object.assign(definition, frag);
      const check = bots.checkSave(definition) || {};
      if (check.errors && check.errors.length) {
        return json({
          status: "invalid",
          reasons: check.errors,
          message: "It wouldn't save, so nothing was saved:",
        });
      }
      const fromTeam = workspaces.find((w) => sameId(w.id, bot.workspaceId));
      const { lines, wider } = describeChanges(bot, changes, grantChanges, {
        teamName: {
          from: (fromTeam && fromTeam.name) || "no team",
          to: (target && target.name) || "no team",
        },
        removedTriggers,
        nameOf: nameIn(visibleBots(workspaces)),
      });
      const summary = [
        `Change "${oneLine(bot.name)}"${fromTeam ? ` on ${oneLine(fromTeam.name)}` : ""}:`,
        ...lines,
        ...(wider.length
          ? [`This gives it more access (${wider.join("; ")}).`]
          : []),
      ].join("\n");
      const grants = {};
      for (const [name, c] of Object.entries(grantChanges)) grants[name] = c.to;
      return askOrSave({
        kind: "update",
        botId: bot.id,
        definition,
        grants,
        fields,
        from: cleanFrom(args.from),
        teamId: String((target && target.id) || bot.workspaceId),
        summary: [summary, ...(read.notes || [])].join("\n"),
      });
    },

    async confirm_bot(args = {}) {
      if (!isOn("confirm_bot")) return off("confirm_bot");
      const id = String((args && args.requestId) || "");
      const request = pending.get(id);
      if (request && Date.parse(request.expiresAt) <= now()) {
        dropExpired();
        return json({
          requestId: id,
          status: "expired",
          message:
            "It expired before the passphrase was given; nothing was saved. Call create_bot or update_bot again if the user still wants it.",
        });
      }
      dropExpired();
      if (!request) {
        return json(
          { message: "No waiting request with that requestId." },
          true,
        );
      }
      const tool =
        request.kind === "create"
          ? "create_bot"
          : request.kind === "settings"
            ? "set_team_settings"
            : "update_bot";
      if (!isOn(tool)) {
        pending.delete(id);
        return off(tool);
      }
      const check = bots.tasks().verify(args.passphrase);
      if (check.notSet) {
        pending.delete(id);
        return json({
          requestId: id,
          status: "needs-passphrase",
          message:
            "The user hasn't set a task passphrase, so nothing was saved. They can set one in Dash: Settings › MCP Server › Task passphrase.",
        });
      }
      if (check.locked) {
        const why = check.wrong
          ? "That passphrase isn't right either, and that was 5 wrong ones"
          : "There were 5 wrong passphrases";
        return json({
          requestId: id,
          status: "locked",
          message: `${why}: changes over MCP are locked until ${timeOf(
            check.locked,
          )}. The user can unlock them in Dash: Settings › MCP Server.`,
        });
      }
      if (check.wrong) {
        return json({
          requestId: id,
          status: "waiting",
          message: `That passphrase isn't right. ${check.triesLeft} ${
            check.triesLeft === 1 ? "try" : "tries"
          } left before changes lock for 15 minutes. Ask the user to say it again.`,
        });
      }
      pending.delete(id);
      return commit(request);
    },

    // For tests: how many requests are waiting.
    _pendingCount: () => pending.size,
  };
}

/** Register the bot tools with the Dash MCP server (app startup). */
function registerBotTools() {
  const mcpServer = require("../controller/mcpDashServerController");
  const workspaceController = require("../controller/workspaceController");
  const botController = require("../controller/botController");
  const grantStore = require("./grantedPermissions");
  const mcpController = require("../controller/mcpController");

  const handlers = makeBotToolHandlers({
    getWorkspaces: () => {
      const ctx = mcpServer.getServerContext();
      if (!ctx)
        throw new Error("MCP server is not running or has no active window");
      const result = workspaceController.listWorkspacesForApplication(
        ctx.win,
        ctx.appId,
      );
      return (result && result.workspaces) || [];
    },
    isOn: (name) => mcpServer.isToolOn(name),
    bots: {
      list: () => botController.list(),
      pauseState: () => botController.getPauseState(),
      getGrant: (id) => grantStore.getGrant(id),
      setGrant: (id, grant) => grantStore.setGrant(id, grant),
      checkSave: (definition) => botController.checkSave(definition),
      save: (definition, opts) => botController.save(definition, opts),
      resume: (id) => botController.resumeBot(id),
      takesMcpBots: (id) => botController.takesMcpBots(id),
      asksBotPassphrase: () => botController.asksBotPassphrase(),
      tasks: () => botController.mcpTasks(),
      logAudit: (entry) => botController.logAudit(entry),
      sendNotice: (notice) => botController.sendNotice(notice),
      afterSave: () => botController.afterSave(),
      // A team's settings (DASH-57).
      teamValues: (id) => botController.teamValues(id),
      // The standard handoff (DASH-101).
      usesHandoffs: (id) => botController.usesHandoffs(id),
      setUsesHandoffs: (id, on) => botController.setUsesHandoffs(id, on),
      // The team's setup, checked (DASH-108).
      checkSetup: (id) => botController.checkSetup(id),
      setTeamValues: (id, change, opts) =>
        botController.setTeamValues(id, change, opts),
      // The user's providers and the tools each lists (null until it's
      // connected) — what runWithoutAsking is checked against.
      providerTools: (name) => {
        const p = (botController.listToolSources() || []).find(
          (s) => s && s.name === name,
        );
        if (!p || !Array.isArray(p.tools)) return null;
        const live = (mcpController.listConnectedServers() || []).find(
          (c) => c && c.serverName === name,
        );
        const schemas = new Map(
          ((live && live.tools) || [])
            .filter((t) => t && t.name)
            .map((t) => [t.name, t.inputSchema || null]),
        );
        return p.tools.map((t) => ({
          name: t,
          inputSchema: schemas.get(t) || null,
        }));
      },
    },
    pathArgKeys: require("./permissionGate").PATH_ARG_KEYS,
  });

  for (const tool of BOT_TOOLS) {
    mcpServer.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.defaultOff ? { defaultOff: true } : {}),
      ...(tool.onWith ? { onWith: tool.onWith } : {}),
      handler: (args) => handlers[tool.name](args),
    });
  }
}

module.exports = {
  BOT_TOOLS,
  makeBotToolHandlers,
  registerBotTools,
  withProviderGrants,
  describeNew,
  describeSettings,
};
