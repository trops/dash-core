/**
 * flowShare.test.js — publish, install and update a flow (phase 7), between
 * two test profiles with a stand-in registry: the zip one publishes is what
 * the other downloads.
 *
 *  - a flow published from one profile installs on another (its bots on
 *    Ask, providers matched by type, its files written, scripts read first)
 *  - nothing private goes out: goals, folders, files only on this computer;
 *    a key in a file stops the publish
 *  - an update with a changed script asks you to approve it again; where
 *    you changed a bot too, you keep yours or take theirs
 *  - a goal already running finishes on the version it started with
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFlowStore } = require("./flowStore");
const { createGoalStore } = require("../goals/goalStore");
const { createFlowShare } = require("./flowShare");
const {
  findSecrets,
  buildFlowPackage,
  publishChecks,
} = require("./flowPackage");

let dir;
let registry;

/** One test profile: its flows, goals and bots. */
function profile(name, { providers = [] } = {}) {
  const root = path.join(dir, name);
  const store = createFlowStore({ root: path.join(root, "flows") });
  const goals = createGoalStore({ root: path.join(root, "goals") });
  const botMap = new Map();
  let n = 0;
  const bots = {
    listBots: (ws) =>
      [...botMap.values()].filter((b) => String(b.workspaceId) === String(ws)),
    getBot: (id) => botMap.get(id) || null,
    saveBot: (def) => {
      if (def.id && botMap.has(def.id)) {
        const next = { ...botMap.get(def.id), ...def };
        botMap.set(def.id, next);
        return next;
      }
      const bot = {
        approvalPolicy: "ask",
        mcpServers: [],
        schedules: [],
        ...def,
        id: `bot_${name}_${++n}`,
      };
      botMap.set(bot.id, bot);
      return bot;
    },
    deleteBot: (id) => botMap.delete(id),
    resumeBot: () => {},
    providers: () => providers,
  };
  const share = createFlowShare({
    store,
    goals: () => goals,
    bots,
    identity: async () => ({
      signedIn: true,
      username: name,
      displayName: name,
    }),
    publishZip: async (files, manifest) => {
      const key = `${manifest.scope}/${manifest.name}`;
      const versions = registry.get(key) || [];
      versions.push({
        manifest,
        files: Object.fromEntries(files.map((f) => [f.name, f.text])),
      });
      registry.set(key, versions);
      return { success: true };
    },
    download: async (ref) => {
      const key = ref.replace(/^@/, "");
      const versions = registry.get(key);
      if (!versions) return { error: "Not found" };
      const last = versions[versions.length - 1];
      return {
        files: last.files,
        pkg: {
          scope: last.manifest.scope,
          name: last.manifest.name,
          version: last.manifest.version,
          type: "flow",
        },
      };
    },
    latest: async (ref) => {
      const versions = registry.get(ref.replace(/^@/, ""));
      return versions
        ? { version: versions[versions.length - 1].manifest.version }
        : { error: "Not found" };
    },
  });
  return { store, goals, bots, share, botMap };
}

const CHECK_SCRIPT_V1 =
  'const input = JSON.parse(require("fs").readFileSync(process.env.DASH_INPUT, "utf8"));\nprocess.exit(input.input.ok ? 0 : 1);\n';
const CHECK_SCRIPT_V2 =
  'const input = JSON.parse(require("fs").readFileSync(process.env.DASH_INPUT, "utf8"));\nprocess.exit(input.input.ok && input.input.commit ? 0 : 1);\n';

