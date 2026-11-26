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
 * A table (DASH-84) is rows of the same fields, each with a key: a team that
 * works on several repos keeps one row per repo. Bots use {repo.url},
 * {repo.validateCmd} … ({repo.key} is the row's key). Which row is the
 * job's pick: a bot names a row in its answer's last ```json block
 * ("repo": "dash-core"), and later runs fill {repo.*} from it (pickFrom).
 * The answer only names a row; what's filled in is always what the user
 * typed in the settings, so text from a ticket never becomes a command.
 *
 * Kept on the dashboard's team settings (BotStore teams[workspaceId]):
 *   declared  the settings, as above
 *   values    { [name]: value } (a value left out uses the default)
 *
 * Pure: no Electron, no I/O (the home folder is passed in).
 */
"use strict";

const { contextText, CONTEXT_NAMES } = require("../jobs/jobContext");
const { lastJsonObject } = require("./answerJson");

const COLUMN_TYPES = ["text", "url", "folder", "command", "boolean", "number"];
const TYPES = [...COLUMN_TYPES, "table"];
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// A table row's key: "dash-core", "web_app", "v2.api".
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// {name} or {table.field} in a bot's text (other braces, like JSON, are
// left alone).
const USE_RE =
  /\{([A-Za-z][A-Za-z0-9_]{0,39})(?:\.([A-Za-z][A-Za-z0-9_]{0,39}))?\}/g;
const MAX_SETTINGS = 30;
const MAX_COLUMNS = 12;
const MAX_ROWS = 30;
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
    if (type === "table") {
      const read = cleanColumns(s, where);
      if (read.error) {
        errors.push(read.error);
        return;
      }
      out.columns = read.columns;
      if (s.pick !== undefined && s.pick !== null && s.pick !== "") {
        if (typeof s.pick !== "string" || !NAME_RE.test(s.pick)) {
          errors.push(
            `${where} (${s.name}): pick must be a field name (letters, digits and underscores)`,
          );
          return;
        }
        if (s.pick !== s.name) out.pick = s.pick;
      }
      seen.add(s.name);
      settings.push(out);
      return;
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

/** A table's columns, checked: { columns } or { error }. */
function cleanColumns(s, where) {
  const cols = s.columns;
  if (!Array.isArray(cols) || !cols.length) {
    return {
      error: `${where} (${s.name}): a table needs its columns, e.g. [{ name: "url", type: "url" }]`,
    };
  }
  if (cols.length > MAX_COLUMNS) {
    return {
      error: `${where} (${s.name}): a table can have at most ${MAX_COLUMNS} columns`,
    };
  }
  const columns = [];
  const seen = new Set();
  for (const c of cols) {
    if (!isObj(c) || typeof c.name !== "string" || !NAME_RE.test(c.name)) {
      return {
        error: `${where} (${s.name}): each column's name must be letters, digits and underscores, starting with a letter`,
      };
    }
    if (c.name === "key") {
      return {
        error: `${where} (${s.name}): "key" is the row's own key, not a column`,
      };
    }
    if (seen.has(c.name)) {
      return {
        error: `${where} (${s.name}): column "${c.name}" is there twice`,
      };
    }
    const type = c.type === undefined || c.type === null ? "text" : c.type;
    if (!COLUMN_TYPES.includes(type)) {
      return {
        error: `${where} (${s.name}): column ${c.name}'s type must be one of ${COLUMN_TYPES.join(", ")}`,
      };
    }
    seen.add(c.name);
    const col = {
      name: c.name,
      label:
        typeof c.label === "string" && c.label.trim()
          ? c.label.trim().slice(0, MAX_LABEL)
          : c.name,
      type,
    };
    if (typeof c.description === "string" && c.description.trim()) {
      col.description = c.description.trim().slice(0, MAX_DESCRIPTION);
    }
    columns.push(col);
  }
  return { columns };
}

