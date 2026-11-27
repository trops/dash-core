/**
 * botSettings.js — settings a bot owns (DASH-136).
 *
 * Each bot has one job, and the settings for that job belong to it: the
 * Ticket Bot's ticket source, Triage's repos, the Workspace Bot's work
 * folder. A bot declares them the same way a team does (teamValues.js:
 * name, label, type, default, description, plus `required`) and keeps
 * their values itself:
 *
 *   bot.settings       [{ name, label, type, required?, default?, … }]
 *   bot.settingValues  { [name]: value }
 *
 * They reach the bot's run like a team's settings ({name} in its
 * instructions, folders, checks, schedules' prompts and triggers' notes).
 * A bot's own setting wins over a team setting of the same name. Nothing
 * here lets a bot read another bot's settings: what one bot decided goes to
 * the next through the handoff.
 *
 * Team-level settings (DASH-57) still work as before: a team setting a bot
 * uses is reported against that bot here, so setup can say "Workspace Bot:
 * Work folder has no value" whichever kind it is.
 *
 * Pure, no imports: the renderer and the main process both use it.
 */

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// {name} or {table.field}.
const USE_RE =
  /\{([A-Za-z][A-Za-z0-9_]{0,39})(?:\.([A-Za-z][A-Za-z0-9_]{0,39}))?\}/g;

/**
 * Bot values on an install form travel inside the team values under this
 * key ({ "@bots": { [role]: { [name]: value } } }). No setting can be named
 * this (names start with a letter), so it never clashes.
 */
export const BOT_VALUES_KEY = "@bots";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** A bot's own settings: { declared, values }. */
export function settingsOfBot(bot) {
  const declared = (
    bot && Array.isArray(bot.settings) ? bot.settings : []
  ).filter((s) => s && NAME_RE.test(String(s.name || "")));
  const values = (bot && isObj(bot.settingValues) && bot.settingValues) || {};
  return { declared, values };
}

/** Has this setting no value (and no default)? A boolean never is empty. */
export function settingEmpty(setting, values) {
  if (!setting) return false;
  if (setting.type === "boolean") return false;
  const v = has(values, setting.name) ? values[setting.name] : setting.default;
  if (setting.type === "table") return !Array.isArray(v) || v.length === 0;
  return v === undefined || v === null || v === "";
}

function collect(v, used) {
  if (typeof v === "string") {
    if (v.indexOf("{") === -1) return;
    for (const m of v.matchAll(USE_RE)) used.add(m[1]);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collect(x, used);
    return;
  }
  if (isObj(v)) for (const x of Object.values(v)) collect(x, used);
}

/**
 * The setting names a bot's text uses ({workFolder}, and "repo" for
 * {repo.url}): its instructions, folders, checks, schedules' prompts and
 * triggers' notes.
 */
export function settingNamesUsed(bot) {
  const used = new Set();
  if (!bot) return used;
  collect(bot.instructions, used);
  collect(bot.projects, used);
  collect(bot.checks, used);
  collect(
    (Array.isArray(bot.schedules) ? bot.schedules : []).map(
      (s) => s && s.prompt,
    ),
    used,
  );
  collect(
    (Array.isArray(bot.subscriptions) ? bot.subscriptions : []).map(
      (s) => s && s.note,
    ),
    used,
  );
  return used;
}

/**
 * The settings a bot runs with: its team's, then its own on top (same name:
 * the bot's wins). The result looks like a team's settings, so
 * teamValues.withTeamValues / pickFrom take it as they are; each of the
 * bot's own is marked `owner: "bot"` (not saved anywhere) so a run's error
 * can say where to fill it in.
 * @param {object|null} team  BotStore team settings ({ declared, values, … })
 * @param {object|null} bot
 */
export function withBotSettings(team, bot) {
  const own = settingsOfBot(bot);
  if (!own.declared.length) return team;
  const base = isObj(team) ? team : {};
  const ownNames = new Set(own.declared.map((s) => s.name));
  const teamDeclared = (
    Array.isArray(base.declared) ? base.declared : []
  ).filter((s) => s && !ownNames.has(s.name));
  const values = {};
  const teamValues = isObj(base.values) ? base.values : {};
  for (const s of teamDeclared) {
    if (has(teamValues, s.name)) values[s.name] = teamValues[s.name];
  }
  for (const s of own.declared) {
    if (has(own.values, s.name)) values[s.name] = own.values[s.name];
  }
  return {
    ...base,
    declared: [
      ...teamDeclared,
      ...own.declared.map((s) => ({ ...s, owner: "bot" })),
    ],
    values,
  };
}

/**
 * What a bot still needs before it can do its job: each entry
 * { name, label, owner: "bot" | "team", type }.
 *   - its own settings that are required, or that its text uses, with no
 *     value (a table with no rows);
 *   - its team's settings that its text uses, with no value.
 */
export function botMissingSettings(bot, team = null) {
  if (!bot) return [];
  const used = settingNamesUsed(bot);
  const own = settingsOfBot(bot);
  const ownNames = new Set(own.declared.map((s) => s.name));
  const out = [];
  for (const s of own.declared) {
    if (!(s.required === true || used.has(s.name))) continue;
    if (!settingEmpty(s, own.values)) continue;
    out.push({
      name: s.name,
      label: s.label || s.name,
      owner: "bot",
      type: s.type || "text",
    });
  }
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  const values = (team && isObj(team.values) && team.values) || {};
  for (const s of declared) {
    if (!s || ownNames.has(s.name) || !used.has(s.name)) continue;
    if (!settingEmpty(s, values)) continue;
    out.push({
      name: s.name,
      label: s.label || s.name,
      owner: "team",
      type: s.type || "text",
    });
  }
  return out;
}

const skipped = (b) => !b || b.role === "lead" || b.system === "dash-team";

/**
 * Which bots on a team still need something from the user (DASH-136; the
 * team's Set up, its "Needs setup" tags, a failed job's "Open <bot>'s
 * settings"): one entry per bot with something missing, in the order given,
 *   { botId, name, missing: [{ name, label, owner, type }] }
 * Leads and Dash team bots are left out. An empty list: nothing to fill in.
 * @param {object[]} bots  the team's bots, as saved
 * @param {object|null} team  its team settings (BotStore teams[id])
 */
export function botSetupStatus(bots, team = null) {
  const out = [];
  for (const bot of Array.isArray(bots) ? bots : []) {
    if (skipped(bot)) continue;
    const missing = botMissingSettings(bot, team);
    if (!missing.length) continue;
    out.push({ botId: bot.id, name: bot.name || bot.id, missing });
  }
  return out;
}

/** Setup status as lines: "Workspace Bot: Work folder has no value." */
export function botSetupLines(status) {
  const lines = [];
  for (const b of Array.isArray(status) ? status : []) {
    for (const m of b.missing || []) {
      lines.push(
        `${b.name}: ${m.label} ${m.type === "table" ? "has no rows" : "has no value"}.`,
      );
    }
  }
  return lines;
}

/**
 * Install values split: { team: {…team values}, bots: { [role]: {…} } }
 * (see BOT_VALUES_KEY).
 */
export function splitInstallValues(values) {
  if (!isObj(values)) return { team: values || null, bots: {} };
  const { [BOT_VALUES_KEY]: bots, ...team } = values;
  return { team, bots: isObj(bots) ? bots : {} };
}
