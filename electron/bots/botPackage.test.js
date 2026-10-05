/**
 * botPackage.test.js — single bots and teams as registry packages (bot-teams
 * TEAM-006 slice 3a, bot-factory US-026): the `bot.json` for one bot, the
 * registry manifest (the summary the registry stores, per dash-registry
 * 1.6.0), package names and versions, and publish-field checks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBotPackage,
  validateBotPackage,
  toTeamManifest,
  registryManifestFor,
  toPackageName,
  nextVersion,
  checkPublishMeta,
  publishFiles,
} = require("./botPackage");
const { buildTeamManifest } = require("./teamManifest");

const providers = [
  { name: "Gmail 3", type: "gmail" },
  { name: "Google Calendar", type: "google-calendar" },
];
const inbox = {
  id: "bot_i",
  name: "Inbox",
  workspaceId: "ws1",
  instructions: "Scan unread mail.",
  provider: "claude-code",
  approvalPolicy: "ask",
  mcpServers: ["Gmail 3", "Mystery"],
  toolSelections: { "Gmail 3": ["search_emails"] },
  allowedTools: ["search_emails"],
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
  ],
  session: { s: 1 },
};

describe("buildBotPackage", () => {
  const { pkg, notIncluded } = buildBotPackage({ bot: inbox, providers });

  it("is a v1 bot package with the bot embedded like a team member", () => {
    assert.equal(pkg.schemaVersion, 1);
    assert.equal(pkg.type, "bot");
    assert.equal(pkg.name, "Inbox");
    assert.equal(pkg.bot.instructions, "Scan unread mail.");
    assert.deepEqual(pkg.bot.providers, [
      { type: "gmail", tools: ["search_emails"] },
    ]);
  });

  it("never carries ids, provider names, grants or sessions", () => {
    const text = JSON.stringify(pkg);
    for (const banned of [
      "bot_i",
      "ws1",
      "Gmail 3",
      "allowedTools",
      "session",
      "bot_a",
    ]) {
      assert.ok(!text.includes(banned), banned);
    }
  });

  it("lists what it couldn't carry, including triggers from other bots", () => {
    assert.deepEqual(notIncluded, [
      'Inbox: the provider "Mystery" (unknown type)',
      'Inbox: the trigger "Agenda › Completed" (another bot)',
    ]);
  });
});

describe("validateBotPackage / toTeamManifest", () => {
  const { pkg } = buildBotPackage({ bot: inbox, providers });

  it("accepts a built package and returns a clean copy", () => {
    const r = validateBotPackage(JSON.parse(JSON.stringify(pkg)));
    assert.equal(r.valid, true, r.errors.join("; "));
    assert.deepEqual(r.pkg, pkg);
  });

  it("drops smuggled fields and rejects the wrong type or a bot without instructions", () => {
    const evil = JSON.parse(JSON.stringify(pkg));
    evil.bot.allowedTools = ["send_email"];
    evil.grants = true;
    const r = validateBotPackage(evil);
    assert.equal(r.valid, true);
    assert.ok(!JSON.stringify(r.pkg).includes("allowedTools"));
    assert.ok(!JSON.stringify(r.pkg).includes("grants"));
    assert.equal(validateBotPackage({ ...pkg, type: "bot-team" }).valid, false);
    const empty = JSON.parse(JSON.stringify(pkg));
    empty.bot.instructions = "";
    assert.equal(validateBotPackage(empty).valid, false);
    assert.equal(validateBotPackage(null).valid, false);
  });

  it("installs as a one-bot team", () => {
    const m = toTeamManifest(pkg);
    assert.equal(m.type, "bot-team");
    assert.deepEqual(
      m.members.map((x) => x.role),
      ["inbox"],
    );
    assert.deepEqual(m.wiring, []);
    assert.equal(m.members[0].embedded.name, "Inbox");
  });
});

describe("registryManifestFor", () => {
  const meta = {
    scope: "trops",
    name: "daily-brief",
    displayName: "Daily Brief",
    version: "1.0.0",
    description: "Morning brief",
    visibility: "private",
    appOrigin: "@trops/dash-electron",
    author: "John",
  };

  it("summarises a team: members by role, wiring, provider types", () => {
    const { manifest: team } = buildTeamManifest({
      name: "Daily Brief",
      bots: [
        {
          ...inbox,
          id: "bot_a",
          name: "Agenda",
          mcpServers: ["Google Calendar"],
          toolSelections: {},
          subscriptions: [],
        },
        inbox,
      ],
      providers,
    });
    const m = registryManifestFor(team, meta);
    assert.deepEqual(m, {
      scope: "trops",
      name: "daily-brief",
      displayName: "Daily Brief",
      version: "1.0.0",
      description: "Morning brief",
      author: "John",
      appOrigin: "@trops/dash-electron",
      visibility: "private",
      type: "bot-team",
      providerTypes: ["google-calendar", "gmail"],
      team: {
        members: [
          { role: "agenda", name: "Agenda" },
          { role: "inbox", name: "Inbox" },
        ],
        wiring: [{ role: "inbox", on: { role: "agenda", event: "completed" } }],
      },
    });
  });

  it("summarises a single bot", () => {
    const { pkg } = buildBotPackage({ bot: inbox, providers });
    const m = registryManifestFor(pkg, {
      ...meta,
      name: "inbox",
      displayName: "Inbox",
    });
    assert.equal(m.type, "bot");
    assert.deepEqual(m.bot, { name: "Inbox" });
    assert.deepEqual(m.providerTypes, ["gmail"]);
    assert.equal(m.team, undefined);
  });

  it("is private unless asked to be public", () => {
    const { pkg } = buildBotPackage({ bot: inbox, providers });
    assert.equal(
      registryManifestFor(pkg, { ...meta, visibility: undefined }).visibility,
      "private",
    );
    assert.equal(
      registryManifestFor(pkg, { ...meta, visibility: "public" }).visibility,
      "public",
    );
  });
});

describe("package names, versions and publish fields", () => {
  it("turns a display name into a registry package name", () => {
    assert.equal(toPackageName("Daily Brief (test)"), "daily-brief-test");
    assert.equal(toPackageName("  2nd Inbox!! "), "bot-2nd-inbox");
    assert.equal(toPackageName("x"), "x-bot");
    assert.equal(toPackageName(""), "my-bot");
    assert.ok(toPackageName("a".repeat(80)).length <= 50);
  });

  it("starts at 1.0.0, then bumps the patch from the last publish", () => {
    assert.equal(nextVersion(null), "1.0.0");
    assert.equal(nextVersion("1.0.0"), "1.0.1");
    assert.equal(nextVersion("2.3.9"), "2.3.10");
    assert.equal(nextVersion("garbage"), "1.0.0");
  });

  it("checks the fields the registry will check", () => {
    const ok = {
      name: "daily-brief",
      displayName: "Daily Brief",
      version: "1.0.0",
      description: "",
    };
    assert.deepEqual(checkPublishMeta(ok), []);
    assert.ok(checkPublishMeta({ ...ok, name: "Daily Brief" }).length);
    assert.ok(checkPublishMeta({ ...ok, name: "a" }).length);
    assert.ok(checkPublishMeta({ ...ok, displayName: "" }).length);
    assert.ok(checkPublishMeta({ ...ok, version: "1.0" }).length);
    assert.ok(checkPublishMeta({ ...ok, description: "x".repeat(501) }).length);
  });
});

describe("publishFiles", () => {
  it("zips the registry manifest with team.json or bot.json", () => {
    const { pkg } = buildBotPackage({ bot: inbox, providers });
    const files = publishFiles(pkg, { name: "inbox" });
    assert.deepEqual(
      files.map((f) => f.name),
      ["manifest.json", "bot.json"],
    );
    assert.deepEqual(JSON.parse(files[1].text), pkg);
    const team = { type: "bot-team", members: [], wiring: [] };
    assert.deepEqual(
      publishFiles(team, {}).map((f) => f.name),
      ["manifest.json", "team.json"],
    );
  });
});
