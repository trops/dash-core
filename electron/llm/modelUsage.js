/**
 * modelUsage.js
 *
 * Where a model is still saved — Settings › AI's job defaults, each bot's
 * own model, the Dash team's older per-role picks, and every widget's Model
 * setting on every dashboard — and moving all of one retired model to what
 * replaces it, in the saved settings themselves (not only at run time).
 *
 * Pure: the caller loads and saves settings, bots and dashboards.
 */
"use strict";

const {
  isKnownRetired,
  migrateModelId,
  isLatestAlias,
  latestAlias,
  getCuratedModels,
} = require("./modelProviders");

/** A layout item's id, or null (an item with none is left alone). */
const itemId = (item) =>
  item && (item.uuid != null || item.id != null)
    ? String(item.uuid != null ? item.uuid : item.id)
    : null;

/**
 * Whether a widget's Model setting can hold "Latest <family>": only a
 * setting of type "model". A widget whose Model lists exact versions gets
 * the exact model instead, so its own setting still shows it.
 */
const holdsFamily = (item) => {
  const field =
    item &&
    item.widgetConfig &&
    item.widgetConfig.userConfig &&
    item.widgetConfig.userConfig.model;
  return !!(field && field.type === "model");
};

const PROVIDER = "claude-code"; // Claude's models: the same for both backends

/** A dashboard's widgets, once each (a paged one mirrors its active page). */
function widgetsOf(workspace) {
  const seen = new Set();
  const out = [];
  const take = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !item.component) continue;
      const key = itemId(item);
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  };
  for (const page of Array.isArray(workspace.pages) ? workspace.pages : []) {
    take(page && page.layout);
  }
  take(workspace.layout);
  return out;
}

const savedModel = (item) =>
  item && item.userPrefs && typeof item.userPrefs.model === "string"
    ? item.userPrefs.model
    : null;

/**
 * Every saved model choice: [{ kind, model, name, ...where }].
 *   kind "default": { job }; "bot": { botId }; "teamPick": { providerId,
 *   role }; "widget": { workspaceId, dashboard, widgetId, component }.
 */
function savedChoices({
  settings = {},
  bots = [],
  workspaces = [],
  activeIds = null,
}) {
  const out = [];
  const defaults = (settings.ai && settings.ai.defaults) || {};
  for (const [job, d] of Object.entries(defaults)) {
    if (d && typeof d.model === "string" && d.model) {
      out.push({ kind: "default", job, model: d.model, name: job });
    }
  }
  const picks = (settings.dashTeam && settings.dashTeam.models) || {};
  for (const [providerId, roles] of Object.entries(picks)) {
    for (const [role, model] of Object.entries(roles || {})) {
      if (typeof model === "string" && model) {
        out.push({ kind: "teamPick", providerId, role, model, name: role });
      }
    }
  }
  for (const bot of bots) {
    if (bot && typeof bot.model === "string" && bot.model) {
      out.push({
        kind: "bot",
        botId: bot.id,
        model: bot.model,
        name: bot.name || bot.id,
      });
    }
  }
  for (const ws of workspaces) {
    if (!ws) continue;
    for (const item of widgetsOf(ws)) {
      const model = savedModel(item);
      if (!model) continue;
      out.push({
        kind: "widget",
        workspaceId: ws.id,
        dashboard: ws.name || ws.label || String(ws.id),
        widgetId: itemId(item),
        component: item.component,
        holdsFamily: holdsFamily(item),
        // On a dashboard the open profile doesn't show.
        otherProfile: !!activeIds && !activeIds.has(String(ws.id)),
        model,
        name: item.component,
      });
    }
  }
  return out;
}

/**
 * What to move a retired model to: the newest of its replacement's family
 * ("latest:sonnet"), else the exact replacement; null when none is known.
 */
function moveTarget(model) {
  if (!isKnownRetired(PROVIDER, model)) return null;
  const next = migrateModelId(PROVIDER, model);
  if (!next || next === model) return null;
  if (isLatestAlias(next)) return next;
  const m = getCuratedModels(PROVIDER).find((x) => x.value === next);
  return m && m.family ? latestAlias(m.family) : next;
}

/**
 * Saved choices of retired models, by model: [{ model, to, count, kinds:
 * { default, bot, teamPick, widget }, dashboards: [{ name, count }],
 * choices }]. `to` is null when the replacement isn't known.
 */
