/**
 * flowStore.test.js — a dashboard's flows, one folder each: saved and
 * read back, the version going up on each save, found by name or by their
 * source bot, and their own files (scripts/, checks/, data/) kept inside
 * the flow's folder only.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFlowStore } = require("./flowStore");

let dir;
let store;
const changes = [];

const flowInput = (over = {}) => ({
  workspaceId: "ws1",
  name: "Morning brief",
  steps: [
    { id: "step_src", kind: "source", name: "Calendar", botId: "bot_src" },
    { id: "step_w", kind: "bot", name: "Writer", botId: "bot_w" },
  ],
  edges: [{ from: "step_src", to: "step_w", kind: "next" }],
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-flows-"));
  changes.length = 0;
  store = createFlowStore({ root: dir, onChange: (c) => changes.push(c) });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("createFlowStore", () => {
  it("saves a flow in its own folder and reads it back after a restart", () => {
    const { flow } = store.create(flowInput());
    assert.match(flow.id, /^flow_/);
    assert.equal(flow.version, 1);
    for (const f of ["flow.json", "scripts", "checks", "data"]) {
      assert.ok(fs.existsSync(path.join(dir, flow.id, f)), f);
    }
    const again = createFlowStore({ root: dir });
    assert.equal(again.get(flow.id).name, "Morning brief");
    assert.equal(changes[0].workspaceId, "ws1");
  });

  it("each save bumps the version", () => {
    const { flow } = store.create(flowInput());
    const r = store.update(flow.id, { ...flow, name: "Brief" });
    assert.equal(r.flow.version, 2);
    assert.equal(r.flow.name, "Brief");
  });

  it("refuses a flow with no dashboard or no steps", () => {
    assert.match(
      store.create(flowInput({ workspaceId: null })).error,
      /dashboard/,
    );
    assert.match(store.create(flowInput({ steps: [] })).error, /step/);
  });

  it("resolve: by name on its dashboard, or the flow a source bot starts", () => {
    const { flow } = store.create(flowInput());
    assert.equal(
      store.resolve({ name: "morning brief", workspaceId: "ws1" }).id,
      flow.id,
    );
    assert.match(
      store.resolve({ name: "Nope", workspaceId: "ws1" }).error,
      /"Morning brief"/,
    );
    assert.equal(
      store.resolve({ botId: "bot_src", workspaceId: "ws1" }).id,
      flow.id,
    );
    assert.equal(store.resolve({ botId: "bot_w", workspaceId: "ws1" }), null);
    assert.equal(store.resolve({ botId: "bot_src", workspaceId: "ws2" }), null);
  });

  it("its files stay inside its folders", () => {
    const { flow } = store.create(flowInput());
    assert.ok(
      store.writeFile(flow.id, "scripts/check-links.js", "console.log(1)").ok,
    );
    assert.equal(
      store.readFile(flow.id, "scripts/check-links.js"),
      "console.log(1)",
    );
    assert.deepEqual(
      store.listFiles(flow.id).map((f) => f.ref),
      ["scripts/check-links.js"],
    );
    assert.ok(store.writeFile(flow.id, "../escape.js", "x").error);
    assert.ok(store.writeFile(flow.id, "scripts/../../x.js", "x").error);
    assert.ok(store.writeFile(flow.id, "secrets/x.js", "x").error);
    assert.equal(store.readFile(flow.id, "scripts/../flow.json"), null);
    assert.ok(store.removeFile(flow.id, "scripts/check-links.js").ok);
    assert.deepEqual(store.listFiles(flow.id), []);
  });

  it("copy in from this computer keeps the file with the flow", () => {
    const { flow } = store.create(flowInput());
    const src = path.join(dir, "words.txt");
    fs.writeFileSync(src, "cheap\nfree");
    assert.ok(store.copyIn(flow.id, src, "data").ok);
    assert.equal(store.readFile(flow.id, "data/words.txt"), "cheap\nfree");
  });

  it("deleting a dashboard's flows removes their folders", () => {
    const { flow } = store.create(flowInput());
    store.create(flowInput({ workspaceId: "ws2" }));
    assert.deepEqual(store.removeForWorkspace("ws1"), [flow.id]);
    assert.equal(fs.existsSync(path.join(dir, flow.id)), false);
    assert.equal(store.list().length, 1);
  });
});
