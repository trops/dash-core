/**
 * teamManifest.test.js — a dashboard's team as a portable `.team.json`
 * (bot-teams TEAM-006/007, slice 1): members by role, providers by type,
 * wiring between roles; never ids, provider names, grants or secrets.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  wireTeam,
} = require("./teamManifest");

const providers = [
  { name: "Google Calendar", type: "google-calendar" },
  { name: "Gmail 3", type: "gmail" },
  { name: "Filesystem_pipeline", type: "filesystem" },
  { name: "Claude", type: "anthropic", isDefaultForType: true },
];

const lead = {
  id: "bot_lead",
  name: "Daily Brief Lead",
  role: "lead",
  workspaceId: "ws1",
  instructions: "lead",
};
const agenda = {
  id: "bot_a",
  ref: "local/agenda",
  name: "Agenda",
  workspaceId: "ws1",
  instructions: "Read today's calendar.",
  provider: "claude-code",
  model: null,
  engine: null,
  approvalPolicy: "ask",
  mcpServers: ["Google Calendar"],
  toolSelections: { "Google Calendar": ["list-events", "get-current-time"] },
  allowedTools: ["list-events"],
  schedules: [{ cron: "0 7 * * *", prompt: "Morning agenda" }],
  subscriptions: [],
  session: { secret: "s" },
};
const inbox = {
  id: "bot_i",
  ref: "local/inbox",
  name: "Inbox",
  workspaceId: "ws1",
  instructions: "Scan unread mail.",
  provider: "claude-code",
  approvalPolicy: "allow",
  mcpServers: ["Gmail 3"],
  toolSelections: {},
  schedules: [],
  subscriptions: [
    {
      eventType: "bot:local/agenda[bot_a].completed",
      source: {
        kind: "bot",
        ref: "local/agenda",
        instanceId: "bot_a",
        event: "completed",
      },
      label: "Agenda › Completed",
    },
    {
      eventType: "widget:@trops/gmail/Inbox[12].newMail",
      source: {
        kind: "widget",
        ref: "@trops/gmail/Inbox",
        instanceId: "12",
        event: "newMail",
      },
      label: "Inbox widget › newMail",
    },
  ],
};
const writer = {
  id: "bot_w",
  ref: "local/writer",
  name: "Writer",
  workspaceId: "ws1",
  instructions: "Write the brief.",
  provider: null,
  approvalPolicy: "ask",
  mcpServers: ["Filesystem_pipeline", "Mystery"],
  toolSelections: { Filesystem_pipeline: ["write_file"] },
  schedules: [],
  subscriptions: [
    {
      eventType: "bot:local/inbox[bot_i].tool.gmail.search_emails",
      source: {
        kind: "bot",
        ref: "local/inbox",
        instanceId: "bot_i",
        event: "tool.gmail.search_emails",
      },
    },
    {
      eventType: "bot:local/elsewhere[bot_x].completed",
      source: {
        kind: "bot",
        ref: "local/elsewhere",
        instanceId: "bot_x",
        event: "completed",
      },
      label: "Elsewhere › Completed",
    },
  ],
};

const team = [lead, agenda, inbox, writer];

describe("buildTeamManifest", () => {
  const { manifest, notIncluded } = buildTeamManifest({
    name: "Daily Brief",
    description: "Morning brief",
    bots: team,
    providers,
  });

  it("is a v1 bot-team with members by role (no lead)", () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.type, "bot-team");
    assert.equal(manifest.name, "Daily Brief");
    assert.deepEqual(
      manifest.members.map((m) => m.role),
      ["agenda", "inbox", "writer"],
    );
  });

  it("embeds each member with providers by type and its tool choices", () => {
    const a = manifest.members[0].embedded;
    assert.equal(a.name, "Agenda");
    assert.equal(a.instructions, "Read today's calendar.");
    assert.equal(a.modelSource, "claude-code");
    assert.deepEqual(a.providers, [
      { type: "google-calendar", tools: ["list-events", "get-current-time"] },
    ]);
    assert.deepEqual(a.schedules, [
      { cron: "0 7 * * *", prompt: "Morning agenda" },
    ]);
    assert.deepEqual(manifest.members[1].embedded.providers, [
      { type: "gmail", tools: null },
    ]);
  });

  it("wires roles from bot→bot subscriptions, completed and tool events", () => {
    assert.deepEqual(manifest.wiring, [
      { role: "inbox", on: { role: "agenda", event: "completed" } },
      {
        role: "writer",
        on: { role: "inbox", event: "tool.gmail.search_emails" },
      },
    ]);
  });

  it("never carries ids, provider names, grants, sessions or the lead", () => {
    const text = JSON.stringify(manifest);
    for (const banned of [
      "bot_a",
      "bot_i",
      "bot_w",
      "bot_lead",
      "ws1",
      "Gmail 3",
      "Filesystem_pipeline",
      "Google Calendar",
      "allowedTools",
      "session",
      "Daily Brief Lead",
    ]) {
      assert.ok(!text.includes(banned), `manifest contains ${banned}`);
    }
  });

  it("lists what it couldn't carry", () => {
    assert.deepEqual(notIncluded, [
      'Writer: the provider "Mystery" (unknown type)',
      'Inbox: the trigger "Inbox widget › newMail" (a widget on this dashboard)',
      'Writer: the trigger "Elsewhere › Completed" (a bot outside this team)',
    ]);
  });

  it("gives duplicate names unique roles", () => {
    const { manifest: m } = buildTeamManifest({
      name: "T",
      bots: [
        { ...agenda, id: "x1" },
        { ...agenda, id: "x2" },
      ],
      providers,
    });
    assert.deepEqual(
      m.members.map((x) => x.role),
      ["agenda", "agenda-2"],
    );
  });
});

describe("validateTeamManifest", () => {
  const good = () =>
    buildTeamManifest({ name: "Daily Brief", bots: team, providers }).manifest;

  it("accepts an exported manifest and returns a clean copy", () => {
    const r = validateTeamManifest(good());
    assert.equal(r.valid, true, r.errors.join("; "));
    assert.deepEqual(r.manifest, good());
  });

  it("drops fields it doesn't know (ids, grants, anything smuggled in)", () => {
    const m = good();
    m.members[0].embedded.id = "bot_evil";
    m.members[0].embedded.allowedTools = ["send_email"];
    m.members[0].embedded.workspaceId = "ws9";
    m.grants = { all: true };
    const r = validateTeamManifest(m);
    assert.equal(r.valid, true);
    const text = JSON.stringify(r.manifest);
    for (const banned of ["bot_evil", "allowedTools", "ws9", "grants"]) {
      assert.ok(!text.includes(banned), banned);
    }
  });

  it("rejects the wrong type, version, or shape", () => {
    assert.equal(validateTeamManifest(null).valid, false);
    assert.equal(validateTeamManifest({ ...good(), type: "bot" }).valid, false);
    assert.equal(
      validateTeamManifest({ ...good(), schemaVersion: 2 }).valid,
      false,
    );
    assert.equal(validateTeamManifest({ ...good(), members: [] }).valid, false);
  });

  it("rejects duplicate or malformed roles and wiring to unknown roles", () => {
    const dup = good();
    dup.members[1].role = "agenda";
    assert.equal(validateTeamManifest(dup).valid, false);
    const bad = good();
    bad.members[0].role = "Has Spaces";
    assert.equal(validateTeamManifest(bad).valid, false);
    const ghost = good();
    ghost.wiring.push({
      role: "writer",
      on: { role: "ghost", event: "completed" },
    });
    assert.equal(validateTeamManifest(ghost).valid, false);
    const self = good();
    self.wiring.push({
      role: "writer",
      on: { role: "writer", event: "completed" },
    });
    assert.equal(validateTeamManifest(self).valid, false);
    const ev = good();
    ev.wiring[0].on.event = "anything";
    assert.equal(validateTeamManifest(ev).valid, false);
  });

  it("rejects members missing a name or instructions, and oversized text", () => {
    const m = good();
    m.members[0].embedded.instructions = "";
    assert.equal(validateTeamManifest(m).valid, false);
    const big = good();
    big.members[0].embedded.instructions = "x".repeat(50001);
    assert.equal(validateTeamManifest(big).valid, false);
  });
});

describe("planTeamInstall", () => {
  const manifest = buildTeamManifest({
    name: "Daily Brief",
    bots: team,
    providers,
  }).manifest;

  it("makes a new bot per role on the target dashboard, asking before external actions", () => {
    const plan = planTeamInstall(manifest, { workspaceId: "ws2", providers });
    assert.deepEqual(
      plan.members.map((m) => m.role),
      ["agenda", "inbox", "writer"],
    );
    const inboxDef = plan.members[1].definition;
    assert.equal(inboxDef.workspaceId, "ws2");
    assert.equal(inboxDef.approvalPolicy, "ask");
    assert.equal(plan.members[1].fileApprovalPolicy, "allow");
    assert.equal(inboxDef.id, undefined);
    assert.deepEqual(inboxDef.subscriptions, []);
  });

  it("uses the only provider of a type, with its tool choices", () => {
    const plan = planTeamInstall(manifest, { workspaceId: "ws2", providers });
    const a = plan.members[0];
    assert.deepEqual(a.definition.mcpServers, ["Google Calendar"]);
    assert.deepEqual(a.definition.toolSelections, {
      "Google Calendar": ["list-events", "get-current-time"],
    });
    assert.deepEqual(a.needs, [
      {
        type: "google-calendar",
        options: ["Google Calendar"],
        chosen: "Google Calendar",
      },
    ]);
  });

  it("asks when there are several of a type, and honours the user's choice", () => {
    const two = [...providers, { name: "Gmail Work", type: "gmail" }];
    let plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers: two,
    });
    assert.deepEqual(plan.members[1].needs[0], {
      type: "gmail",
      options: ["Gmail 3", "Gmail Work"],
      chosen: null,
    });
    assert.deepEqual(plan.members[1].definition.mcpServers, []);
    plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers: two,
      choices: { inbox: { gmail: "Gmail Work" } },
    });
    assert.deepEqual(plan.members[1].definition.mcpServers, ["Gmail Work"]);
  });

  it("ignores a choice that isn't a provider of that type", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers,
      choices: { inbox: { gmail: "Claude" } },
    });
    assert.deepEqual(plan.members[1].definition.mcpServers, ["Gmail 3"]);
  });

  it("installs a member without a provider it can't find, and says so", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers: providers.filter((p) => p.type !== "filesystem"),
    });
    const w = plan.members[2];
    assert.deepEqual(w.definition.mcpServers, []);
    assert.deepEqual(w.needs, [
      { type: "filesystem", options: [], chosen: null },
    ]);
  });

  it("keeps Claude Code or an AI provider the user has; otherwise the default", () => {
    const m = JSON.parse(JSON.stringify(manifest));
    m.members[0].embedded.modelSource = "claude-code";
    m.members[1].embedded.modelSource = "openai";
    m.members[2].embedded.modelSource = "anthropic";
    const plan = planTeamInstall(m, { workspaceId: "ws2", providers });
    assert.equal(plan.members[0].definition.provider, "claude-code");
    assert.equal(plan.members[1].definition.provider, null);
    assert.equal(plan.members[2].definition.provider, "anthropic");
  });

  it("describes the wiring between roles", () => {
    const plan = planTeamInstall(manifest, { workspaceId: "ws2", providers });
    assert.deepEqual(plan.wiring, [
      { role: "inbox", on: { role: "agenda", event: "completed" } },
      {
        role: "writer",
        on: { role: "inbox", event: "tool.gmail.search_emails" },
      },
    ]);
  });
});

describe("wireTeam", () => {
  it("turns role wiring into the new bots' subscriptions", () => {
    const created = {
      agenda: { id: "bot_n1", ref: "local/agenda", name: "Agenda" },
      inbox: { id: "bot_n2", ref: "local/inbox", name: "Inbox" },
      writer: { id: "bot_n3", ref: "local/writer", name: "Writer" },
    };
    const subs = wireTeam(
      [
        { role: "inbox", on: { role: "agenda", event: "completed" } },
        {
          role: "writer",
          on: { role: "inbox", event: "tool.gmail.search_emails" },
        },
        { role: "writer", on: { role: "missing", event: "completed" } },
      ],
      created,
    );
    assert.deepEqual(subs, {
      inbox: [
        {
          eventType: "bot:local/agenda[bot_n1].completed",
          source: {
            kind: "bot",
            ref: "local/agenda",
            instanceId: "bot_n1",
            event: "completed",
          },
          label: "Agenda › Completed",
        },
      ],
      writer: [
        {
          eventType: "bot:local/inbox[bot_n2].tool.gmail.search_emails",
          source: {
            kind: "bot",
            ref: "local/inbox",
            instanceId: "bot_n2",
            event: "tool.gmail.search_emails",
          },
          label: "Inbox › tool.gmail.search_emails",
        },
      ],
    });
  });
});

describe("planTeamInstall — picking bots (TEAM-007 slice 3b)", () => {
  const manifest = buildTeamManifest({
    name: "Daily Brief",
    bots: team,
    providers,
  }).manifest;
  // Agenda and Writer mention team memory; Inbox doesn't (in this fixture).
  manifest.members[0].embedded.instructions =
    "Save the list to team memory under brief/agenda.";
  manifest.members[2].embedded.instructions =
    "Read brief/inbox from team memory, write the file.";

  it("installs every bot when none are picked out", () => {
    const plan = planTeamInstall(manifest, { workspaceId: "ws2", providers });
    assert.deepEqual(
      plan.members.map((m) => m.role),
      ["agenda", "inbox", "writer"],
    );
    assert.deepEqual(plan.droppedWiring, []);
    assert.deepEqual(plan.sharedMemory, []);
  });

  it("installs only the picked bots, wiring only between them", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers,
      roles: ["agenda", "writer"],
    });
    assert.deepEqual(
      plan.members.map((m) => m.role),
      ["agenda", "writer"],
    );
    assert.deepEqual(plan.wiring, []);
  });

  it("reports triggers a picked bot loses because its source wasn't picked", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers,
      roles: ["agenda", "writer"],
    });
    assert.deepEqual(plan.droppedWiring, [
      {
        role: "writer",
        on: { role: "inbox", event: "tool.gmail.search_emails" },
      },
    ]);
  });

  it("flags picked bots that rely on team memory when the team is split", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers,
      roles: ["writer"],
    });
    assert.deepEqual(plan.sharedMemory, ["writer"]);
  });

  it("ignores roles that aren't in the team", () => {
    const plan = planTeamInstall(manifest, {
      workspaceId: "ws2",
      providers,
      roles: ["inbox", "ghost"],
    });
    assert.deepEqual(
      plan.members.map((m) => m.role),
      ["inbox"],
    );
  });
});

describe("trigger notes travel with the team (TEAM-014)", () => {
  const NOTE = "Read 3 records from the index the planner chose.";
  const planner = {
    id: "bot_p",
    ref: "local/planner",
    name: "Planner",
    workspaceId: "ws1",
    instructions: "Plan the schema.",
    provider: "claude-code",
    mcpServers: [],
    schedules: [],
    subscriptions: [],
  };
  const reader = {
    id: "bot_r",
    ref: "local/reader",
    name: "Reader",
    workspaceId: "ws1",
    instructions: "Read records.",
    provider: "claude-code",
    mcpServers: [],
    schedules: [],
    subscriptions: [
      {
        eventType: "bot:local/planner[bot_p].completed",
        source: {
          kind: "bot",
          ref: "local/planner",
          instanceId: "bot_p",
          event: "completed",
        },
        label: "Planner › Completed",
        note: NOTE,
      },
    ],
  };
  const { manifest } = buildTeamManifest({
    name: "Enrichment",
    bots: [planner, reader],
    providers: [],
  });

  it("export keeps the note on the wiring", () => {
    assert.deepEqual(manifest.wiring, [
      {
        role: "reader",
        on: { role: "planner", event: "completed" },
        note: NOTE,
      },
    ]);
  });

  it("the file check keeps it, and rejects one that's too long", () => {
    const ok = validateTeamManifest(manifest);
    assert.equal(ok.valid, true);
    assert.equal(ok.manifest.wiring[0].note, NOTE);
    const bad = validateTeamManifest({
      ...manifest,
      wiring: [{ ...manifest.wiring[0], note: "x".repeat(2001) }],
    });
    assert.equal(bad.valid, false);
  });

  it("install puts it back on the new bot's trigger", () => {
    const plan = planTeamInstall(validateTeamManifest(manifest).manifest, {
      workspaceId: "ws2",
      providers: [],
    });
    assert.equal(plan.wiring[0].note, NOTE);
    const subs = wireTeam(plan.wiring, {
      planner: { id: "bot_n1", ref: "local/planner", name: "Planner" },
      reader: { id: "bot_n2", ref: "local/reader", name: "Reader" },
    });
    assert.equal(subs.reader[0].note, NOTE);
  });

  it("a trigger without a note stays without one", () => {
    const subs = wireTeam(
      [{ role: "reader", on: { role: "planner", event: "failed" } }],
      {
        planner: { id: "bot_n1", ref: "local/planner", name: "Planner" },
        reader: { id: "bot_n2", ref: "local/reader", name: "Reader" },
      },
    );
    assert.equal("note" in subs.reader[0], false);
  });
});
