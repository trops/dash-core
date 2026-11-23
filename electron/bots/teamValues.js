/**
 * teamValues.js — a team's settings (DASH-57, Code Factory G6).
 *
 * A team (a dashboard's bots, or a team / dashboard package) declares its
 * settings once: the repo URL, base branch, work folder, setup command, …
 * Each has a name, a label, a type and a default:
 *
 *   { name: "repoUrl", label: "Repository URL", type: "url", default: "" }
 *
 * Its bots use them as {name} in their instructions, their check commands
 * and their folders. The values are filled in when the team is installed
 * and can be changed later on the dashboard (or over MCP), so the same
 * package installed twice with two repo URLs makes two working teams with
 * no bot edited.
 *
 * Values are filled in when a bot is used, never written into it: the bot
 * keeps {repoUrl}, its run gets the URL. A folder made from a setting is a
 * real folder for the fence (folderFence) once it's filled in.
 *
 * Settings aren't secret (they're kept as they are): tokens belong in a
 * provider.
 *
 * Kept on the dashboard's team settings (BotStore teams[workspaceId]):
 *   declared  the settings, as above
 *   values    { [name]: value } (a value left out uses the default)
 *
 * Pure: no Electron, no I/O (the home folder is passed in).
 */
"use strict";

const TYPES = ["text", "url", "folder", "command", "boolean", "number"];
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// {name} in a bot's text (other braces, like JSON, are left alone).
const USE_RE = /\{([A-Za-z][A-Za-z0-9_]{0,39})\}/g;
const MAX_SETTINGS = 30;
const MAX_LABEL = 120;
const MAX_DESCRIPTION = 500;
const MAX_VALUE = 2000;

const TYPE_WORDS = {
  text: "text",
  url: "a web or git address",
  folder: "a folder",
  command: "a command",
  boolean: "yes or no",
  number: "a number",
};

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A value as its type keeps it, or undefined when it can't be one. */
function coerce(type, v) {
  if (v === undefined || v === null) return undefined;
  if (type === "boolean") {
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["yes", "true", "1", "on"].includes(s)) return true;
    if (["no", "false", "0", "off", ""].includes(s)) return false;
    return undefined;
  }
  if (type === "number") {
    if (v === "") return "";
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s.length > MAX_VALUE ? undefined : s;
}

/** A folder value that's a whole path (absolute, or from the home folder). */
function isFolderPath(s) {
  return s === "~" || /^~[/\\]/.test(s) || /^([/\\]|[A-Za-z]:[/\\])/.test(s);
}

/**
 * The declared settings, checked: { settings, errors }. Unknown fields are
 * dropped; a bad one is reported and left out.
 */
function cleanSettings(input) {
  const errors = [];
  const settings = [];
  if (input === undefined || input === null) return { settings, errors };
  if (!Array.isArray(input)) {
    return { settings, errors: ["settings must be a list"] };
  }
  if (input.length > MAX_SETTINGS) {
    errors.push(`a team can have at most ${MAX_SETTINGS} settings`);
  }
  const seen = new Set();
  input.slice(0, MAX_SETTINGS).forEach((s, i) => {
    const where = `setting ${i + 1}`;
    if (!isObj(s) || typeof s.name !== "string" || !NAME_RE.test(s.name)) {
      errors.push(
        `${where}: its name must be letters, digits and underscores, starting with a letter (at most 40)`,
      );
      return;
    }
    if (seen.has(s.name)) {
      errors.push(`${where}: "${s.name}" is declared twice`);
      return;
    }
    const type = s.type === undefined || s.type === null ? "text" : s.type;
    if (!TYPES.includes(type)) {
      errors.push(
        `${where} (${s.name}): type must be one of ${TYPES.join(", ")}`,
      );
      return;
    }
    const label =
      typeof s.label === "string" && s.label.trim()
        ? s.label.trim().slice(0, MAX_LABEL)
        : s.name;
    const out = { name: s.name, label, type };
    if (typeof s.description === "string" && s.description.trim()) {
      out.description = s.description.trim().slice(0, MAX_DESCRIPTION);
    }
    if (s.default !== undefined && s.default !== null && s.default !== "") {
      const d = coerce(type, s.default);
      if (d === undefined) {
        errors.push(
          `${where} (${s.name}): its default isn't ${TYPE_WORDS[type]}`,
        );
        return;
      }
      if (type === "folder" && !isFolderPath(d)) {
        errors.push(
          `${where} (${s.name}): its default must be a whole path (/… or ~/…)`,
        );
        return;
      }
      out.default = d;
    }
    seen.add(s.name);
    settings.push(out);
  });
  return { settings, errors };
}

