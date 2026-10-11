/**
 * configDiff.js — what an update to a widget's .dash.js config would break
 * (create-entry PRD CRE-011, scenarios G6): settings users already filled in
 * that disappear or change type, changed defaults, and events other widgets
 * or bots may listen to that are no longer published.
 *
 * Configs are read with the AST-allowlist parser — never executed.
 * Portable (NFR-006).
 */
"use strict";

const { parseDashConfig } = require("../utils/dashConfigParser");

const keysOf = (o) => (o && typeof o === "object" ? Object.keys(o) : []);

/**
 * Settings by key: userConfig as an object ({ title: {…} }, the documented
 * shape) or a list ([{ key | name | id, … }]).
 */
function settingsOf(config) {
  const uc = config && config.userConfig;
  if (Array.isArray(uc)) {
    const out = {};
    uc.forEach((item, i) => {
      const k = item && (item.key || item.name || item.id);
      out[k || `#${i + 1}`] = item || {};
    });
    return out;
  }
  return uc && typeof uc === "object" ? uc : {};
}

/**
 * Event names a config publishes: events: ["a", …] / [{ name }, …] (the
 * documented shape) or events: { publishes: [...] }.
 */
function eventNames(config) {
  const ev = config && config.events;
  const list = Array.isArray(ev) ? ev : (ev && ev.publishes) || [];
  return (Array.isArray(list) ? list : [])
    .map((e) => (typeof e === "string" ? e : e && (e.name || e.event)))
    .filter(Boolean);
}

/**
 * @returns {{ ok: boolean, breaking: string[], notes: string[], error?: string }}
 *   breaking — would lose users' settings or silence listeners
 *   notes    — worth knowing (new settings, changed defaults)
 */
function compareConfigs(oldSource, newSource) {
  const before = parseDashConfig(oldSource);
  const after = parseDashConfig(newSource);
  if (!before.ok || !after.ok) {
    return {
      ok: false,
      breaking: [],
      notes: [],
      error: `Couldn't read the ${!before.ok ? "old" : "new"} config: ${
        (!before.ok ? before : after).error
      }`,
    };
  }
  const a = before.config || {};
  const b = after.config || {};
  const breaking = [];
  const notes = [];

  const oldSettings = settingsOf(a);
  const newSettings = settingsOf(b);
  for (const key of keysOf(oldSettings)) {
    if (!(key in newSettings)) {
      breaking.push(`setting "${key}" was removed — users lose what they set`);
      continue;
    }
    const o = oldSettings[key] || {};
    const n = newSettings[key] || {};
    if (o.type && n.type && o.type !== n.type) {
      breaking.push(`setting "${key}" changed type (${o.type} → ${n.type})`);
    }
    if (
      "defaultValue" in o &&
      JSON.stringify(o.defaultValue) !== JSON.stringify(n.defaultValue)
    ) {
      notes.push(
        `setting "${key}" default changed (${JSON.stringify(
          o.defaultValue,
        )} → ${JSON.stringify(n.defaultValue)})`,
      );
    }
  }
  for (const key of keysOf(newSettings)) {
    if (!(key in oldSettings)) notes.push(`new setting "${key}"`);
  }

  const newEvents = new Set(eventNames(b));
  for (const e of eventNames(a)) {
    if (!newEvents.has(e)) {
      breaking.push(
        `event "${e}" is no longer published — widgets or bots listening to it stop hearing it`,
      );
    }
  }
  const oldEvents = new Set(eventNames(a));
  for (const e of newEvents) {
    if (!oldEvents.has(e)) notes.push(`new event "${e}"`);
  }

  if (a.type && b.type && a.type !== b.type) {
    breaking.push(`config type changed (${a.type} → ${b.type})`);
  }

  return { ok: breaking.length === 0, breaking, notes };
}

module.exports = { compareConfigs, eventNames };
