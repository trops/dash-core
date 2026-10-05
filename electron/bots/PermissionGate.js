/**
 * PermissionGate.js
 *
 * Produces the `requestPermission(toolName, input)` function the tool-loop
 * engine (Slice 1) calls before executing every tool. It layers Bot Factory's
 * approval semantics (PRD US-003 / FR-003) on top of the shared, principal-
 * agnostic grant gate (electron/mcp/permissionGate.gateBotToolCall):
 *
 *   1. paused        → deny (pause enforced at the gate; US-014)
 *   2. server not in the bot's configured mcpServers → deny WITHOUT prompting
 *   2b. "allow" policy → allow (Allow without prompting)
 *   3. tool in allowedTools → allow (auto)
 *   4. base grant covers it  → allow
 *   5. read-only tool (MCP readOnlyHint) under "ask" → allow; "ask-every"
 *      asks before these too
 *   6. otherwise             → create a pending approval and await the decision
 *
 * Every decision is reported to an injected `audit` hook (US-003 AC5).
 *
 * Portable (NFR-006): all Electron-coupled collaborators — the grant gate, the
 * approval registry, the audit sink, the pause predicate, and the tool→server
 * resolver — are injected. Nothing here imports Electron.
 */
"use strict";

/**
 * @param {{
 *   botId: string,
 *   allowedTools?: string[],
 *   mcpServers?: string[],
 *   internalServers?: string[],
 *   approvalPolicy?: "ask" | "ask-every" | "allow",
 *   isReadOnly?: (toolName: string) => boolean,
 *   resolveServer: (toolName: string) => (string | null),
 *   createApproval: (request: object) => { id: string, promise: Promise<any> },
 *   gate?: (req: object) => { allow: boolean, reason?: string },
 *   audit?: (entry: object) => void,
 *   isPaused?: () => boolean,
 *   workspaceId?: string
 * }} ctx
 * @returns {(toolName: string, input: any) => Promise<{allow: boolean, reason?: string}>}
 */
function createRequestPermission(ctx) {
  const {
    botId,
    allowedTools = [],
    mcpServers = [],
    internalServers = [],
    resolveServer,
    createApproval,
    audit = () => {},
    isPaused = () => false,
    workspaceId,
    approvalPolicy = "ask",
    isReadOnly = () => false,
  } = ctx || {};

  if (!botId) throw new Error("PermissionGate: ctx.botId is required");
  if (typeof resolveServer !== "function") {
    throw new Error("PermissionGate: ctx.resolveServer is required");
  }
  if (typeof createApproval !== "function") {
    throw new Error("PermissionGate: ctx.createApproval is required");
  }

  // Resolve the grant gate lazily and only if not injected. The default pulls
  // the Electron-wired permissionGate, so we defer the require to the first
  // grant check — keeping construction (and plain-Node loading) Electron-free.
  const gate =
    (ctx && ctx.gate) ||
    ((req) => require("../mcp/permissionGate").gateBotToolCall(req));

  const record = (toolName, decision, extra) => {
    audit({
      botId,
      workspaceId,
      toolName,
      allow: decision.allow,
      reason: decision.reason,
      ...extra,
    });
    return decision;
  };

  return async function requestPermission(toolName, input) {
    // 1. Pause is enforced here so any engine halts at its next tool call.
    if (isPaused()) {
      return record(
        toolName,
        { allow: false, reason: "bot is paused" },
        {
          outcome: "paused",
        },
      );
    }

    const serverName = resolveServer(toolName);

    // 1b. Internal Bot Factory tools (e.g. bot-memory) are the bot's own
    //     sandbox — auto-allowed, never a consent prompt or external action.
    if (serverName && internalServers.includes(serverName)) {
      return record(
        toolName,
        { allow: true },
        { outcome: "internal", serverName },
      );
    }

    // 2. A tool whose server the bot was never configured with is denied
    //    without prompting — it's not a consent gap, it's out of scope.
    if (!serverName || !mcpServers.includes(serverName)) {
      return record(
        toolName,
        {
          allow: false,
          reason: `tool '${toolName}' is not on a server this bot is configured to use`,
        },
        { outcome: "denied-unconfigured", serverName: serverName || null },
      );
    }

    // 2b. "Allow without prompting": every tool on the bot's own providers
    //     runs without a prompt (pause and unconfigured servers still apply).
    if (approvalPolicy === "allow") {
      return record(
        toolName,
        { allow: true },
        { outcome: "policy-allow", serverName },
      );
    }

    // 3. Pre-approved tools run without a prompt.
    if (allowedTools.includes(toolName)) {
      return record(
        toolName,
        { allow: true },
        { outcome: "auto-allowed", serverName },
      );
    }

    // 4. Already covered by a persisted grant.
    const gated = gate({ botId, serverName, toolName, args: input });
    if (gated.allow) {
      return record(
        toolName,
        { allow: true },
        { outcome: "granted", serverName },
      );
    }

    // 5. Read-only tools aren't external actions — they run without a
    //    prompt unless the bot asks before every tool.
    if (approvalPolicy !== "ask-every" && isReadOnly(toolName)) {
      return record(
        toolName,
        { allow: true },
        { outcome: "read-only", serverName },
      );
    }

    // 6. Grant gap → ask. Create a pending approval and await the decision.
    const { id, promise } = createApproval({
      botId,
      workspaceId,
      serverName,
      toolName,
      input,
      reason: gated.reason,
    });
    record(
      toolName,
      { allow: false, reason: "awaiting approval" },
      {
        outcome: "pending",
        approvalId: id,
        serverName,
      },
    );

    const decision = await promise;
    return record(
      toolName,
      decision.allow
        ? { allow: true }
        : { allow: false, reason: decision.reason || "approval denied" },
      {
        outcome: decision.allow ? "approved" : "denied",
        approvalId: id,
        serverName,
      },
    );
  };
}

module.exports = { createRequestPermission };
