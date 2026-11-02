/**
 * profileProviders.js — the providers a loaded profile brings (dash-profiles
 * "Profiles bring their providers", 2026-11-02).
 *
 * A profile carries each provider's name, type and connection settings —
 * never its keys. Loading adds every provider this Mac doesn't have, with no
 * key, marked as needing setup, so the profile's dashboards and bots point at
 * the right provider from the start. What's left for the user:
 *
 *   key     paste its key (the usual case)
 *   signIn  sign in on this Mac (a catalog server with a sign-in command)
 *   run     OK it before it first runs or connects
 *
 * A profile can come from someone else's file, so nothing it says about
 * where a provider connects is trusted:
 *   - a provider of a type the MCP catalog knows takes the catalog's own
 *     connection settings on this Mac (its program, address, headers,
 *     sign-in) — the profile's are dropped;
 *   - any other MCP server that runs a program or connects to an address
 *     waits for the user's OK, which shows exactly what it runs or where it
 *     connects — a key typed in later goes there;
 *   - a WebSocket comes without its address: the user types it, with its
 *     key.
 *
 * Pure: the catalog and the provider records are passed in.
 */
"use strict";

const { stripProviderCredentials } = require("../controller/exportController");

// Provider names the app keeps for itself (a "Fetch Tools" test's entry).
const RESERVED_PREFIX = "__test__";
// A key's field names are names, not text: a profile's can't carry a value
// or a sentence.
const FIELD_NAME = /^[A-Za-z_][\w.-]{0,63}$/;

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** The catalog's entry for a provider's type, or null. */
function catalogEntryFor(type, catalog) {
  return (catalog || []).find((e) => e && e.id === type) || null;
}

/**
 * A profile's provider as it may be saved here: its safe fields only,
 * stripped again (a crafted profile can't plant keys or headers).
 */
function safeProfileProvider(p) {
  const [safe] = stripProviderCredentials([p || {}]);
  return {
    name: String(safe.name || ""),
    type: String(safe.type || ""),
    providerClass: safe.providerClass || "credential",
    ...(safe.mcpConfig ? { mcpConfig: safe.mcpConfig } : {}),
    ...(Array.isArray(safe.allowedTools)
      ? { allowedTools: safe.allowedTools.filter((t) => typeof t === "string") }
      : {}),
    ...(safe.wsConfig ? { wsConfig: safe.wsConfig } : {}),
    ...(safe.isDefaultForType === true ? { isDefaultForType: true } : {}),
    ...(Array.isArray(safe.credentialKeys) && safe.credentialKeys.length
      ? {
          credentialKeys: safe.credentialKeys.filter((k) => FIELD_NAME.test(k)),
        }
      : {}),
  };
}

/** Does this config start something here or reach somewhere? */
function reachOf(p) {
  const m = p && p.mcpConfig;
  if (p && p.providerClass === "mcp" && m) {
    // Built into Dash: runs nothing of the profile's (and carries nothing
    // to run — prepareProfileProvider strips it). A 'builtin' label alone
    // proves nothing.
    if (m.transport === "in_process") return null;
    if (typeof m.command === "string" && m.command) {
      return {
        kind: "program",
        text: [m.command, ...(Array.isArray(m.args) ? m.args : [])]
          .map(String)
          .join(" "),
      };
    }
    if (typeof m.url === "string" && m.url) {
      return { kind: "address", text: m.url };
    }
  }
  if (p && p.providerClass === "websocket" && p.wsConfig && p.wsConfig.url) {
    return { kind: "address", text: String(p.wsConfig.url) };
  }
  return null;
}

/**
 * A profile's provider made ready to add here, and what it still needs.
 * @param {object} p  safeProfileProvider(...)
 * @param {object[]} catalog  the MCP server catalog's servers
 * @returns {{ provider: object|null, signIn: boolean, needsRun: boolean,
 *   reach: { kind: "program"|"address", text }|null }}  provider null: not
 *   added (a name the app keeps for itself)
 */
function prepareProfileProvider(p, catalog = []) {
  if (!p || !p.name || String(p.name).startsWith(RESERVED_PREFIX)) {
    return { provider: null, signIn: false, needsRun: false, reach: null };
  }
  const entry = catalogEntryFor(p.type, catalog);
  const provider = { ...p };
  if (entry && p.providerClass === "mcp" && entry.mcpConfig) {
    // A type the catalog knows: this Mac's catalog says how it connects.
    provider.mcpConfig = clone(entry.mcpConfig);
    const schema = entry.credentialSchema;
    if (schema && typeof schema === "object" && Object.keys(schema).length) {
      provider.credentialKeys = Object.keys(schema).filter((k) =>
        FIELD_NAME.test(k),
      );
    }
    return {
      provider,
      signIn: !!entry.authCommand,
      needsRun: false,
      reach: null,
    };
  }
  if (
    provider.providerClass === "mcp" &&
    provider.mcpConfig &&
    provider.mcpConfig.transport === "in_process"
  ) {
    // Built into Dash: nothing to run or reach comes from the profile.
    const { command: _c, args: _a, url: _u, ...rest } = provider.mcpConfig;
    provider.mcpConfig = rest;
  }
  if (provider.providerClass === "websocket" && provider.wsConfig) {
    // No address from a profile: the user types where it connects, with
    // its key — a profile never chooses where a key is sent.
    const { url: _dropped, ...rest } = provider.wsConfig;
    provider.wsConfig = rest;
    return { provider, signIn: false, needsRun: false, reach: null };
  }
  const reach = reachOf(provider);
  return {
    provider,
    signIn: !!(entry && entry.authCommand),
    needsRun: !!reach,
    reach,
  };
}

/** Kept for callers that only need what it'll need. */
function providerNeeds(p, catalog = []) {
  const r = prepareProfileProvider(p, catalog);
  return { signIn: r.signIn, needsRun: r.needsRun };
}

/** What a provider runs or reaches, as one line for the user to read. */
function commandLine(mcpConfig) {
  const r = reachOf({ providerClass: "mcp", mcpConfig });
  return r && r.kind === "program" ? r.text : null;
}

module.exports = {
  safeProfileProvider,
  prepareProfileProvider,
  providerNeeds,
  reachOf,
  commandLine,
  RESERVED_PREFIX,
};