/** Alice's flow: Builder → a command check (its script in the flow) → You. */
function aliceFlow(alice) {
  const builder = alice.bots.saveBot({
    name: "Builder",
    instructions: "Build it.",
    workspaceId: "ws_a",
    mcpServers: ["My GitHub"],
    projects: ["/Users/alice/code/app"],
    commands: { allowed: ["git", "npm run ci"], blocked: [] },
    runLimits: { minutes: 30 },
  });
  const flow = alice.store.create({
    workspaceId: "ws_a",
    name: "Ticket to PR",
    brief: "from your tickets",
    steps: [
      {
        id: "step_b",
        kind: "bot",
        name: "Builder",
        botId: builder.id,
        outputs: [{ name: "commit", kind: "text" }],
      },
      {
        id: "step_c",
        kind: "check",
        name: "Lint",
        check: { kind: "command", command: "node scripts/check-pr.js" },
      },
      {
        id: "step_l",
        kind: "check",
        name: "Local",
        check: {
          kind: "command",
          command: "node /Users/alice/x.js",
          localFile: "/Users/alice/x.js",
        },
      },
      { id: "step_y", kind: "you", name: "You", action: "Merge the PR" },
    ],
    edges: [
      { from: "step_b", to: "step_c", kind: "next" },
      { from: "step_c", to: "step_l", kind: "next" },
      { from: "step_l", to: "step_y", kind: "next" },
      { from: "step_c", to: "step_b", kind: "fail" },
    ],
  }).flow;
  alice.store.writeFile(flow.id, "scripts/check-pr.js", CHECK_SCRIPT_V1);
  alice.store.writeFile(flow.id, "data/protected-paths.txt", "src/core\n");
  // A goal of Alice's: never published.
  alice.goals.createGoal({ workspaceId: "ws_a", title: "Private goal", flow });
  return { flow, builder };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-flowshare-"));
  registry = new Map();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("publish", () => {
  it("lists what's in it, what it needs and what's left out, with its checks (frame 33)", async () => {
    const alice = profile("alice", {
      providers: [{ name: "My GitHub", type: "github" }],
    });
    const { flow } = aliceFlow(alice);
    const prev = await alice.share.publishPreview(flow.id);
    assert.equal(prev.name, "@alice/ticket-to-pr");
    assert.deepEqual(prev.versions, {
      patch: "1.0.0",
      minor: "1.0.0",
      major: "1.0.0",
    });
    assert.deepEqual(prev.contents.bots, ["Builder"]);
    assert.deepEqual([...prev.contents.files].sort(), [
      "data/protected-paths.txt",
      "scripts/check-pr.js",
    ]);
    assert.deepEqual(prev.needs.providers, ["github"]);
    assert.equal(prev.needs.folder, true);
    const left = prev.leftOut.join(" | ");
    assert.match(left, /1 goals, their runs and proof/);
    assert.match(left, /What its bots learned/);
    assert.match(left, /Keys and passwords/);
    assert.match(left, /\/Users\/alice\/code\/app/);
    assert.match(left, /\/Users\/alice\/x\.js \(only on this computer\)/);
    assert.ok(
      prev.checks.every((c) => c.ok),
      JSON.stringify(prev.checks),
    );
  });

  it("a key in a file stops the publish, naming where", async () => {
    const alice = profile("alice");
    const { flow } = aliceFlow(alice);
    alice.store.writeFile(
      flow.id,
      "data/env.txt",
      "GITHUB=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB\n",
    );
    const prev = await alice.share.publishPreview(flow.id);
    assert.equal(prev.checks[1].ok, false);
    const r = await alice.share.publish(flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.0.0",
    });
    assert.match(r.error, /a GitHub token in data\/env\.txt/);
    assert.equal(registry.size, 0);
  });

  it("the zip never carries the folder path, the local file, goals or bot ids", async () => {
    const alice = profile("alice", {
      providers: [{ name: "My GitHub", type: "github" }],
    });
    const { flow, builder } = aliceFlow(alice);
    const r = await alice.share.publish(flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.0.0",
    });
    assert.equal(r.ok, true);
    const zip = registry.get("alice/ticket-to-pr")[0].files;
    const all = Object.values(zip).join("\n");
    assert.doesNotMatch(all, /\/Users\/alice/);
    assert.doesNotMatch(all, /Private goal/);
    assert.doesNotMatch(all, new RegExp(builder.id));
    assert.doesNotMatch(all, /My GitHub/);
    assert.ok(zip["files/scripts/check-pr.js"]);
    const manifest = JSON.parse(zip["manifest.json"]);
    assert.equal(manifest.type, "flow");
    assert.deepEqual(
      manifest.flow.steps.map((s) => s.kind),
      ["bot", "check", "check", "you"],
    );
  });
});

