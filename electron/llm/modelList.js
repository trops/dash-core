/**
 * modelList.js
 *
 * Keeps the model list fresh without an app update. Dash publishes the
 * current Claude models (family, newest first, status, what replaces a
 * retired one) as a small file; this fetches it, checks every entry, and
 * hands it to modelProviders.setFreshList. With an Anthropic API key saved,
 * Anthropic's own Models API narrows it to what that key can use.
 *
 * When it checks: at start, every 24 hours while the app runs, on wake when
 * the last check is over a day old (the host calls tick()), right away when
 * a run finds its model gone (checkNow), and from Settings › AI (Check now).
 * A failed check keeps the last good list (saved between launches) and
 * tries again in an hour.
 *
 * Electron-free: fetch, the saved copy, the clock and timers are injected.
 */
"use strict";

const { setFreshList, mergeLive } = require("./modelProviders");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// How often the timer looks at whether a check is due.
const TICK_MS = 10 * 60 * 1000;
// A run that finds its model gone checks at most this often.
const FORCED_GAP_MS = 5 * 60 * 1000;
const MAX_MODELS = 100;

const STATUSES = new Set(["current", "older", "retiring", "retired"]);
const TIERS = new Set(["fast", "balanced", "deep"]);
const ID = /^[a-z0-9][a-z0-9.\-]{1,80}$/;
const FAMILY = /^[a-z]{2,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// What replaces a retired model may be a family: "latest:sonnet".
const TARGET = /^(?:latest:[a-z]{2,20}|[a-z0-9][a-z0-9.\-]{1,80})$/;
const EFFORT_REASONING = {
  control: "effort",
  levels: ["low", "medium", "high"],
};

const text = (v, max) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const price = (v) => (typeof v === "number" && v >= 0 && v < 10000 ? v : null);

/** One model entry as the app uses it, or null when it isn't one. */
function parseModel(m) {
  if (!m || typeof m !== "object") return null;
  if (typeof m.value !== "string" || !ID.test(m.value)) return null;
  if (typeof m.family !== "string" || !FAMILY.test(m.family)) return null;
  const out = {
    value: m.value,
    label: text(m.label, 80) || m.value,
    family: m.family,
    status: STATUSES.has(m.status) ? m.status : "current",
  };
  if (TIERS.has(m.tier)) out.tier = m.tier;
  // 'effort' as published; the object form as saved.
  const effort =
    m.reasoning === "effort" ||
    (m.reasoning && m.reasoning.control === "effort");
  out.reasoning = effort ? EFFORT_REASONING : null;
  if (m.pricing && price(m.pricing.input) !== null) {
    const output = price(m.pricing.output);
    if (output !== null) out.pricing = { input: m.pricing.input, output };
  }
  if (typeof m.retiresOn === "string" && DATE.test(m.retiresOn)) {
    out.retiresOn = m.retiresOn;
  }
  if (typeof m.replacedBy === "string" && TARGET.test(m.replacedBy)) {
    out.replacedBy = m.replacedBy;
  }
  return out;
}

/**
 * The published list, checked: { updated, models, retiredMap } for
 * Anthropic's models, or null when it isn't a list the app can use. Entries
 * that don't check out are left out; a list with none left is refused.
 */
function parseModelList(json) {
  if (!json || typeof json !== "object" || json.version !== 1) return null;
  const p = json.providers && json.providers.anthropic;
  if (!p || !Array.isArray(p.models)) return null;
  const seen = new Set();
  const models = [];
  for (const raw of p.models.slice(0, MAX_MODELS)) {
    const m = parseModel(raw);
    if (!m || seen.has(m.value)) continue;
    seen.add(m.value);
    models.push(m);
  }
  if (!models.some((m) => m.status !== "retired")) return null;
  const retiredMap = {};
  if (p.retired && typeof p.retired === "object") {
    for (const [from, to] of Object.entries(p.retired)) {
      if (ID.test(from) && typeof to === "string" && TARGET.test(to)) {
        retiredMap[from] = to;
      }
    }
  }
  return {
    updated:
      typeof json.updated === "string" && DATE.test(json.updated)
        ? json.updated
        : null,
    models,
    retiredMap,
  };
}

/**
 * @param {{
 *   url: string,
 *   fetchJson: (url: string) => Promise<object>,
 *   readSaved?: () => object|null,
 *   save?: (saved: object) => void,
 *   getApiKey?: () => Promise<string|null>,
 *   listLive?: (apiKey: string) => Promise<Array<{value,label}>>,
 *   builtInIds?: () => string[],
 *   now?: () => number,
 *   setInterval?: Function, clearInterval?: Function,
 *   onChange?: (status: object) => void,
 * }} deps
 */
function createModelList(deps) {
  const now = deps.now || (() => Date.now());
  const save = deps.save || (() => {});
  const onChange = deps.onChange || (() => {});
  const setTimer = deps.setInterval || setInterval;
  const clearTimer = deps.clearInterval || clearInterval;

  let saved = null; // { list, checkedAt, added }
  let attemptedAt = null;
  let error = null;
  let inFlight = null;
  let timer = null;

  const idsOf = (list) =>
    list ? list.models.map((m) => m.value) : (deps.builtInIds || (() => []))();

  function status() {
    return {
      source: saved && saved.list ? "dash" : "built-in",
      checkedAt: saved ? saved.checkedAt || null : null,
      attemptedAt,
      error,
      updated: saved && saved.list ? saved.list.updated : null,
      // Models that came with the last change of list, until it's seen.
      added: (saved && saved.added) || [],
    };
  }

  /** Load the saved copy (if any) so the app starts on the last good list. */
  function load() {
    let s = null;
    try {
      s = deps.readSaved ? deps.readSaved() : null;
    } catch (_e) {
      s = null;
    }
    const list =
      s && s.list
        ? parseModelList({
            version: 1,
            updated: s.list.updated,
            providers: {
              anthropic: { models: s.list.models, retired: s.list.retiredMap },
            },
          })
        : null;
    if (list) {
      saved = {
        list,
        checkedAt: typeof s.checkedAt === "number" ? s.checkedAt : null,
        added: Array.isArray(s.added) ? s.added.filter((x) => ID.test(x)) : [],
      };
      setFreshList("anthropic", saved.list);
    }
    return status();
  }

  async function runCheck() {
    attemptedAt = now();
    try {
      const parsed = parseModelList(await deps.fetchJson(deps.url));
      if (!parsed) throw new Error("The model list couldn't be read.");
      let models = parsed.models;
      const key = deps.getApiKey ? await deps.getApiKey() : null;
      if (key && deps.listLive) {
        try {
          const live = await deps.listLive(key);
          if (Array.isArray(live) && live.length) {
            models = mergeLive(models, live, parsed.retiredMap);
          }
        } catch (_e) {
          // Anthropic's list is a narrowing only: Dash's list still stands.
        }
      }
      const list = { ...parsed, models };
      const before = new Set(idsOf(saved && saved.list));
      // New: in Dash's list (not only Anthropic's), offered, not seen before.
      const offered = new Set(models.map((m) => m.value));
      const fresh = parsed.models
        .filter(
          (m) =>
            m.status !== "retired" &&
            offered.has(m.value) &&
            !before.has(m.value),
        )
        .map((m) => m.value);
      saved = {
        list,
        checkedAt: now(),
        // A first list after the built-in one only names what's truly new.
        added: fresh.length ? fresh : (saved && saved.added) || [],
      };
      setFreshList("anthropic", list);
      error = null;
      try {
        save(saved);
      } catch (_e) {
        // Not saved: this launch still uses it.
      }
    } catch (e) {
      error = (e && e.message) || String(e);
    }
    const s = status();
    onChange(s);
    return s;
  }

  /** Check now (Settings › AI, or a run that found its model gone). */
  function check() {
    if (!inFlight) {
      inFlight = runCheck().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /**
   * A run found its model gone: check unless one ran in the last few
   * minutes. Resolves once the list is as fresh as it will get.
   */
  function checkNow() {
    if (inFlight) return inFlight;
    if (attemptedAt !== null && now() - attemptedAt < FORCED_GAP_MS) {
      return Promise.resolve(status());
    }
    return check();
  }

  /** Check when one is due: a day since the last, or an hour after a failure. */
  function tick() {
    const t = now();
    const checkedAt = saved && saved.checkedAt;
    if (!checkedAt || t - checkedAt >= DAY_MS) {
      if (!error || attemptedAt === null || t - attemptedAt >= HOUR_MS) {
        return check();
      }
    }
    return Promise.resolve(status());
  }

  function start() {
    load();
    if (!timer) timer = setTimer(() => tick(), TICK_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
    return check();
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  /** The new models have been seen (Settings showed the note). */
  function clearAdded() {
    if (!saved || !saved.added || !saved.added.length) return status();
    saved = { ...saved, added: [] };
    try {
      save(saved);
    } catch (_e) {
      // Shown again next launch.
    }
    onChange(status());
    return status();
  }

  return { load, check, checkNow, tick, start, stop, status, clearAdded };
}

module.exports = {
  createModelList,
  parseModelList,
  DAY_MS,
  HOUR_MS,
  TICK_MS,
  FORCED_GAP_MS,
};
