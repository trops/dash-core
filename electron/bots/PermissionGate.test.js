/**
 * PermissionGate.test.js
 *
 * Pins the bot requestPermission decision ladder (US-003):
 *   paused → deny; server-not-configured → deny w/o prompt; allowedTools →
 *   auto-allow; grant covers → allow; else → pending approval await;
 *   and that every decision is audited.
 *
 * All collaborators are injected (fake gate, fake approvals, fake audit),
 * so this is hermetic and Electron-free.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRequestPermission } = require("./PermissionGate");

// Tool naming convention for the tests: mcp__<server>__<tool>.
function serverOf(toolName) {
  const m = /^mcp__([^_]+)__/.exec(toolName);
  return m ? m[1] : null;
}

function setup(overrides = {}) {
  const audit = [];
  const approvals = [];
  let approvalResolver = null;
  const ctx = {
    botId: "bot_1",
    workspaceId: "ws_1",
    allowedTools: [],
    mcpServers: ["github"],
    resolveServer: serverOf,
    gate: () => ({ allow: false, reason: "no grant" }),
    createApproval: (request) => {
      approvals.push(request);
      const promise = new Promise((resolve) => {
        approvalResolver = resolve;
      });
      return { id: `appr_${approvals.length}`, promise };
    },
    audit: (e) => audit.push(e),
    isPaused: () => false,
    ...overrides,
  };
  return {
    requestPermission: createRequestPermission(ctx),
    audit,
    approvals,
    resolveApproval: (decision) => approvalResolver(decision),
  };
}

describe("createRequestPermission — validation", () => {
  it("requires botId, resolveServer, and createApproval", () => {
    assert.throws(() => createRequestPermission({}), /botId/);
    assert.throws(
      () => createRequestPermission({ botId: "b" }),
      /resolveServer/,
    );
    assert.throws(
      () => createRequestPermission({ botId: "b", resolveServer: () => "s" }),
      /createApproval/,
    );
  });
});

describe("createRequestPermission — decision ladder", () => {
  it("paused → deny before anything else", async () => {
    const { requestPermission, audit, approvals } = setup({
      isPaused: () => true,
      allowedTools: ["mcp__github__list_prs"],
    });
    const d = await requestPermission("mcp__github__list_prs", {});
    assert.equal(d.allow, false);
    assert.match(d.reason, /paused/);
    assert.equal(approvals.length, 0);
    assert.equal(audit[0].outcome, "paused");
  });

  it("server not in mcpServers → deny WITHOUT prompting", async () => {
    const { requestPermission, approvals, audit } = setup();
    const d = await requestPermission("mcp__slack__post_message", {});
    assert.equal(d.allow, false);
    assert.equal(approvals.length, 0);
    assert.equal(audit[0].outcome, "denied-unconfigured");
  });

  it("unresolvable server → deny without prompting", async () => {
    const { requestPermission, approvals } = setup();
    const d = await requestPermission("bare_tool_name", {});
    assert.equal(d.allow, false);
    assert.equal(approvals.length, 0);
  });

  it("tool in allowedTools → auto-allow, no gate, no prompt", async () => {
    let gateCalled = false;
    const { requestPermission, approvals, audit } = setup({
      allowedTools: ["mcp__github__list_prs"],
      gate: () => {
        gateCalled = true;
        return { allow: false };
      },
    });
    const d = await requestPermission("mcp__github__list_prs", {});
    assert.equal(d.allow, true);
    assert.equal(gateCalled, false);
    assert.equal(approvals.length, 0);
    assert.equal(audit[0].outcome, "auto-allowed");
  });

  it("internal server (e.g. bot-memory) → auto-allow, no gate, no prompt", async () => {
    let gateCalled = false;
    const { requestPermission, approvals, audit } = setup({
      mcpServers: [], // NOT a configured server — must still be allowed
      internalServers: ["bot-memory"],
      resolveServer: (t) => (t.startsWith("memory_") ? "bot-memory" : null),
      gate: () => {
        gateCalled = true;
        return { allow: false };
      },
    });
    const d = await requestPermission("memory_get", { key: "x" });
    assert.equal(d.allow, true);
    assert.equal(gateCalled, false);
    assert.equal(approvals.length, 0);
    assert.equal(audit[0].outcome, "internal");
  });

  it("grant covers the tool → allow without prompting", async () => {
    const { requestPermission, approvals, audit } = setup({
      gate: () => ({ allow: true }),
    });
    const d = await requestPermission("mcp__github__list_prs", {});
    assert.equal(d.allow, true);
    assert.equal(approvals.length, 0);
    assert.equal(audit[0].outcome, "granted");
  });

  it("grant gap → creates a pending approval; approve resolves to allow", async () => {
    const { requestPermission, approvals, audit, resolveApproval } = setup();
    const pending = requestPermission("mcp__github__list_prs", { a: 1 });
    // Approval was created with the call context.
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].toolName, "mcp__github__list_prs");
    assert.equal(approvals[0].serverName, "github");
    assert.deepEqual(approvals[0].input, { a: 1 });
    // A "pending" audit entry is recorded before the await settles.
    assert.ok(audit.some((e) => e.outcome === "pending"));

    resolveApproval({ allow: true });
    const d = await pending;
    assert.equal(d.allow, true);
    assert.ok(audit.some((e) => e.outcome === "approved"));
  });

  it("grant gap → deny decision resolves to deny with reason", async () => {
    const { requestPermission, resolveApproval, audit } = setup();
    const pending = requestPermission("mcp__github__list_prs", {});
    resolveApproval({ allow: false, reason: "user declined" });
    const d = await pending;
    assert.equal(d.allow, false);
    assert.equal(d.reason, "user declined");
    assert.ok(audit.some((e) => e.outcome === "denied"));
  });

  it("audits every decision with botId + workspaceId", async () => {
    const { requestPermission, audit } = setup({
      gate: () => ({ allow: true }),
    });
    await requestPermission("mcp__github__list_prs", {});
    assert.equal(audit[0].botId, "bot_1");
    assert.equal(audit[0].workspaceId, "ws_1");
    assert.equal(audit[0].toolName, "mcp__github__list_prs");
  });
});
