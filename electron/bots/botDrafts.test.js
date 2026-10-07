/**
 * botDrafts.test.js — a team lead's proposed bot (bot-teams TEAM-005):
 * validated against what the user actually has, stored as a draft, never
 * saved or run by the lead.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildDraft, DraftStore } = require("./botDrafts");

const WS = "1774291410862";
const sources = [
  {
    name: "Gmail New",
    type: "gmail",
    tools: ["search_emails", "read_email", "send_email"],
  },
  { name: "Slack", type: "slack", tools: null }, // tools unknown (not running, none declared)
];
const team = [
  {
    id: "lead_1",
    role: "lead",
    name: "Kitchen Sinkq Lead",
    workspaceId: WS,
    ref: "local/kitchen-sinkq-lead",
  },
  { id: "b1", name: "Inbox Watch", workspaceId: WS, ref: "local/inbox-watch" },
];
const build = (proposal) =>
  buildDraft({
    proposal,
    sources,
    team,
    workspaceId: WS,
    leadId: "lead_1",
    now: () => "2026-10-02T12:00:00.000Z",
  });

describe("buildDraft", () => {
  it("drafts a bot on this dashboard with nothing granted", () => {
    const { draft } = build({
      name: "  Morning Inbox Digest ",
      instructions: "Summarise urgent emails.",
      reasoning: "You asked for a morning summary.",
      providers: [
        { name: "Gmail New", tools: ["search_emails", "read_email"] },
      ],
      schedule: { cron: "0 8 * * *", prompt: "Morning digest" },
    });
    assert.equal(draft.definition.name, "Morning Inbox Digest");
    assert.equal(draft.definition.workspaceId, WS);
    // Suggestions only — the bot's own providers/tools start empty.
    assert.deepEqual(draft.definition.mcpServers, []);
    assert.deepEqual(draft.definition.toolSelections, {});
    assert.equal(draft.definition.approvalPolicy, "ask");
    assert.deepEqual(draft.definition.schedules, [
      { cron: "0 8 * * *", prompt: "Morning digest" },
    ]);
    assert.deepEqual(draft.suggestions, [
      {
        provider: "Gmail New",
        tools: ["search_emails", "read_email"],
        toolsChecked: true,
      },
    ]);
    assert.equal(draft.reasoning, "You asked for a morning summary.");
    assert.equal(draft.leadId, "lead_1");
    assert.equal(draft.workspaceId, WS);
    assert.ok(draft.id);
  });

  it("drops tools the provider doesn't have, and flags providers you don't have", () => {
    const { draft } = build({
      name: "X",
      instructions: "y",
      providers: [
        { name: "Gmail New", tools: ["search_emails", "delete_everything"] },
        { name: "Microsoft Teams", tools: ["post"] },
      ],
      needs: ["Notion"],
    });
    assert.deepEqual(draft.suggestions, [
      { provider: "Gmail New", tools: ["search_emails"], toolsChecked: true },
    ]);
    assert.deepEqual(draft.missing, ["Microsoft Teams", "Notion"]);
    assert.ok(draft.dropped.some((d) => /delete_everything/.test(d)));
  });

  it("keeps tools it can't check, marked unchecked", () => {
    const { draft } = build({
      name: "X",
      instructions: "y",
      providers: [{ name: "slack", tools: ["post_message"] }],
    });
    assert.deepEqual(draft.suggestions, [
      { provider: "Slack", tools: ["post_message"], toolsChecked: false },
    ]);
  });

  it("drops an invalid schedule", () => {
    const { draft } = build({
      name: "X",
      instructions: "y",
      schedule: { cron: "every morning" },
    });
    assert.deepEqual(draft.definition.schedules, []);
    assert.ok(draft.dropped.some((d) => /schedule/i.test(d)));
  });

  it("subscribes only to this team's bots' real events", () => {
    const { draft } = build({
      name: "X",
      instructions: "y",
      on: [
        { bot: "inbox watch", event: "completed" },
        { bot: "Inbox Watch", event: "exploded" },
        { bot: "Someone Else", event: "completed" },
      ],
    });
    assert.deepEqual(draft.definition.subscriptions, [
      {
        eventType: "bot:local/inbox-watch[b1].completed",
        label: "Inbox Watch › completed",
        source: {
          kind: "bot",
          ref: "local/inbox-watch",
          instanceId: "b1",
          event: "completed",
          workspaceId: WS,
        },
      },
    ]);
    assert.equal(draft.dropped.filter((d) => /event/i.test(d)).length, 2);
  });

  it("flags a name that duplicates a team member", () => {
    const { draft } = build({ name: "inbox watch", instructions: "y" });
    assert.equal(draft.duplicateOf, "Inbox Watch");
  });

  it("refuses a draft with no name or instructions", () => {
    assert.match(build({ name: "", instructions: "y" }).error, /name/);
    assert.match(build({ name: "X", instructions: " " }).error, /instructions/);
  });

  it("trims runaway text", () => {
    const { draft } = build({
      name: "X",
      instructions: "y".repeat(20000),
      reasoning: "r".repeat(5000),
    });
    assert.ok(draft.definition.instructions.length <= 8000);
    assert.ok(draft.reasoning.length <= 1000);
  });
});

describe("DraftStore", () => {
  const draft = (id, ws = WS) => ({ id, workspaceId: ws, createdAt: id });

  it("keeps up to 10 per dashboard (oldest dropped) and notifies on change", () => {
    const s = new DraftStore();
    let changes = 0;
    s.onChange(() => changes++);
    for (let i = 0; i < 12; i++) s.add(draft(`d${String(i).padStart(2, "0")}`));
    s.add(draft("other", "9"));
    assert.equal(s.list(WS).length, 10);
    assert.equal(s.list(WS)[0].id, "d02");
    assert.equal(s.list("9").length, 1);
    assert.equal(changes, 13);
  });

  it("gets and removes by id", () => {
    const s = new DraftStore();
    s.add(draft("a"));
    assert.equal(s.get("a").id, "a");
    assert.equal(s.remove("a"), true);
    assert.equal(s.get("a"), null);
    assert.equal(s.remove("a"), false);
  });
});

describe("buildDraft — matching providers by type", () => {
  const typed = [
    { name: "Gmail New", type: "gmail", tools: ["search_emails"] },
    { name: "Gmail 3", type: "gmail", tools: ["search_emails"] },
    { name: "Slack", type: "slack", tools: null },
  ];
  const build2 = (proposal) =>
    buildDraft({
      proposal,
      sources: typed,
      team: [],
      workspaceId: "7",
      leadId: "l",
    });

  it("a provider type ('gmail') suggests each provider of that type", () => {
    const { draft } = build2({
      name: "X",
      instructions: "y",
      providers: [{ name: "Gmail", tools: ["search_emails"] }],
    });
    assert.deepEqual(
      draft.suggestions.map((s) => s.provider),
      ["Gmail New", "Gmail 3"],
    );
    assert.deepEqual(draft.missing, []);
  });

  it("lists what the user has when something is missing", () => {
    const { draft } = build2({
      name: "X",
      instructions: "y",
      providers: [{ name: "Notion" }],
    });
    assert.deepEqual(draft.missing, ["Notion"]);
    assert.deepEqual(draft.available, [
      "Gmail New (gmail)",
      "Gmail 3 (gmail)",
      "Slack (slack)",
    ]);
  });
});

describe("buildDraft — needs vs notes", () => {
  it("keeps short provider names as missing and long sentences as notes", () => {
    const { draft } = buildDraft({
      proposal: {
        name: "X",
        instructions: "y",
        needs: [
          "Microsoft Teams",
          "Confirm a Microsoft Teams provider is connected and which channel to post to",
        ],
      },
      sources: [],
      team: [],
      workspaceId: "7",
      leadId: "l",
    });
    assert.deepEqual(draft.missing, ["Microsoft Teams"]);
    assert.deepEqual(draft.notes, [
      "Confirm a Microsoft Teams provider is connected and which channel to post to",
    ]);
  });
});

describe("buildDraft — needs cleanup (5b)", () => {
  const needsOf = (needs) =>
    buildDraft({
      proposal: { name: "X", instructions: "y", needs },
      sources: [],
      team: [],
      workspaceId: "7",
      leadId: "l",
    }).draft;

  it("drops bracketed text and a trailing 'provider' before deciding", () => {
    const d = needsOf([
      "Microsoft Teams provider (to post the summary)",
      "Notion providers",
      "Jira (for tickets)",
    ]);
    assert.deepEqual(d.missing, ["Microsoft Teams", "Notion", "Jira"]);
    assert.deepEqual(d.notes, []);
  });

  it("still treats a real sentence as a note", () => {
    const d = needsOf([
      "Ask the user which Slack channel the summary should be posted to",
    ]);
    assert.deepEqual(d.missing, []);
    assert.equal(d.notes.length, 1);
  });
});

describe("buildDraft — gaps with suggested providers (bot-capabilities CAP-004)", () => {
  const known = {
    "builtin:web-fetch": {
      id: "builtin:web-fetch",
      tier: "built-in",
      name: "Web Fetch",
      install: { kind: "catalog", catalogId: "web-fetch" },
    },
    "community:io.x/img": {
      id: "community:io.x/img",
      tier: "community",
      name: "io.x/img",
      install: { kind: "custom", mcpConfig: { transport: "stdio" } },
    },
    "installed:Gmail New": {
      id: "installed:Gmail New",
      tier: "installed",
      name: "Gmail New",
      install: { kind: "use", providerName: "Gmail New" },
    },
  };
  const buildWith = (proposal) =>
    buildDraft({
      proposal,
      sources,
      team,
      workspaceId: WS,
      leadId: "lead_1",
      knownProviders: known,
      now: () => "2026-10-02T12:00:00.000Z",
    });

  it("keeps suggestions the lead's search returned, as snapshots, best tier first", () => {
    const { draft } = buildWith({
      name: "Image Labeler",
      instructions: "Label product images.",
      gaps: [
        {
          need: "download images",
          suggestions: ["community:io.x/img", "builtin:web-fetch"],
        },
      ],
    });
    assert.equal(draft.gaps.length, 1);
    assert.equal(draft.gaps[0].need, "download images");
    assert.deepEqual(
      draft.gaps[0].suggestions.map((x) => x.id),
      ["builtin:web-fetch", "community:io.x/img"],
    );
    assert.deepEqual(draft.gaps[0].suggestions[0].install, {
      kind: "catalog",
      catalogId: "web-fetch",
    });
    assert.ok(draft.missing.includes("download images"));
  });

  it("drops ids find_providers didn't return, and says so", () => {
    const { draft } = buildWith({
      name: "Image Labeler",
      instructions: "Label product images.",
      gaps: [
        {
          need: "download images",
          suggestions: ["builtin:web-fetch", "community:io.evil/made-up"],
        },
      ],
    });
    assert.deepEqual(
      draft.gaps[0].suggestions.map((x) => x.id),
      ["builtin:web-fetch"],
    );
    assert.match(draft.dropped.join(" "), /io\.evil\/made-up/);
  });

  it("keeps a gap with no valid suggestions (the need is still real)", () => {
    const { draft } = buildWith({
      name: "X",
      instructions: "Y",
      gaps: [{ need: "stock photos", suggestions: ["vetted:nope"] }],
    });
    assert.deepEqual(draft.gaps, [{ need: "stock photos", suggestions: [] }]);
  });

  it("without find_providers results every suggestion is dropped", () => {
    const { draft } = build({
      name: "X",
      instructions: "Y",
      gaps: [{ need: "stock photos", suggestions: ["builtin:web-fetch"] }],
    });
    assert.deepEqual(draft.gaps[0].suggestions, []);
  });

  it("has no gaps when none were proposed", () => {
    const { draft } = build({ name: "X", instructions: "Y" });
    assert.deepEqual(draft.gaps, []);
  });
});