describe("install on another profile (frame 34)", () => {
  it("a flow published from one profile installs on another", async () => {
    const alice = profile("alice", {
      providers: [{ name: "My GitHub", type: "github" }],
    });
    const { flow } = aliceFlow(alice);
    await alice.share.publish(flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.0.0",
    });

    const bob = profile("bob", {
      providers: [{ name: "GitHub · bob", type: "github" }],
    });
    const prev = await bob.share.installPreview("@alice/ticket-to-pr");
    assert.equal(prev.ok, true, prev.error);
    assert.deepEqual(prev.bots, ["Builder"]);
    assert.deepEqual(prev.needs.providers, [
      { type: "github", options: ["GitHub · bob"] },
    ]);
    assert.equal(prev.needs.folder, true);
    // Everything that runs: its script, the check's command, and what the bot may run without asking.
    assert.deepEqual(
      prev.scripts.map((s) => s.ref),
      [
        "scripts/check-pr.js",
        "Lint · its command",
        "Builder · runs without asking",
      ],
    );
    assert.deepEqual(prev.scripts[0].usedBy, ["Lint"]);
    assert.equal(prev.scripts[2].text, "git\nnpm run ci");

    // Not before the script is read, nor without a folder.
    assert.match(
      bob.share.install(prev.previewId, {
        workspaceId: "ws_b",
        folder: "/Users/bob/app",
      }).error,
      /Read its scripts/,
    );
    assert.match(
      bob.share.install(prev.previewId, {
        workspaceId: "ws_b",
        scriptsRead: true,
      }).error,
      /folder/,
    );
    const r = bob.share.install(prev.previewId, {
      workspaceId: "ws_b",
      folder: "/Users/bob/app",
      scriptsRead: true,
      providers: { github: "GitHub · bob" },
    });
    assert.equal(r.ok, true, r.error);
    const installed = bob.store.get(r.flow.id);
    const bot = bob.bots.getBot(installed.steps[0].botId);
    assert.equal(bot.name, "Builder");
    assert.equal(bot.approvalPolicy, "ask");
    assert.deepEqual(bot.mcpServers, ["GitHub · bob"]);
    assert.deepEqual(bot.projects, ["/Users/bob/app"]);
    assert.deepEqual(bot.commands.allowed, ["git", "npm run ci"]);
    assert.equal(
      bob.store.readFile(installed.id, "scripts/check-pr.js"),
      CHECK_SCRIPT_V1,
    );
    assert.equal(installed.package.version, "1.0.0");
    // The local-only check came without its file.
    assert.equal(
      installed.steps.find((s) => s.name === "Local").check.localFile,
      undefined,
    );
  });
});

