/**
 * issueController — issues kept on disk and told to every window.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");
const issueController = require("./issueController");

const failed = {
  asset: { kind: "provider", provider: "Notes MCP", name: "Notes MCP" },
  title: "Notes MCP couldn't start",
  message: "spawn ENOENT",
};

function windows() {
  const sent = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: (ch, payload) => sent.push([ch, payload]) },
  };
  return { sent, getWindows: () => [win] };
}

describe("issueController", () => {
  beforeEach(() => issueController._reset());

  it("records, tells every window, and keeps them on disk", () => {
    const dir = tempDir("zz-issues-");
    const w = windows();
    issueController.init({ dataDir: dir, getWindows: w.getWindows });
    const issue = issueController.record(failed);
    assert.equal(issue.title, "Notes MCP couldn't start");
    assert.equal(w.sent[0][0], "issues:changed");
    assert.deepEqual(w.sent[0][1].counts, {
      total: 1,
      widget: 0,
      bot: 0,
      provider: 1,
      muted: 0,
    });
    issueController.flush();
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, "dash-issues.json"), "utf8"),
    );
    assert.equal(JSON.parse(saved.sealed).length, 1);

    issueController._reset();
    issueController.init({ dataDir: dir });
    assert.equal(issueController.list().length, 1);
  });

  it("resolves, resolves what worked again, and clears resolved", () => {
    const dir = tempDir("zz-issues-");
    const w = windows();
    issueController.init({ dataDir: dir, getWindows: w.getWindows });
    const issue = issueController.record(failed);
    assert.equal(issueController.resolve(issue.id), true);
    assert.equal(issueController.counts().total, 0);
    issueController.record(failed);
    assert.equal(issueController.resolveAsset(failed.asset), 1);
    assert.equal(issueController.clearResolved(), 1);
    assert.equal(issueController.list({ status: "all" }).length, 0);
    assert.ok(w.sent.length >= 4);
  });

  it("takes the renderer's facts: a widget's failed call, then the same call working", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    const call = {
      from: "widget-call",
      component: "ai-built.shoppinglist.ShoppingList",
      itemId: "11",
      workspaceId: "7301",
      widgetName: "Shopping List",
      provider: "Notes MCP",
      tool: "search_notes",
      args: { query: "shopping list" },
      error: "connect ECONNREFUSED 127.0.0.1:3845",
    };
    const issue = issueController.record(call);
    assert.equal(issue.title, "Shopping List: Notes MCP › search_notes failed");
    assert.match(issue.hint, /isn't answering/);
    assert.equal(issueController.resolveWorked({ ...call, error: "" }), 1);
    assert.equal(issueController.counts().total, 0);
    const crash = issueController.record({
      from: "widget-crash",
      component: "a.b.Weather",
      itemId: "3",
      workspaceId: "7301",
      message: "x is undefined",
    });
    assert.equal(crash.title, "Weather couldn't show");
  });

  it("keeps the list sealed at rest when the OS has a keychain", () => {
    const { createSecretBox } = require("../bots/secretBox");
    const secretBox = createSecretBox({
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from("X" + s, "utf8"),
      decryptString: (b) => b.toString("utf8").slice(1),
    });
    const dir = tempDir("zz-issues-");
    issueController.init({ dataDir: dir, secretBox });
    issueController.record({
      ...failed,
      message: "search for 'private thing' failed",
    });
    issueController.flush();
    const raw = fs.readFileSync(path.join(dir, "dash-issues.json"), "utf8");
    assert.doesNotMatch(raw, /private thing/);
    assert.match(JSON.parse(raw).sealed, /^enc:v1:/);
    issueController._reset();
    issueController.init({ dataDir: dir, secretBox });
    assert.match(issueController.list()[0].message, /private thing/);
  });

  it("ignores something that isn't an issue", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    assert.equal(issueController.record({ title: "no asset" }), null);
  });
});

describe("issueController — things that are gone, and a file it can't read", () => {
  beforeEach(() => issueController._reset());

  const widgetFail = (itemId, workspaceId = 7) => ({
    from: "widget-call",
    component: "ai-built.notes.NotesView",
    itemId,
    workspaceId,
    provider: "Notes MCP",
    tool: "list_notes",
    error: "not connected",
  });

  it("a deleted bot or provider takes its issues with it", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    issueController.record(failed);
    issueController.record({
      asset: { kind: "bot", botId: "bot_1", name: "Digest" },
      title: "Digest's run failed",
    });
    assert.equal(
      issueController.forgetAsset({ kind: "provider", provider: "Notes MCP" }),
      1,
    );
    assert.equal(
      issueController.forgetAsset({ kind: "bot", botId: "bot_1" }),
      1,
    );
    assert.equal(issueController.list().length, 0);
  });

  it("a deleted dashboard takes its widgets' issues; others stay", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    issueController.record(widgetFail("u1", 7));
    issueController.record(widgetFail("u2", 8));
    assert.equal(issueController.forgetWorkspace(7), 1);
    assert.deepEqual(
      issueController.list().map((i) => i.asset.itemId),
      ["u2"],
    );
  });

  it("a saved dashboard drops issues of widgets no longer on it (pages included)", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    issueController.record(widgetFail("kept-on-page"));
    issueController.record(widgetFail("removed"));
    const n = issueController.sweepWorkspace({
      id: 7,
      layout: [],
      pages: [
        {
          layout: [
            { id: 1, component: "LayoutGridContainer" },
            {
              id: 2,
              parent: 1,
              uuid: "kept-on-page",
              component: "ai-built.notes.NotesView",
            },
          ],
        },
      ],
    });
    assert.equal(n, 1);
    assert.deepEqual(
      issueController.list().map((i) => i.asset.itemId),
      ["kept-on-page"],
    );
  });

  it("a completed run clears the failure but keeps the warning", () => {
    issueController.init({ dataDir: tempDir("zz-issues-") });
    const asset = { kind: "bot", botId: "bot_2", name: "Digest" };
    issueController.record({ asset, title: "Digest's run failed" });
    issueController.record({
      asset,
      severity: "warning",
      title: "Digest: Notes MCP wasn't available",
    });
    assert.equal(
      issueController.resolveAsset(asset, { severity: "problem" }),
      1,
    );
    assert.deepEqual(
      issueController.list({ status: "open" }).map((i) => i.severity),
      ["warning"],
    );
  });

  it("a file sealed by a keychain it can't open is left as it is", () => {
    const dir = tempDir("zz-issues-");
    const file = path.join(dir, "dash-issues.json");
    const sealed = JSON.stringify({ v: 2, sealed: "enc:v1:abc" });
    fs.writeFileSync(file, sealed);
    issueController.init({
      dataDir: dir,
      secretBox: { seal: (s) => s, open: () => null },
    });
    issueController.record(failed);
    issueController.flush();
    assert.equal(fs.readFileSync(file, "utf8"), sealed);
  });
});

describe("issueController — muting", () => {
  beforeEach(() => issueController._reset());

  it("mute and unmute tell every window; a muted repeat isn't open, and it's saved", () => {
    const dir = tempDir("zz-issues-");
    const w = windows();
    issueController.init({ dataDir: dir, getWindows: w.getWindows });
    const issue = issueController.record(failed);
    assert.equal(issueController.mute(issue.id), true);
    assert.equal(w.sent.at(-1)[1].counts.muted, 1);
    assert.equal(w.sent.at(-1)[1].counts.total, 0);
    const before = w.sent.length;
    issueController.record(failed);
    assert.equal(issueController.counts().total, 0);
    // Counted quietly: no window is told (nothing to reload).
    assert.equal(w.sent.length, before);
    issueController.flush();

    issueController._reset();
    issueController.init({ dataDir: dir });
    const [m] = issueController.list({ status: "muted" });
    assert.equal(m.mutedCount, 1);
    assert.equal(issueController.unmute(m.id), true);
    assert.equal(issueController.counts().total, 1);
    assert.equal(issueController.unmute(m.id), false);
  });
});