/**
 * Values for the declared settings, checked: { values, errors }. Only
 * declared names are kept; "" clears one (its default is used).
 * `current` are the values kept so far (a patch keeps the rest).
 */
function cleanValues(settings, input, current = {}) {
  const errors = [];
  const values = {};
  const list = Array.isArray(settings) ? settings : [];
  const byName = new Map(list.map((s) => [s.name, s]));
  for (const [k, v] of Object.entries(isObj(current) ? current : {})) {
    if (byName.has(k)) values[k] = v;
  }
  if (input === undefined || input === null) return { values, errors };
  if (!isObj(input)) return { values, errors: ["values must be an object"] };
  for (const [name, raw] of Object.entries(input)) {
    const s = byName.get(name);
    if (!s) {
      errors.push(`"${name}" isn't one of this team's settings`);
      continue;
    }
    if (raw === null || raw === "") {
      delete values[name];
      continue;
    }
    const v = coerce(s.type, raw);
    if (v === undefined || v === "") {
      errors.push(`${s.label}: must be ${TYPE_WORDS[s.type]}`);
      continue;
    }
    if (s.type === "folder" && !isFolderPath(v)) {
      errors.push(`${s.label}: must be a whole path (/… or ~/…)`);
      continue;
    }
    values[name] = v;
  }
  return { values, errors };
}

/** What a setting's value reads as in a bot's text. */
function asText(s, v, home) {
  if (s.type === "boolean") return v ? "yes" : "no";
  const t = String(v);
  if (s.type === "folder" && home && (t === "~" || /^~[/\\]/.test(t))) {
    return home.replace(/[/\\]+$/, "") + t.slice(1);
  }
  return t;
}

/**
 * A team's settings as text to fill in: { text: { [name]: string },
 * empty: Set<name> } — a setting with no value and no default is empty.
 * @param {{ declared?: object[], values?: object }} team  its team settings
 */
function settingTexts(team, { home = null } = {}) {
  const text = {};
  const empty = new Set();
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  const values = (team && isObj(team.values) && team.values) || {};
  for (const s of declared) {
    if (!s || !NAME_RE.test(String(s.name || ""))) continue;
    const v = has(values, s.name) ? values[s.name] : s.default;
    if (v === undefined || v === null || v === "") {
      if (s.type === "boolean") text[s.name] = "no";
      else empty.add(s.name);
      continue;
    }
    text[s.name] = asText(s, v, home);
  }
  return { text, empty };
}

/** `str` with each {name} of `text` filled in; `used` collects the names. */
function fill(str, text, used = null) {
  if (typeof str !== "string" || str.indexOf("{") === -1) return str;
  return str.replace(USE_RE, (whole, name) => {
    if (!has(text, name)) {
      if (used) used.add(name);
      return whole;
    }
    if (used) used.add(name);
    return text[name];
  });
}

/** Every string in `v` (deeply) filled in. */
function fillDeep(v, text, used) {
  if (typeof v === "string") return fill(v, text, used);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, text, used));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = fillDeep(x, text, used);
    return o;
  }
  return v;
}

/** The {names} a bot's text uses (instructions, folders, checks, prompts). */
function namesUsed(bot) {
  const used = new Set();
  if (bot) fillDeep(usedParts(bot), {}, used);
  return [...used];
}

function usedParts(bot) {
  return {
    instructions: bot.instructions,
    projects: bot.projects,
    checks: bot.checks,
    schedules: (bot.schedules || []).map((s) => s && s.prompt),
    notes: (bot.subscriptions || []).map((s) => s && s.note),
  };
}