function retiredUsage(input) {
  const byModel = new Map();
  for (const c of savedChoices(input)) {
    if (isLatestAlias(c.model) || !isKnownRetired(PROVIDER, c.model)) continue;
    if (!byModel.has(c.model)) {
      byModel.set(c.model, {
        model: c.model,
        to: moveTarget(c.model),
        count: 0,
        kinds: { default: 0, bot: 0, teamPick: 0, widget: 0 },
        // Widgets that get the exact model (their Model lists versions).
        exactWidgets: 0,
        dashboards: [],
        choices: [],
      });
    }
    const u = byModel.get(c.model);
    u.count++;
    u.kinds[c.kind]++;
    if (c.kind === "widget" && !c.holdsFamily) u.exactWidgets++;
    u.choices.push(c);
    if (c.kind === "widget") {
      const d = u.dashboards.find((x) => x.workspaceId === c.workspaceId);
      if (d) d.count++;
      else
        u.dashboards.push({
          workspaceId: c.workspaceId,
          name: c.dashboard,
          count: 1,
          otherProfile: c.otherProfile,
        });
    }
  }
  return [...byModel.values()];
}

/** How many saved choices follow a model id (a widget count for notices). */
function countFollowing(input, id, kind = null) {
  return savedChoices(input).filter(
    (c) => c.model === id && (!kind || c.kind === kind),
  ).length;
}

/** "latest:sonnet" → the newest Sonnet's id; an exact id stays. */
function exactOf(to) {
  return isLatestAlias(to) ? migrateModelId(PROVIDER, to) : to;
}

/**
 * Set the chosen widgets' model. `forAll`: every one gets `to` as it is
 * (the user chose "Latest Sonnet" for all); otherwise a widget whose Model
 * lists versions gets the exact model. `exact` counts those.
 */
function setWidgetModel(items, ids, to, forAll = false) {
  let changed = 0;
  let exact = 0;
  const next = (Array.isArray(items) ? items : []).map((item) => {
    const id = itemId(item);
    if (id === null || !ids.has(id)) return item;
    if (savedModel(item) === null) return item;
    changed++;
    const model = forAll || holdsFamily(item) ? to : exactOf(to);
    if (model !== to) exact++;
    return { ...item, userPrefs: { ...item.userPrefs, model } };
  });
  return { items: next, changed, exact };
}

/**
 * The saved changes that move every choice of `from` to `to`:
 * { aiDefaults: { <job>: { model } }, teamPicks: settings.dashTeam.models
 *   (whole, or null), bots: [{ id, model }], workspaces: [workspace] }.
 * Only choices still on `from` move.
 */
function planMove(input, from, to, { forAll = false } = {}) {
  const choices = savedChoices(input).filter((c) => c.model === from);
  const aiDefaults = {};
  const bots = [];
  let teamPicks = null;
  const widgetIds = new Map(); // workspaceId → Set(widgetId)
  for (const c of choices) {
    if (c.kind === "default") aiDefaults[c.job] = { model: to };
    else if (c.kind === "bot") bots.push({ id: c.botId, model: to });
    else if (c.kind === "teamPick") {
      if (!teamPicks) {
        teamPicks = JSON.parse(
          JSON.stringify((input.settings.dashTeam || {}).models || {}),
        );
      }
      teamPicks[c.providerId][c.role] = to;
    } else if (c.kind === "widget") {
      if (!widgetIds.has(c.workspaceId))
        widgetIds.set(c.workspaceId, new Set());
      widgetIds.get(c.workspaceId).add(c.widgetId);
    }
  }
  const workspaces = [];
  let exact = 0;
  for (const ws of input.workspaces || []) {
    const ids = ws && widgetIds.get(ws.id);
    if (!ids) continue;
    const layout = setWidgetModel(ws.layout, ids, to, forAll);
    // Each widget once: a paged dashboard mirrors its active page.
    const counted = new Set();
    const countExact = (items) => {
      for (const item of Array.isArray(items) ? items : []) {
        const id = itemId(item);
        if (id === null || !ids.has(id) || counted.has(id)) continue;
        counted.add(id);
        if (!forAll && !holdsFamily(item) && exactOf(to) !== to) exact++;
      }
    };
    const pages = Array.isArray(ws.pages)
      ? ws.pages.map((p) => {
          if (!p) return p;
          countExact(p.layout);
          return {
            ...p,
            layout: setWidgetModel(p.layout, ids, to, forAll).items,
          };
        })
      : ws.pages;
    countExact(ws.layout);
    workspaces.push({ ...ws, layout: layout.items, pages });
  }
  return {
    aiDefaults,
    teamPicks,
    bots,
    workspaces,
    count: choices.length,
    // Widgets that got the exact model (their Model lists versions).
    exact,
  };
}

module.exports = {
  widgetsOf,
  savedChoices,
  retiredUsage,
  moveTarget,
  countFollowing,
  planMove,
};
