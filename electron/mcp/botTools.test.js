/**
 * botTools.test.js — list, create and change bots over MCP (DASH-37), with
 * injected fakes: which teams' bots show, what can't be made or changed,
 * the save check, the task passphrase (the real mcpTasks verify and lock),
 * folder grants, the summary, and a tool that's turned off.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeBotToolHandlers, BOT_TOOLS } = require("./botTools");
const { createMcpTasks } = require("../bots/mcpTasks");
const { botEventType } = require("../bots/botEvents");

// Running providers' tools, as Dash sees them: names and inputs.
const withInputs = (names, properties) =>
  names.map((name) => ({ name, inputSchema: { properties } }));

const workspaces = [
  {
    id: 1,
    name: "Sales",
    layout: [
      { id: 5, component: "Inbox", title: "Inbox" },
      {
        id: 6,
        component: "Grid",
        items: [{ id: 7, component: "Chart", title: "Pipeline" }],
      },
    ],
  },
  { id: 2, name: "Ops" },
  { id: 3, name: "Private" },
];

const baseBots = () => [
  { id: "lead_sales", role: "lead", workspaceId: "1", name: "Sales Lead" },
  {
    id: "b_writer",
    workspaceId: "1",
    name: "Writer",
    instructions: "Write the weekly report.",
    builtinTools: "read-only",
    approvalPolicy: "ask",
    mcpServers: ["Gmail", "Files"],
    toolSelections: { Gmail: ["search_emails", "send_email"] },
    runLimits: { steps: 20 },
  },
  { id: "b_private", workspaceId: "3", name: "Diary" },
  // botController.list() leaves these out; the tools do too.
  { id: "dash_lead", system: "dash-team", role: "dashlead", name: "Dash Lead" },
];

function setup(over = {}) {
  let clock = Date.parse("2026-11-21T12:00:00.000Z");
  let n = 0;
  const state = {
    bots: baseBots(),
    grants: {
      b_writer: {
        servers: {
          Files: {
            tools: ["read_file"],
            readPaths: ["/notes"],
            writePaths: [],
          },
        },
      },
    },
    takes: new Set(["1", "2"]),
    asks: true,
    phrase: "purple otter",
    lock: null,
    paused: { global: false, bots: ["b_writer"] },
    saves: [],
    resumed: [],
    audit: [],
    notices: [],
    afterSave: 0,
    checks: [],
    ...over.state,
  };
  const tasks = createMcpTasks({
    store: {
      loadTasks: () => [],
      saveTasks: () => {},
      getPassphrase: () => state.phrase,
      getLock: () => state.lock,
      saveLock: (l) => {
        state.lock = l;
      },
    },
    now: () => clock,
  });
  const on = new Set(
    over.on || ["list_bots", "create_bot", "update_bot", "confirm_bot"],
  );
  const handlers = makeBotToolHandlers({
    getWorkspaces: () => workspaces,
    isOn: (name) => on.has(name),
    now: () => clock,
    newId: () => `req_${++n}`,
    ...(over.maxPending ? { maxPending: over.maxPending } : {}),
    ...(over.homeDir ? { homeDir: over.homeDir } : {}),
    bots: {
      providerTools:
        over.providerTools ||
        ((name) =>
          ({
            Gmail: withInputs(["search_emails", "send_email", "read_mail"], {
              query: {},
            }),
            Files: withInputs(["read_file", "write_file", "list_directory"], {
              path: {},
            }),
          })[name] || null),
      list: () => state.bots,
      pauseState: () => state.paused,
      getGrant: (id) => state.grants[id] || null,
      setGrant: (id, g) => {
        state.grants[id] = g;
        return true;
      },
      checkSave: (def) => {
        state.checks.push(def);
        return over.checkSave ? over.checkSave(def) : { errors: [] };
      },
      save: (def, opts) => {
        state.saves.push({ def, opts });
        if (def.id) {
          const i = state.bots.findIndex((b) => b.id === def.id);
          state.bots[i] = { ...state.bots[i], ...def };
          return state.bots[i];
        }
        const bot = { ...def, id: `bot_new${state.saves.length}` };
        state.bots.push(bot);
        return bot;
      },
      resume: (id) => state.resumed.push(id),
      takesMcpBots: (id) => state.takes.has(String(id)),
      asksBotPassphrase: () => state.asks,
      tasks: () => tasks,
      logAudit: (e) => state.audit.push(e),
      sendNotice: (x) => state.notices.push(x),
      afterSave: () => {
        state.afterSave += 1;
      },
    },
  });
  return {
    handlers,
    state,
    on,
    tick: (ms) => {
      clock += ms;
    },
  };
}
const body = (r) => JSON.parse(r.content[0].text);

const newBot = (extra = {}) => ({
  name: "Digest",
  team: "Sales",
  instructions: "Sum up the day.",
  from: "voice-assistant",
  ...extra,
});

describe("list_bots", () => {
  it("lists only the chosen teams' bots, never the Dash team's", async () => {
    const { handlers } = setup();
    const b = body(await handlers.list_bots({}));
    assert.deepEqual(
      b.bots.map((x) => x.id),
      ["lead_sales", "b_writer"],
    );
    const writer = b.bots[1];
    assert.equal(writer.role, "member");
    assert.equal(writer.paused, true);
    assert.deepEqual(writer.team, { id: "1", name: "Sales" });
    assert.equal(writer.builtinTools, "read-only");
    assert.deepEqual(writer.providers, [
      {
        name: "Gmail",
        tools: ["search_emails", "send_email"],
        runWithoutAsking: [],
        readFolders: [],
        writeFolders: [],
      },
      {
        name: "Files",
        tools: null,
        runWithoutAsking: ["read_file"],
        readFolders: ["/notes"],
        writeFolders: [],
      },
    ]);
    assert.equal(writer.instructions, "Write the weekly report.");
    assert.equal(b.bots[0].role, "lead");
  });

  it("narrows to one team, and names a team it can't see", async () => {
    const { handlers } = setup();
    const ops = body(await handlers.list_bots({ team: "ops" }));
    assert.deepEqual(ops.bots, []);
    const hidden = body(await handlers.list_bots({ team: "Private" }));
    assert.equal(hidden.status, "needs-team");
    assert.match(hidden.message, /doesn't let MCP clients/);
  });

  it("says how to choose teams when none is chosen", async () => {
    const { handlers } = setup({ state: { takes: new Set() } });
    const b = body(await handlers.list_bots({}));
    assert.deepEqual(b.bots, []);
    assert.match(b.message, /Which teams/);
  });
});

describe("create_bot", () => {
  it("refuses leads, Dash team bots and teams not chosen", async () => {
    const { handlers, state } = setup();
    const lead = await handlers.create_bot(newBot({ role: "lead" }));
    assert.equal(lead.isError, true);
    const dash = await handlers.create_bot(newBot({ system: "dash-team" }));
    assert.equal(dash.isError, true);
    const priv = body(await handlers.create_bot(newBot({ team: "Private" })));
    assert.equal(priv.status, "needs-team");
    assert.equal(state.saves.length, 0);
  });

  it("a bot that wouldn't save comes back with every reason, nothing waiting", async () => {
    const { handlers, state } = setup({
      checkSave: () => ({
        errors: ['"Nope" isn\'t one of your connections.', "bad cron"],
      }),
    });
    const b = body(await handlers.create_bot(newBot()));
    assert.equal(b.status, "invalid");
    assert.equal(b.reasons.length, 2);
    assert.equal(b.requestId, undefined);
    assert.equal(state.saves.length, 0);
    // Nothing was kept to confirm.
    const c = await handlers.confirm_bot({
      requestId: "req_1",
      passphrase: "purple otter",
    });
    assert.equal(c.isError, true);
  });

  it("waits for the passphrase; a wrong one keeps it waiting, the right one saves it on", async () => {
    const { handlers, state } = setup();
    const w = body(
      await handlers.create_bot(
        newBot({
          builtinTools: "none",
          providers: [
            { name: "Gmail", tools: ["search_emails", "send_email"] },
          ],
          runLimits: { steps: 10, minutes: 5 },
          schedules: [{ cron: "0 8 * * *", prompt: "Morning digest" }],
        }),
      ),
    );
    assert.equal(w.status, "waiting");
    assert.equal(w.requestId, "req_1");
    assert.match(w.message, /confirm_bot/);
    assert.match(w.summary, /Create "Digest" on Sales/);
    assert.match(
      w.summary,
      /Gmail: search_emails, send_email \(send_email changes or sends things\)/,
    );
    assert.match(w.summary, /up to 10 steps, 5 minutes a run/);
    assert.match(
      w.summary,
      /Schedules:\n- 0 8 \* \* \*, asking:\n {4}\| Morning digest/,
    );
    assert.match(w.summary, /when its team lead asks it/);
    assert.match(w.summary, /on as soon as it's saved/);
    assert.equal(state.saves.length, 0);

    const wrong = body(
      await handlers.confirm_bot({
        requestId: "req_1",
        passphrase: "blue fox",
      }),
    );
    assert.equal(wrong.status, "waiting");
    assert.match(wrong.message, /4 tries left/);
    assert.equal(state.saves.length, 0);

    const ok = body(
      await handlers.confirm_bot({
        requestId: "req_1",
        passphrase: "Purple, Otter.",
      }),
    );
    assert.equal(ok.status, "created");
    assert.equal(state.saves.length, 1);
    const { def, opts } = state.saves[0];
    assert.equal(def.workspaceId, "1");
    assert.equal(def.builtinTools, "none");
    assert.deepEqual(def.mcpServers, ["Gmail"]);
    assert.deepEqual(def.toolSelections, {
      Gmail: ["search_emails", "send_email"],
    });
    assert.equal(def.role, undefined);
    assert.deepEqual(opts.audit, { via: "mcp", from: "voice-assistant" });
    assert.deepEqual(state.resumed, [ok.bot.id]);
    assert.deepEqual(state.notices[0], {
      kind: "mcp-created",
      botId: ok.bot.id,
      title: "Bot created over MCP",
      body: "Digest was created by voice-assistant.",
    });
    assert.equal(state.afterSave, 1);
    // Used once.
    const again = await handlers.confirm_bot({
      requestId: "req_1",
      passphrase: "purple otter",
    });
    assert.equal(again.isError, true);
  });

  it("expires after 10 minutes", async () => {
    const { handlers, state, tick } = setup();
    body(await handlers.create_bot(newBot()));
    tick(10 * 60 * 1000 + 1);
    const b = body(
      await handlers.confirm_bot({
        requestId: "req_1",
        passphrase: "purple otter",
      }),
    );
    assert.equal(b.status, "expired");
    assert.equal(state.saves.length, 0);
  });

  it("locks after 5 wrong passphrases, shared with tasks", async () => {
    const { handlers, state } = setup();
    body(await handlers.create_bot(newBot()));
    let last;
    for (let i = 0; i < 5; i++) {
      last = body(
        await handlers.confirm_bot({ requestId: "req_1", passphrase: "nope" }),
      );
    }
    assert.equal(last.status, "locked");
    assert.ok(state.lock && state.lock.until);
    const right = body(
      await handlers.confirm_bot({
        requestId: "req_1",
        passphrase: "purple otter",
      }),
    );
    assert.equal(right.status, "locked");
    // A new request while locked is refused at once.
    const fresh = body(await handlers.create_bot(newBot({ name: "Other" })));
    assert.equal(fresh.status, "locked");
    assert.equal(state.saves.length, 0);
  });

  it("no passphrase set: says so and keeps nothing", async () => {
    const { handlers, state } = setup({ state: { phrase: null } });
    const b = body(await handlers.create_bot(newBot()));
    assert.equal(b.status, "needs-passphrase");
    assert.match(b.message, /hasn't set a task passphrase/);
    assert.equal(b.requestId, undefined);
    assert.equal(state.saves.length, 0);
  });

  it("passphrase off: saves at once", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(await handlers.create_bot(newBot()));
    assert.equal(b.status, "created");
    assert.equal(state.saves.length, 1);
    assert.equal(state.resumed.length, 1);
  });

  it("startPaused leaves it paused", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(await handlers.create_bot(newBot({ startPaused: true })));
    assert.equal(b.status, "created");
    assert.deepEqual(state.resumed, []);
    assert.match(b.message, /paused/);
  });

  it("a { bot, event } trigger becomes that bot's event on its team", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    await handlers.create_bot(
      newBot({ subscriptions: [{ bot: "writer", event: "completed" }] }),
    );
    const sub = state.saves[0].def.subscriptions[0];
    const writer = state.bots.find((x) => x.id === "b_writer");
    assert.equal(sub.eventType, botEventType(writer, "completed"));
    assert.equal(sub.source.instanceId, "b_writer");
    assert.equal(sub.label, "Writer › completed");

    const bad = body(
      await handlers.create_bot(
        newBot({ subscriptions: [{ bot: "Nobody", event: "completed" }] }),
      ),
    );
    assert.equal(bad.status, "invalid");
    assert.match(bad.reasons[0], /No other bot named "Nobody"/);
  });

  it("runWithoutAsking writes exactly those tools, in the folders given", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(
      await handlers.create_bot(
        newBot({
          providers: [
            {
              name: "Files",
              runWithoutAsking: ["read_file", "list_directory"],
              readFolders: ["/docs"],
              writeFolders: ["/out"],
            },
            { name: "Gmail" },
          ],
        }),
      ),
    );
    const g = state.grants[b.bot.id];
    assert.deepEqual(g.servers.Files, {
      tools: ["read_file", "list_directory"],
      readPaths: ["/docs"],
      writePaths: ["/out"],
    });
    assert.equal(g.servers.Gmail, undefined);
    assert.ok(
      state.audit.some(
        (e) => e.type === "grant-saved" && e.provider === "Files",
      ),
    );
    assert.deepEqual(b.bot.providers[0].runWithoutAsking, [
      "read_file",
      "list_directory",
    ]);
  });

  it("the summary names what runs without asking, and where", async () => {
    const { handlers } = setup();
    const w = body(
      await handlers.create_bot(
        newBot({
          providers: [
            { name: "Gmail", runWithoutAsking: ["search_emails"] },
            {
              name: "Files",
              runWithoutAsking: ["read_file"],
              readFolders: ["/docs"],
            },
          ],
        }),
      ),
    );
    assert.match(
      w.summary,
      /- Gmail: all its tools; runs without asking: search_emails — only calls that name no file \(one that names a file asks\) \(more access\)/,
    );
    assert.match(
      w.summary,
      /- Files: all its tools; runs without asking: read_file — a call's path\/file argument must be in folders it reads \/docs; a call that names no file runs anywhere \(more access\)/,
    );
  });

  it("folders without runWithoutAsking save no grant at all", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(
      await handlers.create_bot(
        newBot({
          providers: [
            { name: "Gmail", readFolders: ["/x"], writeFolders: ["/y"] },
            { name: "Files", readFolders: [] },
          ],
        }),
      ),
    );
    assert.equal(b.status, "created");
    assert.equal(state.grants[b.bot.id], undefined);
    assert.deepEqual(b.bot.providers[0].runWithoutAsking, []);
  });

  it("refuses '*' and tools the provider doesn't have", async () => {
    const { handlers, state } = setup();
    const star = body(
      await handlers.create_bot(
        newBot({ providers: [{ name: "Gmail", runWithoutAsking: ["*"] }] }),
      ),
    );
    assert.equal(star.status, "invalid");
    assert.match(star.reasons[0], /"\*" isn't accepted/);
    const unknown = body(
      await handlers.create_bot(
        newBot({
          providers: [
            {
              name: "Gmail",
              tools: ["search_emails"],
              runWithoutAsking: ["send_email"],
            },
          ],
        }),
      ),
    );
    assert.match(
      unknown.reasons[0],
      /send_email isn't one of its tools chosen in 'tools'/,
    );
    const unlisted = body(
      await handlers.create_bot(
        newBot({ providers: [{ name: "Slack", runWithoutAsking: ["post"] }] }),
      ),
    );
    assert.match(unlisted.reasons[0], /can't list its tools/);
    assert.equal(state.saves.length, 0);
    assert.equal(state.checks.length, 0);
  });

  it("a { widget, event } trigger on its own dashboard, labelled by Dash", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    await handlers.create_bot(
      newBot({ subscriptions: [{ widget: "pipeline", event: "clicked" }] }),
    );
    assert.deepEqual(state.saves[0].def.subscriptions[0], {
      eventType: "Chart[7].clicked",
      source: {
        kind: "widget",
        ref: "Chart",
        instanceId: "7",
        event: "clicked",
        workspaceId: "1",
      },
      label: "Sales › Pipeline › clicked",
    });
  });

  it("refuses triggers from other teams, the Dash team, or as raw events", async () => {
    const { handlers, state } = setup();
    const cases = [
      [{ bot: "Diary", event: "completed" }, /No other bot named "Diary"/],
      [{ bot: "dash_lead", event: "completed" }, /No other bot named/],
      [{ widget: "Inbox", event: "clicked" }, /No widget "Inbox"/, "Ops"],
      [
        { eventType: "Inbox[5].clicked", label: "Mine" },
        /\{ bot, event \} or \{ widget, event \}/,
      ],
    ];
    for (const [sub, why, team] of cases) {
      const b = body(
        await handlers.create_bot(
          newBot({ subscriptions: [sub], ...(team ? { team } : {}) }),
        ),
      );
      assert.equal(b.status, "invalid", JSON.stringify(sub));
      assert.match(b.reasons[0], why);
    }
    assert.equal(state.saves.length, 0);
  });

  it("the summary has every field it saves, prompts in full", async () => {
    const { handlers } = setup();
    const prompt = `Morning digest. ${"x".repeat(200)} END`;
    const w = body(
      await handlers.create_bot(
        newBot({
          instructions: "Line one.\nLine two, all of it.",
          schedules: [{ cron: "0 8 * * *", prompt }],
          whilePaused: "drop",
          publishes: [{ name: "digest", label: "Daily digest", extra: "x" }],
          commands: { allowed: ["git status"], blocked: ["rm"] },
        }),
      ),
    );
    assert.ok(w.summary.includes(`asking:\n    | ${prompt}`));
    assert.match(
      w.summary,
      /Instructions, in full:\n {4}\| Line one\.\n {4}\| Line two, all of it\./,
    );
    assert.match(w.summary, /While paused: what starts it is dropped/);
    assert.match(w.summary, /Results it publishes: digest \("Daily digest"\)/);
    assert.match(
      w.summary,
      /Shell commands that run without asking: git status\. Never run: rm\. These only apply with built-in tools 'all'/,
    );
    assert.match(w.summary, /Folders it works in: none/);
  });

  it("publishes keep only name, label and description", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    await handlers.create_bot(
      newBot({
        publishes: [
          { name: "digest", description: "The day", source: "evil", extra: 1 },
        ],
      }),
    );
    assert.deepEqual(state.saves[0].def.publishes, [
      { name: "digest", label: "digest", description: "The day" },
    ]);
  });

  it("expired requests are dropped, and only so many wait at once", async () => {
    const { handlers, tick } = setup({ maxPending: 2 });
    body(await handlers.create_bot(newBot({ name: "A" })));
    body(await handlers.create_bot(newBot({ name: "B" })));
    const third = body(await handlers.create_bot(newBot({ name: "C" })));
    assert.equal(third.status, "busy");
    assert.equal(handlers._pendingCount(), 2);
    tick(10 * 60 * 1000 + 1);
    const fresh = body(await handlers.create_bot(newBot({ name: "D" })));
    assert.equal(fresh.status, "waiting");
    // The two old ones went when it looked.
    assert.equal(handlers._pendingCount(), 1);
  });
});

describe("update_bot", () => {
  it("changes only what's given; the summary says old → new and more access", async () => {
    const { handlers, state } = setup();
    const w = body(
      await handlers.update_bot({
        bot: "Writer",
        builtinTools: "all",
        approvalPolicy: "ask",
        name: "Writer",
        from: "voice",
      }),
    );
    assert.equal(w.status, "waiting");
    // Only what really changed is in the definition.
    assert.deepEqual(state.checks[0], { id: "b_writer", builtinTools: null });
    assert.match(
      w.summary,
      /Built-in tools: read-only .* → all .* \(more access\)/,
    );
    assert.match(w.summary, /This gives it more access \(built-in tools\)/);
    assert.doesNotMatch(w.summary, /Approvals/);
    const ok = body(
      await handlers.confirm_bot({
        requestId: w.requestId,
        passphrase: "purple otter",
      }),
    );
    assert.equal(ok.status, "changed");
    assert.deepEqual(state.saves[0].def, {
      id: "b_writer",
      builtinTools: null,
    });
    const audit = state.audit.find((e) => e.type === "bot-changed");
    assert.deepEqual(audit, {
      type: "bot-changed",
      botId: "b_writer",
      via: "mcp",
      from: "voice",
      fields: ["builtinTools"],
    });
    assert.deepEqual(state.resumed, []);
    assert.equal(state.notices[0].body, "Writer was changed by voice.");
  });

  it("names provider tools and folders that widen", async () => {
    const { handlers } = setup();
    const w = body(
      await handlers.update_bot({
        bot: "b_writer",
        providers: [
          { name: "Gmail" },
          { name: "Files", writeFolders: ["/out"] },
        ],
      }),
    );
    assert.match(
      w.summary,
      /Provider Gmail: search_emails, send_email .* → all its tools \(more access\)/,
    );
    // Folders for a tool that already runs without asking widen it.
    assert.match(
      w.summary,
      /What Files runs without asking: read_file — a call's path\/file argument must be in folders it reads \/notes; a call that names no file runs anywhere → read_file — a call's path\/file argument must be in folders it reads \/notes; changes \/out; a call that names no file runs anywhere \(more access\)/,
    );
  });

  it("empty folder lists change nothing and never add a tool", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(
      await handlers.update_bot({
        bot: "b_writer",
        providers: [
          { name: "Gmail", tools: ["search_emails", "send_email"] },
          { name: "Files", readFolders: [], writeFolders: [] },
        ],
      }),
    );
    assert.equal(b.status, "unchanged");
    assert.deepEqual(state.grants.b_writer.servers.Files.tools, ["read_file"]);
  });

  it("runWithoutAsking: [] makes every tool ask again (no more access)", async () => {
    const { handlers, state } = setup();
    const w = body(
      await handlers.update_bot({
        bot: "b_writer",
        providers: [
          { name: "Gmail", tools: ["search_emails", "send_email"] },
          { name: "Files", runWithoutAsking: [] },
        ],
      }),
    );
    assert.match(
      w.summary,
      /What Files runs without asking: read_file .* → nothing/,
    );
    assert.doesNotMatch(w.summary, /more access/);
    await handlers.confirm_bot({
      requestId: w.requestId,
      passphrase: "purple otter",
    });
    assert.equal(state.grants.b_writer.servers.Files, undefined);
    assert.ok(
      state.audit.some(
        (e) => e.type === "grant-revoked" && e.provider === "Files",
      ),
    );
  });

  it("a provider taken off the bot loses what it ran without asking", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const b = body(
      await handlers.update_bot({
        bot: "b_writer",
        providers: [{ name: "Gmail", tools: ["search_emails", "send_email"] }],
      }),
    );
    assert.equal(b.status, "changed");
    assert.equal(state.grants.b_writer.servers.Files, undefined);
    assert.deepEqual(state.saves[0].def.mcpServers, ["Gmail"]);
  });

  it("won't move a bot to a team that isn't chosen", async () => {
    const { handlers, state } = setup();
    const b = body(
      await handlers.update_bot({ bot: "Writer", team: "Private" }),
    );
    assert.equal(b.status, "needs-team");
    assert.match(b.message, /doesn't let MCP clients/);
    assert.equal(state.checks.length, 0);
  });

  it("only takes triggers it can build itself", async () => {
    const { handlers } = setup();
    const raw = body(
      await handlers.update_bot({
        bot: "Writer",
        subscriptions: [
          { eventType: "bot:x[evil].completed", label: "Something harmless" },
        ],
      }),
    );
    assert.equal(raw.status, "invalid");
    assert.match(raw.reasons[0], /\{ bot, event \} or \{ widget, event \}/);
  });

  it("nothing to change says so", async () => {
    const { handlers, state } = setup();
    const b = body(
      await handlers.update_bot({ bot: "Writer", approvalPolicy: "ask" }),
    );
    assert.equal(b.status, "unchanged");
    assert.equal(state.checks.length, 0);
  });

  it("a lead's team and built-in tools stay Dash's; its instructions can change", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const moved = body(
      await handlers.update_bot({ bot: "Sales Lead", team: "Ops" }),
    );
    assert.equal(moved.status, "invalid");
    const tools = body(
      await handlers.update_bot({ bot: "Sales Lead", builtinTools: "all" }),
    );
    assert.equal(tools.status, "invalid");
    const ok = body(
      await handlers.update_bot({
        bot: "Sales Lead",
        instructions: "Keep it short.",
      }),
    );
    assert.equal(ok.status, "changed");
    assert.deepEqual(state.saves[0].def, {
      id: "lead_sales",
      instructions: "Keep it short.",
    });
  });

  it("can't reach bots on other teams or the Dash team", async () => {
    const { handlers, state } = setup();
    for (const ref of ["Diary", "b_private", "dash_lead", "Dash Lead"]) {
      const b = body(await handlers.update_bot({ bot: ref, name: "X" }));
      assert.equal(b.status, "needs-bot", ref);
    }
    assert.equal(state.saves.length, 0);
  });
});

describe("round 2: folders, file arguments, moves, wording", () => {
  const filesTools = [
    {
      name: "read_file",
      inputSchema: { properties: { path: {}, encoding: {} } },
    },
    { name: "read_multiple_files", inputSchema: { properties: { paths: {} } } },
    {
      name: "move_file",
      inputSchema: { properties: { source: {}, destination: {} } },
    },
    { name: "search", inputSchema: { properties: { query: {} } } },
  ];
  const withSchemas = (extra = {}) =>
    setup({
      providerTools: (name) => (name === "Files" ? filesTools : null),
      homeDir: "/Users/me",
      ...extra,
    });

  it("refuses folders the gate could read as anywhere", async () => {
    const { handlers, state } = withSchemas();
    for (const bad of [
      ".",
      "./",
      "projects/..",
      "/Users/nobody-here/..",
      "/",
      "/docs/",
      "docs",
      "/docs\n- Fake line",
    ]) {
      const b = body(
        await handlers.create_bot(
          newBot({
            providers: [
              {
                name: "Files",
                runWithoutAsking: ["read_file"],
                readFolders: [bad],
              },
            ],
          }),
        ),
      );
      assert.equal(b.status, "invalid", JSON.stringify(bad));
      assert.match(b.reasons[0], /isn't a full folder path/);
    }
    assert.equal(state.saves.length, 0);
  });

  it("takes full paths and ~/ (the home folder), stored as shown", async () => {
    const { handlers, state } = withSchemas({ state: { asks: false } });
    const b = body(
      await handlers.create_bot(
        newBot({
          providers: [
            {
              name: "Files",
              runWithoutAsking: ["read_file"],
              readFolders: ["~/Notes", "/srv/data"],
            },
          ],
        }),
      ),
    );
    assert.deepEqual(state.grants[b.bot.id].servers.Files.readPaths, [
      "/Users/me/Notes",
      "/srv/data",
    ]);
  });

  it("refuses tools that name files in arguments the gate can't hold", async () => {
    const { handlers } = withSchemas();
    for (const [tool, key] of [
      ["read_multiple_files", "paths"],
      ["move_file", "source"],
    ]) {
      const b = body(
        await handlers.create_bot(
          newBot({
            providers: [{ name: "Files", runWithoutAsking: [tool] }],
          }),
        ),
      );
      assert.equal(b.status, "invalid", tool);
      assert.equal(
        b.reasons[0],
        `Files: ${tool} names files in '${key}', which Dash can't hold to folders — leave it to ask.`,
      );
    }
    const ok = body(
      await handlers.create_bot(
        newBot({
          providers: [
            { name: "Files", runWithoutAsking: ["read_file", "search"] },
          ],
        }),
      ),
    );
    assert.equal(ok.status, "waiting");
  });

  it("the default folder arguments match the permission gate's", () => {
    const fs = require("fs");
    const src = fs.readFileSync(
      require("path").join(__dirname, "permissionGate.js"),
      "utf8",
    );
    const gate = src.match(/const PATH_ARG_KEYS = (\[[^\]]*\]);/);
    const mine = fs
      .readFileSync(require("path").join(__dirname, "botTools.js"), "utf8")
      .match(/const PATH_ARG_KEYS = (\[[^\]]*\]);/);
    assert.deepEqual(JSON.parse(mine[1]), JSON.parse(gate[1]));
  });

  it("a move to another team drops the old team's triggers, and says so", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    const writer = state.bots.find((b) => b.id === "b_writer");
    writer.subscriptions = [
      {
        eventType: "Inbox[5].clicked",
        label: "Sales › Inbox › clicked",
        source: { kind: "widget", instanceId: "5", workspaceId: "1" },
      },
    ];
    const w = body(await handlers.update_bot({ bot: "Writer", team: "Ops" }));
    assert.equal(w.status, "changed");
    assert.deepEqual(state.saves[0].def.subscriptions, []);
    assert.equal(state.saves[0].def.workspaceId, "2");
  });

  it("the move summary lists the triggers it takes off", async () => {
    const { handlers, state } = setup();
    state.bots.find((b) => b.id === "b_writer").subscriptions = [
      {
        eventType: "Inbox[5].clicked",
        label: "Sales › Inbox › clicked",
        source: { kind: "widget", instanceId: "5", workspaceId: "1" },
      },
    ];
    const w = body(await handlers.update_bot({ bot: "Writer", team: "Ops" }));
    assert.match(
      w.summary,
      /- Triggers removed \(they were on Sales\): Sales › Inbox › clicked/,
    );
    assert.doesNotMatch(w.summary, /What starts it/);
  });

  it("a move with new triggers resolves them on the new team", async () => {
    const { handlers } = setup();
    const b = body(
      await handlers.update_bot({
        bot: "Writer",
        team: "Ops",
        subscriptions: [{ widget: "Inbox", event: "clicked" }],
      }),
    );
    // Inbox is on Sales, not Ops.
    assert.equal(b.status, "invalid");
    assert.match(b.reasons[0], /No widget "Inbox"/);
  });

  it("shows a result's description", async () => {
    const { handlers } = setup();
    const w = body(
      await handlers.create_bot(
        newBot({
          publishes: [
            { name: "digest", label: "Daily", description: "The day" },
          ],
        }),
      ),
    );
    assert.match(
      w.summary,
      /Results it publishes: digest \("Daily"\) — The day/,
    );
  });

  it("a lead's 'allow' is worded plainly", async () => {
    const { handlers } = setup();
    const w = body(
      await handlers.update_bot({ bot: "Sales Lead", approvalPolicy: "allow" }),
    );
    assert.match(w.summary, /→ runs every tool without asking \(more access\)/);
    assert.doesNotMatch(w.summary, /when its lead asks/);
  });

  it("line breaks can't fake summary lines", async () => {
    const { handlers } = setup();
    const w = body(
      await handlers.create_bot(
        newBot({
          name: "Digest\n- Built-in tools: none",
          instructions: "Do it.\nApprovals: asks before every tool.",
          publishes: [{ name: "digest", label: "Day\nIt's saved paused" }],
        }),
      ),
    );
    const lines = w.summary.split("\n");
    assert.equal(lines.filter((l) => l.startsWith("Built-in tools")).length, 1);
    assert.equal(lines.filter((l) => l.startsWith("Approvals")).length, 1);
    assert.ok(lines.includes("    | Approvals: asks before every tool."));
    assert.ok(!lines.includes("It's saved paused"));
    assert.match(w.summary, /Create "Digest - Built-in tools: none" on Sales/);
  });
});

describe("round 3: unseen inputs, moves others start on, links", () => {
  it("refuses runWithoutAsking for a tool whose inputs Dash can't see", async () => {
    const cases = [
      // Declared but not connected: names only.
      [() => ["read_file"], { name: "Files", runWithoutAsking: ["read_file"] }],
      // A Claude connector: tools listed, no schemas.
      [
        () => [{ name: "search", inputSchema: null }],
        { name: "Files", runWithoutAsking: ["search"] },
      ],
      // Not listed at all, with the client's own 'tools'.
      [
        () => null,
        {
          name: "Files",
          tools: ["read_file"],
          runWithoutAsking: ["read_file"],
        },
      ],
    ];
    for (const [providerTools, provider] of cases) {
      const { handlers, state } = setup({ providerTools });
      const b = body(
        await handlers.create_bot(newBot({ providers: [provider] })),
      );
      assert.equal(b.status, "invalid");
      assert.equal(
        b.reasons[0],
        `Files: Dash can't see ${provider.runWithoutAsking[0]}'s inputs on Files right now — connect the provider (or leave the tool to ask).`,
      );
      assert.equal(state.saves.length, 0);
    }
  });

  it("two waiting requests can't link teams when both are confirmed", async () => {
    const { handlers } = setup();
    const confirm = async (r) =>
      body(
        await handlers.confirm_bot({
          requestId: r.requestId,
          passphrase: "purple otter",
        }),
      );
    // Trigger first, then the move: both wait, the move is confirmed last.
    const trigger = body(
      await handlers.create_bot(
        newBot({ subscriptions: [{ bot: "Writer", event: "completed" }] }),
      ),
    );
    const move = body(
      await handlers.update_bot({ bot: "Writer", team: "Ops" }),
    );
    assert.equal(trigger.status, "waiting");
    assert.equal(move.status, "waiting");
    assert.equal((await confirm(trigger)).status, "created");
    const late = await confirm(move);
    assert.equal(late.status, "failed");
    assert.match(late.message, /can't move to another team/);
  });

  it("the move first, then a trigger on it: the trigger isn't saved", async () => {
    const { handlers } = setup();
    const confirm = async (r) =>
      body(
        await handlers.confirm_bot({
          requestId: r.requestId,
          passphrase: "purple otter",
        }),
      );
    const move = body(
      await handlers.update_bot({ bot: "Writer", team: "Ops" }),
    );
    const trigger = body(
      await handlers.create_bot(
        newBot({ subscriptions: [{ bot: "Writer", event: "completed" }] }),
      ),
    );
    assert.equal((await confirm(move)).status, "changed");
    const late = await confirm(trigger);
    assert.equal(late.status, "failed");
    assert.match(late.message, /points at a bot on another team/);
  });

  it("won't move a bot that other bots start on", async () => {
    const { handlers, state } = setup({ state: { asks: false } });
    // Step 1: Digest starts when Writer finishes.
    const made = body(
      await handlers.create_bot(
        newBot({ subscriptions: [{ bot: "Writer", event: "completed" }] }),
      ),
    );
    assert.equal(made.status, "created");
    // Step 2: moving Writer to Ops would carry that trigger across teams.
    const moved = body(
      await handlers.update_bot({ bot: "Writer", team: "Ops" }),
    );
    assert.equal(moved.status, "invalid");
    assert.equal(
      moved.reasons[0],
      "Digest on Sales starts when Writer finishes — remove that trigger first.",
    );
    assert.equal(state.saves.length, 1);
  });

  it("refuses a folder that's a link, or the home folder or disk itself", async () => {
    const fs = require("fs");
    const path = require("path");
    const { tempDir } = require("../testUtils/tempDir");
    // The temp folder itself may sit behind a link (macOS /var → /private/var).
    const base = fs.realpathSync(tempDir("dash-bot-folders-"));
    const realDir = path.join(base, "real");
    const link = path.join(base, "link");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, link);
    try {
      const { handlers } = setup({ homeDir: base });
      const ask = async (folder) =>
        body(
          await handlers.create_bot(
            newBot({
              providers: [
                {
                  name: "Files",
                  runWithoutAsking: ["read_file"],
                  readFolders: [folder],
                },
              ],
            }),
          ),
        );
      const viaLink = await ask(link);
      assert.equal(viaLink.status, "invalid");
      assert.equal(
        viaLink.reasons[0],
        `Files: "${link}" is a link to "${realDir}" — give the real folder.`,
      );
      const home = await ask(base);
      assert.match(home.reasons[0], /is your whole home folder/);
      const tilde = await ask("~");
      assert.match(tilde.reasons[0], /is your whole home folder/);
      // A folder holding the home folder is more than the home folder.
      const above = await ask(path.dirname(base));
      assert.match(above.reasons[0], /holding your home folder/);
      // Another case of the same folder, on a disk that ignores case.
      const upper = base.toUpperCase();
      if (upper !== base && fs.existsSync(upper)) {
        const cased = await ask(upper);
        assert.equal(cased.status, "invalid");
        assert.match(cased.reasons[0], /give ".*" as ".*"/);
      }
      const real = await ask(realDir);
      assert.equal(real.status, "waiting");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("tools that are off", () => {
  it("refuse when called", async () => {
    const { handlers, state } = setup({ on: [] });
    for (const name of [
      "list_bots",
      "create_bot",
      "update_bot",
      "confirm_bot",
    ]) {
      const r = await handlers[name]({});
      assert.equal(r.isError, true, name);
      assert.match(
        body(r).message,
        new RegExp(
          `${name} is turned off in Dash \\(Settings › MCP Server › Tools\\)`,
        ),
      );
    }
    assert.equal(state.saves.length, 0);
  });

  it("a waiting change can't be confirmed once its tool is off", async () => {
    const { handlers, on, state } = setup();
    body(await handlers.create_bot(newBot()));
    on.delete("create_bot");
    const r = await handlers.confirm_bot({
      requestId: "req_1",
      passphrase: "purple otter",
    });
    assert.equal(r.isError, true);
    assert.equal(state.saves.length, 0);
  });

  it("the bot tools are off by default; confirm_bot follows them", () => {
    const byName = Object.fromEntries(BOT_TOOLS.map((t) => [t.name, t]));
    for (const n of ["list_bots", "create_bot", "update_bot"]) {
      assert.equal(byName[n].defaultOff, true, n);
    }
    assert.deepEqual(byName.confirm_bot.onWith, ["create_bot", "update_bot"]);
  });
});

describe("checks over MCP (DASH-52)", () => {
  const validate = {
    kind: "check",
    name: "Validate",
    check: { kind: "command", command: "./scripts/ci.sh", timeoutSec: 900 },
  };
  const withPr = {
    kind: "check",
    name: "Finished with a PR",
    check: {
      kind: "command",
      command: '/bin/cat "$DASH_INPUT"',
      passWhen: { type: "matches", pattern: "PR: https://github\\.com/" },
    },
  };
  const withReviewer = (extra = {}) => ({
    state: {
      bots: [
        ...baseBots(),
        { id: "b_reviewer", workspaceId: "1", name: "Reviewer" },
      ],
      ...extra,
    },
  });

  it("update_bot sets checks as the Bots tab saves them, and says so", async () => {
    const { handlers, state } = setup(withReviewer());
    const w = body(
      await handlers.update_bot({
        bot: "Writer",
        checks: {
          steps: [validate, { kind: "reviewer", bot: "Reviewer" }, withPr],
          onFail: "retry",
          maxTries: 3,
        },
      }),
    );
    assert.equal(w.status, "waiting");
    const saved = state.checks[0].checks;
    assert.deepEqual(
      saved.steps.map((s) => [
        s.kind,
        s.botId || null,
        s.check && s.check.kind,
      ]),
      [
        ["check", null, "command"],
        ["reviewer", "b_reviewer", undefined],
        ["check", null, "command"],
      ],
    );
    assert.equal(saved.onFail, "retry");
    assert.equal(saved.maxTries, 3);
    assert.equal(saved.handsOn, "answer");
    assert.deepEqual(saved.steps[2].check.passWhen, {
      type: "matches",
      pattern: "PR: https://github\\.com/",
    });
    assert.match(
      w.summary,
      /Checks: none \(its work goes straight on\) → 1\. "Validate": runs `\.\/scripts\/ci\.sh`; passes when it exits 0; 2\. "Reviewer": Reviewer reviews the work; 3\. "Finished with a PR": runs .*passes when its output matches/,
    );
    assert.match(w.summary, /up to 3 tries/);
    const ok = body(
      await handlers.confirm_bot({
        requestId: w.requestId,
        passphrase: "purple otter",
      }),
    );
    assert.equal(ok.status, "changed");
    assert.equal(state.saves[0].def.checks.steps.length, 3);
  });

  it("list_bots shows a bot's checks", async () => {
    const { handlers } = setup({
      state: {
        bots: baseBots().map((b) =>
          b.id === "b_writer" ? { ...b, checks: { steps: [validate] } } : b,
        ),
      },
    });
    const writer = body(await handlers.list_bots({})).bots.find(
      (b) => b.id === "b_writer",
    );
    assert.equal(writer.checks.steps[0].check.command, "./scripts/ci.sh");
    assert.equal(writer.checks.onFail, "retry");
  });

  it("the same checks again change nothing", async () => {
    const { handlers, state } = setup({
      state: {
        asks: false,
        bots: baseBots().map((b) =>
          b.id === "b_writer" ? { ...b, checks: { steps: [validate] } } : b,
        ),
      },
    });
    const b = body(
      await handlers.update_bot({
        bot: "Writer",
        checks: { steps: [validate] },
      }),
    );
    assert.equal(state.saves.length, 0, JSON.stringify(b));
  });

  it("{ steps: [] } removes them, said as more access", async () => {
    const { handlers, state } = setup({
      state: {
        bots: baseBots().map((b) =>
          b.id === "b_writer"
            ? { ...b, checks: { steps: [validate, { kind: "you" }] } }
            : b,
        ),
      },
    });
    const w = body(
      await handlers.update_bot({ bot: "Writer", checks: { steps: [] } }),
    );
    assert.equal(state.checks[0].checks, null);
    assert.match(
      w.summary,
      /Checks: .* → none \(its work goes straight on\) \(more access\)/,
    );
  });

  it("create_bot takes checks, and its summary lists them", async () => {
    const { handlers, state } = setup(withReviewer());
    const w = body(
      await handlers.create_bot(
        newBot({
          checks: {
            steps: [
              { kind: "reviewer", bot: "b_reviewer" },
              { kind: "you", name: "Merge?" },
            ],
            onFail: "you",
          },
        }),
      ),
    );
    assert.equal(w.status, "waiting");
    assert.equal(state.checks[0].checks.steps[0].botId, "b_reviewer");
    assert.match(
      w.summary,
      /Checks: 1\. "Reviewer": Reviewer reviews the work; 2\. "Merge\?": waits for the user to approve; a fail goes to the user\./,
    );
  });

  it("checks that couldn't run come back with every reason; nothing is saved", async () => {
    const { handlers, state } = setup(withReviewer());
    const b = body(
      await handlers.update_bot({
        bot: "Writer",
        checks: {
          steps: [
            { kind: "check", check: { kind: "command", command: "  " } },
            { kind: "check", check: { kind: "tool", server: "GitHub" } },
            { kind: "reviewer", bot: "Nobody" },
            { kind: "reviewer", bot: "Writer" },
            { kind: "reviewer" },
          ],
        },
      }),
    );
    assert.equal(b.status, "invalid");
    assert.equal(b.reasons.length, 5, b.reasons.join("\n"));
    assert.match(b.reasons[0], /Check 1: a command check needs its command/);
    assert.match(
      b.reasons[1],
      /Check 2: a tool check needs its server and tool/,
    );
    assert.match(b.reasons[2], /no bot named "Nobody"/);
    assert.match(b.reasons[3], /can't review its own work/);
    assert.match(b.reasons[4], /needs the bot that reviews/);
    assert.equal(state.saves.length, 0);
  });

  it("a wrong kind or onFail is refused", async () => {
    const { handlers } = setup();
    const b1 = body(
      await handlers.update_bot({
        bot: "Writer",
        checks: { steps: [{ kind: "maybe" }] },
      }),
    );
    assert.equal(b1.status, "invalid");
    assert.match(b1.reasons[0], /kind must be one of check, reviewer, you/);
    const b2 = body(
      await handlers.update_bot({
        bot: "Writer",
        checks: { steps: [validate], onFail: "later" },
      }),
    );
    assert.match(b2.reasons[0], /onFail must be one of retry, you, stop/);
    const b3 = body(
      await handlers.update_bot({ bot: "Writer", checks: [validate] }),
    );
    assert.match(b3.reasons[0], /checks must be an object/);
  });
});
