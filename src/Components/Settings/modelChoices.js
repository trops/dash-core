/**
 * modelChoices.js — the one model list every picker shows (Settings › AI's
 * defaults, a bot's Model, a Chat widget's Model): "Latest <family>", which
 * follows the newest of a family, then each exact version. The models come
 * from the main process (LLM_LIST_MODELS) with their family and status;
 * electron/llm/modelProviders.js resolves the same ids at run time.
 *
 * Pure, so it's tested on its own.
 */

export const LATEST_PREFIX = "latest:";

// The families in the order they're offered, and a word on each.
const FAMILY_ORDER = ["opus", "sonnet", "haiku", "fable"];
const FAMILY_NOTE = {
  opus: "most capable",
  sonnet: "balanced",
  haiku: "fastest",
};

export const GROUP_LATEST = "Follows the newest";
export const GROUP_EXACT = "Stays on one version";

export function isLatest(id) {
  return typeof id === "string" && id.startsWith(LATEST_PREFIX);
}

export function latestOf(family) {
  return `${LATEST_PREFIX}${family}`;
}

export function familyOf(id) {
  return isLatest(id) ? id.slice(LATEST_PREFIX.length) : null;
}

/** "opus" → "Opus". */
export function familyName(family) {
  const f = String(family || "");
  return f ? f.charAt(0).toUpperCase() + f.slice(1) : "";
}

/** "Claude Haiku 5.5" → "Haiku 5.5". */
function shortLabel(m) {
  return String((m && (m.label || m.value)) || "").replace(/^Claude /, "");
}

/**
 * A name for a Claude model id the list doesn't have (a retired one):
 * "claude-sonnet-4-20250514" → "Claude Sonnet 4"; "claude-3-5-haiku-…" →
 * "Claude 3.5 Haiku". Other ids stay as they are.
 */
export function nameFromId(id) {
  const raw = String(id || "");
  if (!/^claude-/.test(raw)) return raw;
  const words = [];
  for (const p of raw.replace(/-\d{8}$/, "").split("-")) {
    const last = words[words.length - 1];
    if (/^\d+$/.test(p) && last && /^\d+(\.\d+)?$/.test(last)) {
      words[words.length - 1] = `${last}.${p}`;
    } else {
      words.push(/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1));
    }
  }
  return words.join(" ");
}

/** The newest model of a family that still runs, or null. */
export function newestOf(models, family) {
  return (
    (models || []).find((m) => m.family === family && m.status !== "retired") ||
    null
  );
}

/**
 * The model entry a saved id runs on: "latest:haiku" → the newest Haiku;
 * an exact id → its entry; unknown → null.
 */
export function resolveModel(models, id) {
  const family = familyOf(id);
  if (family) return newestOf(models, family);
  return (models || []).find((m) => m.value === id) || null;
}

/** "Latest Haiku" / "Haiku 5.5" / the id itself when it isn't known. */
export function choiceLabel(models, id) {
  const family = familyOf(id);
  if (family) return `Latest ${familyName(family)}`;
  const m = resolveModel(models, id);
  return m ? shortLabel(m) : nameFromId(id).replace(/^Claude /, "");
}

/** "now Haiku 5.5" for a family; "exact version" for one model. */
export function choiceNow(models, id) {
  if (!id) return "";
  if (isLatest(id)) {
    const m = resolveModel(models, id);
    return m ? `now ${shortLabel(m)}` : "none offered now";
  }
  const m = resolveModel(models, id);
  if (!m) return "not offered any more";
  if (m.status === "retired") return "retired";
  return "exact version";
}

/** "Latest Haiku, now Haiku 5.5" / "Haiku 5.5" — in a sentence. */
export function choiceText(models, id) {
  if (isLatest(id)) {
    const m = resolveModel(models, id);
    return m
      ? `${choiceLabel(models, id)}, now ${shortLabel(m)}`
      : choiceLabel(models, id);
  }
  return choiceLabel(models, id);
}

/** The families offered, newest-first models aside, in their usual order. */
export function familiesOf(models) {
  const seen = [];
  for (const m of models || []) {
    if (m.family && m.status !== "retired" && !seen.includes(m.family)) {
      seen.push(m.family);
    }
  }
  const rank = (f) => {
    const i = FAMILY_ORDER.indexOf(f);
    return i < 0 ? FAMILY_ORDER.length : i;
  };
  return seen.sort((a, b) => rank(a) - rank(b));
}

/**
 * The picker's options, for dash-react's SelectInput: { value, label,
 * description, group, muted?, badge? }. `badges.newIds` are models that
 * just came out (tagged New); `makeBadge(kind, text)` renders a tag.
 *
 * @param {object[]} models
 * @param {{ value?: string, first?: object[], newIds?: string[],
 *   makeBadge?: (kind: string, text: string) => any }} [opts]
 *   `first`: options above the groups ("Bots default", "Built in").
 */
export function modelOptions(models, opts = {}) {
  const { value = "", first = [], newIds = [], makeBadge = null } = opts;
  const isNew = (id) => newIds.includes(id);
  const badge = (kind, text) => (makeBadge ? makeBadge(kind, text) : null);
  const out = [...first];

  for (const family of familiesOf(models)) {
    const newest = newestOf(models, family);
    const note = FAMILY_NOTE[family];
    out.push({
      value: latestOf(family),
      label: `Latest ${familyName(family)}`,
      description: `now ${shortLabel(newest)}${note ? ` · ${note}` : ""}`,
      group: GROUP_LATEST,
      ...(isNew(newest.value) ? { badge: badge("info", "New") } : {}),
    });
  }

  for (const m of models || []) {
    if (m.status === "retired") continue;
    const older = m.status === "older" || m.status === "retiring";
    const option = {
      value: m.value,
      label: shortLabel(m),
      description: older ? "older" : "",
      group: GROUP_EXACT,
    };
    if (older) option.muted = true;
    if (m.status === "retiring") {
      option.badge = badge("warning", "Retiring");
      if (m.retiresOn) option.description = `older · goes away ${m.retiresOn}`;
    } else if (isNew(m.value)) {
      option.badge = badge("info", "New");
    }
    if (!option.description) delete option.description;
    out.push(option);
  }

  // A saved choice the list doesn't offer (retired, unknown, or a family
  // with nothing left) still shows, dimmed, so the field says what's saved.
  if (value && !out.some((o) => o.value === value)) {
    out.push({
      value,
      label: choiceLabel(models, value),
      description: choiceNow(models, value),
      group: isLatest(value) ? GROUP_LATEST : GROUP_EXACT,
      muted: true,
    });
  }
  return out;
}

/**
 * Exact versions that are each the newest of their family → "Latest <family>"
 * (the one-time "Keep your models up to date?"). Returns
 * [{ job, from, to }] for the jobs that would move.
 */
export function followNewestRows(defaults, models) {
  const rows = [];
  for (const [job, d] of Object.entries(defaults || {})) {
    const id = d && d.model;
    if (!id || isLatest(id)) continue;
    const m = resolveModel(models, id);
    if (!m || !m.family || m.status === "retired") continue;
    rows.push({
      job,
      from: id,
      to: latestOf(m.family),
      // Already the newest: nothing changes on the day.
      sameToday:
        !!newestOf(models, m.family) && newestOf(models, m.family).value === id,
    });
  }
  return rows;
}
