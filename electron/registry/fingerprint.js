/**
 * fingerprint.js
 *
 * What a dashboard, theme, bot or team is, as published — a fingerprint
 * that stays the same unless something that would be published changes
 * (dash-profiles v2: a profile save publishes only what changed since it
 * was last published or installed; user, 2026-10-27).
 *
 * Left out: where it is on this computer (id, folder, theme choice, name —
 * the profile carries those), the user's own widget settings and provider
 * choices (the profile's settings overlay), what it came from, and fields
 * that change by themselves.
 */
const crypto = require("crypto");

const DASHBOARD_LOCAL = new Set([
  "id",
  "name",
  "label",
  "menuId",
  "themeKey",
  "registryRef",
  "_dashboardConfig",
  "remixedFrom",
  "updatedAt",
  "dateEdited",
  "date_edited",
  "dateUpdated",
  "lastOpened",
  "lastOpenedAt",
  "activePageId",
  "version",
]);

const THEME_LOCAL = new Set([
  "id",
  "_registryMeta",
  "registryRef",
  "remixedFrom",
  "version",
  "author",
  "updatedAt",
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 32);
}

function without(record, local) {
  const out = {};
  for (const key of Object.keys(record || {})) {
    if (!local.has(key)) out[key] = record[key];
  }
  return out;
}

/** A bot as published: what it does, not how it runs on this computer. */
function publishedBot(bot) {
  const b = bot || {};
  return {
    name: b.name || "",
    instructions: b.instructions || "",
    model: b.model || null,
    engine: b.engine || null,
    schedules: (b.schedules || []).map((s) => ({
      cron: s && s.cron,
      prompt: s && s.prompt,
    })),
    publishes: b.publishes || [],
    // How it's wired and when it asks — part of what a package carries.
    approvalPolicy: b.approvalPolicy || null,
    subscriptions: b.subscriptions || [],
  };
}

/**
 * @param {"dashboard"|"theme"|"bot"|"bot-team"} kind
 * @param {object|object[]} record  a dashboard, a theme, a bot — or, for a
 *   team, its bots
 * @returns {string|null}
 */
function publishFingerprint(kind, record) {
  if (!record) return null;
  if (kind === "dashboard") {
    const {
      stripPersonalizationFromWorkspace,
    } = require("../schema/dashboardConfigUtils");
    return hash(
      without(stripPersonalizationFromWorkspace(record), DASHBOARD_LOCAL),
    );
  }
  if (kind === "theme") return hash(without(record, THEME_LOCAL));
  if (kind === "bot") return hash(publishedBot(record));
  if (kind === "bot-team") {
    const bots = Array.isArray(record) ? record : [];
    return hash(
      bots
        .map((b) => ({ role: (b && b.role) || null, ...publishedBot(b) }))
        .sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1)),
    );
  }
  return null;
}

/**
 * Whether a record changed since it was published or installed, by the
 * fingerprint stored then. Null when there's none to compare (published or
 * installed before fingerprints) — the caller decides.
 */
function changedSince(kind, record, ref) {
  if (!ref || !ref.contentHash) return null;
  return publishFingerprint(kind, record) !== ref.contentHash;
}

module.exports = { publishFingerprint, changedSince, stableStringify };