describe("update (frames 35–36)", () => {
  async function installed() {
    const alice = profile("alice", {
      providers: [{ name: "My GitHub", type: "github" }],
    });
    const a = aliceFlow(alice);
    await alice.share.publish(a.flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.0.0",
    });
    const bob = profile("bob", {
      providers: [{ name: "GitHub · bob", type: "github" }],
    });
    const prev = await bob.share.installPreview("@alice/ticket-to-pr");
    const r = bob.share.install(prev.previewId, {
      workspaceId: "ws_b",
      folder: "/Users/bob/app",
      scriptsRead: true,
      providers: { github: "GitHub · bob" },
    });
    return { alice, a, bob, bobFlow: r.flow };
  }

  it("a changed script asks again; your own change is keep yours or take theirs; running goals keep their version", async () => {
    const { alice, a, bob, bobFlow } = await installed();
    // Bob starts a goal on 1.0.0, and changes the Builder's time limit.
    const running = bob.goals.createGoal({
      workspaceId: "ws_b",
      title: "Running one",
      flow: bob.store.get(bobFlow.id),
    }).goal;
    const bobBuilder = bob.store.get(bobFlow.id).steps[0].botId;
    bob.bots.saveBot({ id: bobBuilder, runLimits: { minutes: 45 } });

    // Alice ships 1.1.0: a changed script, a new step, a changed time limit.
    alice.store.writeFile(a.flow.id, "scripts/check-pr.js", CHECK_SCRIPT_V2);
    alice.bots.saveBot({
      id: a.builder.id,
      runLimits: { minutes: 30 },
      instructions: "Build it, with a screenshot per criterion.",
    });
    const cur = alice.store.get(a.flow.id);
    alice.store.update(a.flow.id, {
      ...cur,
      steps: [
        ...cur.steps,
        {
          id: "step_r",
          kind: "bot",
          name: "Reviewer",
          botId: a.builder.id,
          judgment: true,
        },
      ],
    });
    alice.bots.saveBot({ id: a.builder.id, runLimits: { minutes: 30 } });
    const aliceBot = alice.bots.getBot(a.builder.id);
    alice.bots.saveBot({
      id: aliceBot.id,
      runLimits: { minutes: 30, steps: 80 },
    });
    await alice.share.publish(a.flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.1.0",
    });

    const check = await bob.share.checkUpdate(bobFlow.id);
    assert.deepEqual([check.available, check.version], [true, "1.1.0"]);
    const prev = await bob.share.updatePreview(bobFlow.id);
    assert.equal(prev.ok, true, prev.error);
    assert.equal(prev.from, "1.0.0");
    assert.equal(prev.to, "1.1.0");
    const texts = prev.changes.map((c) => c.text);
    assert.ok(texts.includes("Adds a step: Reviewer"), texts.join(" | "));
    assert.ok(texts.includes("Changes scripts/check-pr.js"), texts.join(" | "));
    assert.deepEqual(
      prev.scripts.map((s) => s.ref),
      ["scripts/check-pr.js"],
    );
    assert.equal(prev.scripts[0].before, CHECK_SCRIPT_V1);
    assert.equal(prev.scripts[0].after, CHECK_SCRIPT_V2);
    const conflict = prev.conflicts.find((c) => c.field === "runLimits");
    assert.ok(conflict, JSON.stringify(prev.conflicts));
    assert.deepEqual(conflict.mine, { minutes: 45 });
    assert.equal(prev.running, 1);

    // The changed script needs your OK again.
    assert.match(bob.share.update(prev.previewId, {}).error, /changed scripts/);
    const r = bob.share.update(prev.previewId, {
      approveScripts: true,
      keep: { [conflict.id]: "mine" },
    });
    assert.equal(r.ok, true, r.error);
    const after = bob.store.get(bobFlow.id);
    assert.equal(after.package.version, "1.1.0");
    assert.ok(after.steps.some((s) => s.name === "Reviewer"));
    assert.equal(
      bob.store.readFile(bobFlow.id, "scripts/check-pr.js"),
      CHECK_SCRIPT_V2,
    );
    // Kept mine.
    assert.deepEqual(bob.bots.getBot(bobBuilder).runLimits, { minutes: 45 });
    // The goal already running finishes on 1.0.0's steps.
    const g = bob.goals.getGoal(running.id);
    assert.ok(!g.flow.steps.some((s) => s.name === "Reviewer"));
    assert.equal((await bob.share.checkUpdate(bobFlow.id)).available, false);
  });

  it("skip this version: no update shown until the next one", async () => {
    const { alice, a, bob, bobFlow } = await installed();
    await alice.share.publish(a.flow.id, {
      name: "@alice/ticket-to-pr",
      version: "1.0.1",
    });
    assert.equal((await bob.share.checkUpdate(bobFlow.id)).available, true);
    bob.share.skipVersion(bobFlow.id, "1.0.1");
    assert.equal((await bob.share.checkUpdate(bobFlow.id)).available, false);
  });
});

describe("flowPackage", () => {
  it("findSecrets knows keys and tokens from ordinary text", () => {
    assert.deepEqual(findSecrets("sk-ant-api03-abcdefghijklmnopqrstuvwxyz"), [
      "an Anthropic or OpenAI key",
    ]);
    assert.deepEqual(findSecrets('const password = "hunter2hunter2hunter2"'), [
      "a password or key written in",
    ]);
    assert.deepEqual(findSecrets("node scripts/check-links.js"), []);
  });

  it("publishChecks: an unchecked AI step fails the first check", () => {
    const { pkg, secrets } = buildFlowPackage({
      flow: {
        name: "x",
        steps: [
          { id: "step_a", kind: "bot", name: "Writer", botId: "b1" },
          { id: "step_b", kind: "bot", name: "Sender", botId: "b2" },
        ],
        edges: [{ from: "step_a", to: "step_b", kind: "next" }],
      },
      bots: [
        {
          id: "b1",
          name: "Writer",
          instructions: "w",
          mcpServers: [],
          schedules: [],
        },
        {
          id: "b2",
          name: "Sender",
          instructions: "s",
          mcpServers: [],
          schedules: [],
        },
      ],
    });
    assert.equal(publishChecks(pkg, secrets)[0].ok, false);
  });
});