/**
 * A bot as it runs, its team's settings filled in: its instructions, its
 * folders, its checks (commands and every other text in them), its
 * schedules' prompts and its triggers' notes. The bot itself is left
 * alone (it keeps {name}).
 *
 * @returns {{ bot: object, missing: Array<{name, label}> }} missing: the
 *   declared settings it uses that have no value (its run can't start).
 */
function withTeamValues(bot, team, { home = null } = {}) {
  if (!bot) return { bot, missing: [] };
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  if (!declared.length) return { bot, missing: [] };
  const { text, empty } = settingTexts(team, { home });
  const used = new Set();
  const out = { ...bot };
  if (typeof bot.instructions === "string") {
    out.instructions = fill(bot.instructions, text, used);
  }
  if (Array.isArray(bot.projects)) {
    out.projects = bot.projects.map((p) => fill(p, text, used));
  }
  if (bot.checks) out.checks = fillDeep(bot.checks, text, used);
  if (Array.isArray(bot.schedules)) {
    out.schedules = bot.schedules.map((s) =>
      s && typeof s.prompt === "string"
        ? { ...s, prompt: fill(s.prompt, text, used) }
        : s,
    );
  }
  if (Array.isArray(bot.subscriptions)) {
    out.subscriptions = bot.subscriptions.map((s) =>
      s && typeof s.note === "string"
        ? { ...s, note: fill(s.note, text, used) }
        : s,
    );
  }
  const missing = declared
    .filter((s) => s && empty.has(s.name) && used.has(s.name))
    .map((s) => ({ name: s.name, label: s.label || s.name }));
  return { bot: out, missing };
}

/** The run's error when settings it uses have no value. */
function missingMessage(missing) {
  const list = (missing || []).map((m) =>
    m.label && m.label !== m.name ? `${m.label} ({${m.name}})` : `{${m.name}}`,
  );
  if (!list.length) return null;
  return `This team's setting${list.length === 1 ? "" : "s"} ${list.join(
    ", ",
  )} ${list.length === 1 ? "has" : "have"} no value: fill ${
    list.length === 1 ? "it" : "them"
  } in on the dashboard (Bots › Team settings), then run again.`;
}

/**
 * A team's settings with some declared and values set: { declared, values,
 * errors }. `declare` adds settings or replaces ones of the same name;
 * `remove` takes some away (and their values); `values` is a patch.
 * Nothing changes when there are errors.
 */
function mergeTeamValues(
  current,
  { declare = null, values = null, remove = null } = {},
) {
  const errors = [];
  const now = cleanSettings(current && current.declared).settings;
  let declared = now;
  if (declare !== null && declare !== undefined) {
    const read = cleanSettings(declare);
    errors.push(...read.errors);
    const byName = new Map(now.map((d) => [d.name, d]));
    for (const d of read.settings) byName.set(d.name, d);
    declared = [...byName.values()];
  }
  if (Array.isArray(remove) && remove.length) {
    const gone = new Set(remove.map(String));
    for (const n of gone) {
      if (!declared.some((d) => d.name === n)) {
        errors.push(`"${n}" isn't one of this team's settings`);
      }
    }
    declared = declared.filter((d) => !gone.has(d.name));
  }
  if (declared.length > MAX_SETTINGS) {
    errors.push(`a team can have at most ${MAX_SETTINGS} settings`);
  }
  const read = cleanValues(declared, values, current && current.values);
  errors.push(...read.errors);
  return { declared, values: read.values, errors };
}

/** A folder that comes from a setting ("{workFolder}/repo"): it travels. */
function usesSetting(str, names) {
  const s = String(str || "");
  const m = s.match(/^\{([A-Za-z][A-Za-z0-9_]{0,39})\}/);
  return !!m && (!names || names.includes(m[1]));
}

module.exports = {
  TYPES,
  NAME_RE,
  cleanSettings,
  cleanValues,
  mergeTeamValues,
  settingTexts,
  fill,
  namesUsed,
  withTeamValues,
  missingMessage,
  usesSetting,
  isFolderPath,
};
