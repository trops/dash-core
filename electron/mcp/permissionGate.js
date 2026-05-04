/**
 * permissionGate.js
 *
 * Per-widget gating for MCP tool calls.
 *
 * When `gateToolCall` is invoked with a widget identity, server name,
 * tool name, and tool arguments, it consults the widget's GRANTED
 * permissions (electron/mcp/grantedPermissions.js) and either permits
 * the call or returns a clear denial reason.
 *
 * **Granted vs declared (Slice 2):** the widget's package.json
 * `dash.permissions.mcp` block is the *request* — read by
 * widgetPermissions.js and shown to the user at install time. The
 * *grant* is what the user actually approved. The runtime gate reads
 * grants only. A widget with a declared manifest but no grant entry
 * has no MCP access — fail-closed. The user grants permissions via
 * the install consent modal or Settings → Privacy & Security.
 *
 * Two layers:
 *
 *   1. **Tool-name allowlist** — the granted `tools[]` array for the
 *      target server determines which tool names this widget may
 *      invoke. Anything outside the list is rejected.
 *
 *   2. **Path-argument containment** — for tools whose arguments
 *      include a path-shaped key (`path`, `uri`, `filepath`, `file`,
 *      `directory`), the supplied path is validated with safePath()
 *      against the widget's granted `readPaths` or `writePaths` for
 *      the target server. The read/write distinction is heuristic
 *      based on the tool name (e.g. `write_file` is treated as a
 *      write).
 *
 * This is the runtime enforcement layer. Install-time consent UI is
 * Slice 2. Per-dashboard MCP-server scope reconfiguration is Slice 3.
 * When the feature flag is OFF (default), this gate is bypassed
 * entirely; mcpController behaves as before. When ON, every callTool
 * dispatch goes through this gate.
 */
"use strict";

const { getGrant } = require("./grantedPermissions");
const { safePath } = require("../utils/safePath");

// Argument keys that look like paths. Different MCP servers use
// different conventions; this list covers the common filesystem-style
// servers. Extensible — add as new patterns surface.
const PATH_ARG_KEYS = ["path", "uri", "filepath", "file", "directory"];

// Heuristic: tool names matching this regex are treated as writes for
// purposes of choosing readPaths vs writePaths. The match is intentionally
// broad — we'd rather treat an ambiguous tool as a write (stricter) than
// as a read.
const WRITE_TOOL_PATTERN =
  /(^|_)(write|create|edit|delete|remove|append|move|rename|chmod|chown|mkdir)/i;

function isWriteTool(toolName) {
  if (typeof toolName !== "string") return false;
  return WRITE_TOOL_PATTERN.test(toolName);
}

/**
 * @returns {{ allow: true } | { allow: false, reason: string }}
 */
function gateToolCall({ widgetId, serverName, toolName, args }) {
  if (!widgetId) {
    return {
      allow: false,
      reason: "no widgetId supplied; cannot determine permissions",
    };
  }

  const perms = getGrant(widgetId);
  if (!perms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' has no MCP permissions granted; user must approve at install time or in Settings → Privacy & Security",
    };
  }

  const serverPerms = perms.servers && perms.servers[serverName];
  if (!serverPerms) {
    return {
      allow: false,
      reason:
        "widget '" +
        widgetId +
        "' is not authorized to call '" +
        serverName +
        "'",
    };
  }

  if (!serverPerms.tools.includes(toolName)) {
    return {
      allow: false,
      reason:
        "tool '" +
        toolName +
        "' is not in the allowlist for widget '" +
        widgetId +
        "' on server '" +
        serverName +
        "'",
    };
  }

  // Path-argument containment. Only checked when the tool's args
  // include a path-shaped key.
  const isWrite = isWriteTool(toolName);
  // Write tools must use writePaths; read tools may use either
  // readPaths or writePaths (write access implies read access).
  const allowedPaths = isWrite
    ? serverPerms.writePaths
    : [...serverPerms.readPaths, ...serverPerms.writePaths];

  if (args && typeof args === "object") {
    for (const key of PATH_ARG_KEYS) {
      const v = args[key];
      if (typeof v !== "string" || !v) continue;
      if (allowedPaths.length === 0) {
        return {
          allow: false,
          reason:
            "tool '" +
            toolName +
            "' uses path argument '" +
            key +
            "' but widget '" +
            widgetId +
            "' has no " +
            (isWrite ? "writePaths" : "readPaths or writePaths") +
            " declared for server '" +
            serverName +
            "'",
        };
      }
      try {
        safePath(v, allowedPaths);
      } catch (e) {
        return {
          allow: false,
          reason:
            "path argument '" +
            key +
            "' rejected: " +
            (e && e.message ? e.message : String(e)),
        };
      }
    }
  }

  return { allow: true };
}

module.exports = {
  gateToolCall,
  isWriteTool,
  PATH_ARG_KEYS,
};