/** A table's rows, checked: { rows } or { error }. "" cells are left out. */
function cleanRows(s, raw) {
  let input = raw;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch (_e) {
      return { error: `${s.label}: must be a list of rows` };
    }
  }
  if (!Array.isArray(input)) {
    return { error: `${s.label}: must be a list of rows` };
  }
  if (input.length > MAX_ROWS) {
    return { error: `${s.label}: at most ${MAX_ROWS} rows` };
  }
  const cols = new Map((s.columns || []).map((c) => [c.name, c]));
  const keys = new Set();
  const rows = [];
  for (const [i, r] of input.entries()) {
    const where = `${s.label}, row ${i + 1}`;
    if (!isObj(r)) return { error: `${where}: must be an object` };
    const key = typeof r.key === "string" ? r.key.trim() : "";
    if (!KEY_RE.test(key)) {
      return {
        error: `${where}: its key must be letters, digits, ".", "_" or "-" (e.g. dash-core)`,
      };
    }
    if (keys.has(key))
      return { error: `${where}: key "${key}" is there twice` };
    keys.add(key);
    const row = { key };
    for (const [name, v] of Object.entries(r)) {
      if (name === "key") continue;
      const c = cols.get(name);
      if (!c) return { error: `${where}: "${name}" isn't one of its columns` };
      if (v === null || v === undefined || v === "") continue;
      const cv = coerce(c.type, v);
      if (cv === undefined || cv === "") {
        return { error: `${where}: ${c.label} must be ${TYPE_WORDS[c.type]}` };
      }
      if (c.type === "folder" && !isFolderPath(cv)) {
        return {
          error: `${where}: ${c.label} must be a whole path (/… or ~/…)`,
        };
      }
      if (typeof cv === "string" && cv.length > MAX_VALUE) {
        return { error: `${where}: ${c.label} is too long` };
      }
      row[name] = cv;
    }
    rows.push(row);
  }
  return { rows };
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
    if (s.type === "table") {
      const read = cleanRows(s, raw);
      if (read.error) {
        errors.push(read.error);
        continue;
      }
      if (read.rows.length) values[name] = read.rows;
      else delete values[name];
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
    if (s.type === "table") continue; // filled from the job's pick
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

/**
 * `str` with each {name} (and {table.field}) of `text` filled in; `used`
 * collects the names, and "table.field" for each cell. `tables`, when
 * given, says which names are tables: a {x.y} whose x isn't one is left
 * alone and not counted (it's someone's ${x.y}, not a setting).
 */
function fill(str, text, used = null, tables = null) {
  if (typeof str !== "string" || str.indexOf("{") === -1) return str;
  return str.replace(USE_RE, (whole, name, field) => {
    if (field) {
      if (tables && !tables.has(name)) return whole;
      const cell = `${name}.${field}`;
      if (used) {
        used.add(name);
        used.add(cell);
      }
      return has(text, cell) ? text[cell] : whole;
    }
    if (!has(text, name)) {
      if (used) used.add(name);
      return whole;
    }
    if (used) used.add(name);
    return text[name];
  });
}

/** Every string in `v` (deeply) filled in. */
function fillDeep(v, text, used, tables = null) {
  if (typeof v === "string") return fill(v, text, used, tables);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, text, used, tables));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      o[k] = fillDeep(x, text, used, tables);
    }
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
 * The rows of a team's tables a job picked (DASH-84), from a bot's answer:
 * the last ```json block (or the whole text, when it's JSON; answerJson), each table's
 * field (its name, or its `pick`) naming a row's key. Only names; nothing
 * here is checked against the rows (withTeamValues says when one isn't
 * there). Returns { [table]: key }.
 */
function pickFrom(textIn, team) {
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  const tables = declared.filter((d) => d && d.type === "table");
  if (!tables.length || typeof textIn !== "string" || !textIn) return {};
  const j = lastJsonObject(textIn);
  if (!j) return {};
  const picks = {};
  for (const t of tables) {
    const v = j[t.pick || t.name];
    if (typeof v === "string" && KEY_RE.test(v.trim())) {
      picks[t.name] = v.trim();
    }
  }
  return picks;
}

/**
 * A bot as it runs, its team's settings filled in: its instructions, its
 * folders, its checks (commands and every other text in them), its
 * schedules' prompts and its triggers' notes. The bot itself is left
 * alone (it keeps {name}).
 *
 * `picks` ({ [table]: key }, DASH-84) are the rows of its tables this run
 * uses: {repo.url} is the url of the row the job picked.
 *
 * @returns {{ bot: object, missing: Array<{name, label, reason?, ...}> }}
 *   missing: what it uses that can't be filled in (its run can't start):
 *   a setting with no value, or a table with no rows, no pick, a pick
 *   that isn't one of its rows, or an empty cell.
 */
function withTeamValues(
  bot,
  team,
  { home = null, picks = null, context = null } = {},
) {
  if (!bot) return { bot, missing: [] };
  const declared =
    (team && Array.isArray(team.declared) && team.declared) || [];
  // The job's work item and workspace (DASH-100): {item.id},
  // {workspace.dir}… fill in whether or not the team has settings.
  const ctxText = contextText(context || {});
  if (!declared.length && !usesContext(bot)) return { bot, missing: [] };
  const { text, empty } = declared.length
    ? settingTexts(team, { home })
    : { text: {}, empty: new Set() };
  Object.assign(text, ctxText);
  const values = (team && isObj(team.values) && team.values) || {};
  const tables = new Map();
  for (const t of declared) {
    if (!t || t.type !== "table" || !NAME_RE.test(String(t.name || ""))) {
      continue;
    }
    const rows = Array.isArray(values[t.name]) ? values[t.name] : [];
    const key =
      picks && typeof picks[t.name] === "string" ? picks[t.name] : null;
    const row = key ? rows.find((r) => r && r.key === key) || null : null;
    tables.set(t.name, { setting: t, rows, key, row });
    if (!row) continue;
    text[`${t.name}.key`] = row.key;
    for (const c of t.columns || []) {
      const v = row[c.name];
      if (v === undefined || v === null || v === "") {
        if (c.type === "boolean") text[`${t.name}.${c.name}`] = "no";
        continue;
      }
      text[`${t.name}.${c.name}`] = asText(c, v, home);
    }
  }
  const tableNames = new Set([...tables.keys(), ...CONTEXT_NAMES]);
  const used = new Set();
  const out = { ...bot };
  if (typeof bot.instructions === "string") {
    out.instructions = fill(bot.instructions, text, used, tableNames);
  }
  if (Array.isArray(bot.projects)) {
    out.projects = bot.projects.map((p) => fill(p, text, used, tableNames));
  }
  if (bot.checks) out.checks = fillDeep(bot.checks, text, used, tableNames);
  if (Array.isArray(bot.schedules)) {
    out.schedules = bot.schedules.map((s) =>
      s && typeof s.prompt === "string"
        ? { ...s, prompt: fill(s.prompt, text, used, tableNames) }
        : s,
    );
  }
  if (Array.isArray(bot.subscriptions)) {
    out.subscriptions = bot.subscriptions.map((s) =>
      s && typeof s.note === "string"
        ? { ...s, note: fill(s.note, text, used, tableNames) }
        : s,
    );
  }
  const missing = declared
    .filter(
      (s) => s && s.type !== "table" && empty.has(s.name) && used.has(s.name),
    )
    .map((s) => ({ name: s.name, label: s.label || s.name }));
  // {item.…} or {workspace.…} with none on the job yet: the run can't start.
  for (const name of CONTEXT_NAMES) {
    if (tables.has(name) || !used.has(name)) continue;
    const field = [...used].find((u) => u.startsWith(`${name}.`));
    if (field && !has(text, field)) {
      missing.push({ name, label: name, reason: `no-${name}`, field });
    }
  }
  for (const [name, t] of tables) {
    if (!used.has(name)) continue;
    const label = t.setting.label || name;
    const keys = t.rows.map((r) => r.key);
    if (!t.rows.length) {
      missing.push({ name, label, reason: "no-rows" });
    } else if (!t.key) {
      missing.push({
        name,
        label,
        reason: "unpicked",
        field: t.setting.pick || name,
        keys,
      });
    } else if (!t.row) {
      missing.push({ name, label, reason: "unknown", key: t.key, keys });
    } else {
      const cols = new Map((t.setting.columns || []).map((c) => [c.name, c]));
      for (const u of used) {
        if (!u.startsWith(`${name}.`)) continue;
        const field = u.slice(name.length + 1);
        if (has(text, u)) continue;
        missing.push({
          name,
          label,
          reason: cols.has(field) ? "empty-cell" : "no-column",
          key: t.key,
          field,
          fieldLabel: cols.has(field) ? cols.get(field).label : field,
        });
      }
    }
  }
  return { bot: out, missing };
}

/** Does the bot's text use {item.…} or {workspace.…}? */
function usesContext(bot) {
  const texts = usedParts(bot);
  const re = /\{(item|workspace)\.[A-Za-z_][A-Za-z0-9_]*\}/;
  return JSON.stringify(texts).search(re) !== -1;
}

/** The run's error when settings it uses can't be filled in. */
function missingMessage(missing) {
  const all = missing || [];
  const plain = all.filter((m) => !m.reason);
  const parts = [];
  const list = plain.map((m) =>
    m.label && m.label !== m.name ? `${m.label} ({${m.name}})` : `{${m.name}}`,
  );
  if (list.length) {
    parts.push(
      `This team's setting${list.length === 1 ? "" : "s"} ${list.join(
        ", ",
      )} ${list.length === 1 ? "has" : "have"} no value: fill ${
        list.length === 1 ? "it" : "them"
      } in on the dashboard (Bots › Team settings), then run again.`,
    );
  }
  const keysText = (keys) =>
    keys && keys.length ? keys.map((k) => `"${k}"`).join(", ") : "none";
  for (const m of all) {
    if (!m.reason) continue;
    const t = `${m.label} ({${m.name}.…})`;
    if (m.reason === "no-rows") {
      parts.push(
        `The team's table ${t} has no rows: add them on the dashboard (Bots › Team settings).`,
      );
    } else if (m.reason === "unpicked") {
      parts.push(
        `No row of ${t} is picked for this job yet: a bot before this one has to name one in its answer's JSON ("${m.field}": one of ${keysText(m.keys)}).`,
      );
    } else if (m.reason === "unknown") {
      parts.push(
        `This job picked "${m.key}" from ${t}, but it has no such row (it has ${keysText(m.keys)}).`,
      );
    } else if (m.reason === "empty-cell") {
      parts.push(
        `${t}: row "${m.key}" has no ${m.fieldLabel} ({${m.name}.${m.field}}): fill it in on the dashboard (Bots › Team settings).`,
      );
    } else if (m.reason === "no-item") {
      parts.push(
        `This job has no work item yet, so {${m.field}} can't be filled in: the task names one, or a bot before this one names it in its answer's JSON ("item": {"id": "…"}).`,
      );
    } else if (m.reason === "no-workspace") {
      parts.push(
        `This job has no workspace yet, so {${m.field}} can't be filled in: a bot before this one names it in its answer's JSON ("workspace": {"dir": "…", "branch": "…"}).`,
      );
    } else if (m.reason === "no-column") {
      parts.push(`${t} has no column "${m.field}" ({${m.name}.${m.field}}).`);
    }
  }
  return parts.length ? parts.join(" ") : null;
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
  COLUMN_TYPES,
  KEY_RE,
  pickFrom,
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
