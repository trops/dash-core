/**
 * grantedPermissions.js
 *
 * Stores the user's actual MCP permission grants per widget. This is the
 * Slice-2 enforcement source of truth — separate from the widget's declared
 * `dash.permissions.mcp` block (which is just a request).
 *
 * The runtime gate (permissionGate.gateToolCall) reads from here only.
 * A widget with a declared manifest but no grant entry has no access:
 * fail-closed. The user grants permissions at install time (consent modal)
 * or later in Settings → Privacy & Security.
 *
 * Storage: userData/widgetMcpGrants.json. Atomic writes via tmp + rename.
 *
 * Shape on disk:
 *   {
 *     "@trops/notes-summarizer": {
 *       "servers": {
 *         "filesystem": {
 *           "tools": ["read_file"],
 *           "readPaths": ["/Users/jane/Documents/notes"],
 *           "writePaths": []
 *         }
 *       }
 *     }
 *   }
 *
 * Note: paths are stored as-is (already tilde-expanded by the manifest
 * parser before grants are written). Tests can re-expand via
 * widgetPermissions.expandHome if they store ~ literals.
 *
 * Public API:
 *   getGrant(widgetId) → grant | null
 *   setGrant(widgetId, perms) → boolean
 *   revokeGrant(widgetId) → boolean
 *   revokeServer(widgetId, serverName) → boolean
 *   listAllGrants() → [{ widgetId, granted }]
 *   clearCache() → void   // test-only
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE_NAME = "widgetMcpGrants.json";

// In-process cache of the entire grants file. Lazily loaded; invalidated
// on every write.
let _cache = null;

function grantsFilePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function loadFromDisk() {
  const p = grantsFilePath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (e) {
    console.warn("[grantedPermissions] failed to read " + p + ": " + e.message);
    return {};
  }
}

function ensureCache() {
  if (_cache === null) _cache = loadFromDisk();
  return _cache;
}

function writeToDisk(data) {
  const p = grantsFilePath();
  const tmp = p + ".tmp";
  // Ensure parent dir exists (userData should already, but be defensive
  // for first-launch / freshly-cleared profile cases).
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

/**
 * Sanitize a perms object before persisting. Drops unknown keys, coerces
 * arrays of strings, and silently ignores malformed servers. Mirrors the
 * shape produced by parseManifestPermissions so the gate reads either
 * declared or granted with the same code path.
 */
function sanitizePerms(perms) {
  if (!perms || typeof perms !== "object") return null;
  const rawServers =
    perms.servers && typeof perms.servers === "object" ? perms.servers : null;
  if (!rawServers) return null;

  const servers = {};
  for (const [name, raw] of Object.entries(rawServers)) {
    if (!raw || typeof raw !== "object") continue;
    servers[name] = {
      tools: Array.isArray(raw.tools)
        ? raw.tools.filter((t) => typeof t === "string")
        : [],
      readPaths: Array.isArray(raw.readPaths)
        ? raw.readPaths.filter((p) => typeof p === "string")
        : [],
      writePaths: Array.isArray(raw.writePaths)
        ? raw.writePaths.filter((p) => typeof p === "string")
        : [],
    };
  }
  return { servers };
}

function getGrant(widgetId) {
  if (typeof widgetId !== "string" || !widgetId) return null;
  const all = ensureCache();
  return all[widgetId] || null;
}

function setGrant(widgetId, perms) {
  if (typeof widgetId !== "string" || !widgetId) return false;
  const sanitized = sanitizePerms(perms);
  if (!sanitized) return false;
  const all = ensureCache();
  all[widgetId] = sanitized;
  try {
    writeToDisk(all);
    return true;
  } catch (e) {
    console.warn(
      "[grantedPermissions] failed to write grant for " +
        widgetId +
        ": " +
        e.message,
    );
    // Roll back the cache entry so memory matches disk.
    _cache = loadFromDisk();
    return false;
  }
}

function revokeGrant(widgetId) {
  if (typeof widgetId !== "string" || !widgetId) return false;
  const all = ensureCache();
  if (!Object.prototype.hasOwnProperty.call(all, widgetId)) return false;
  delete all[widgetId];
  try {
    writeToDisk(all);
    return true;
  } catch (e) {
    console.warn(
      "[grantedPermissions] failed to revoke grant for " +
        widgetId +
        ": " +
        e.message,
    );
    _cache = loadFromDisk();
    return false;
  }
}

function revokeServer(widgetId, serverName) {
  if (typeof widgetId !== "string" || !widgetId) return false;
  if (typeof serverName !== "string" || !serverName) return false;
  const all = ensureCache();
  const widgetEntry = all[widgetId];
  if (!widgetEntry || !widgetEntry.servers) return false;
  if (!Object.prototype.hasOwnProperty.call(widgetEntry.servers, serverName))
    return false;
  delete widgetEntry.servers[serverName];
  try {
    writeToDisk(all);
    return true;
  } catch (e) {
    console.warn(
      "[grantedPermissions] failed to revoke server " +
        serverName +
        " for " +
        widgetId +
        ": " +
        e.message,
    );
    _cache = loadFromDisk();
    return false;
  }
}

function listAllGrants() {
  const all = ensureCache();
  return Object.entries(all).map(([widgetId, granted]) => ({
    widgetId,
    granted,
  }));
}

function clearCache() {
  _cache = null;
}

module.exports = {
  getGrant,
  setGrant,
  revokeGrant,
  revokeServer,
  listAllGrants,
  clearCache,
};
