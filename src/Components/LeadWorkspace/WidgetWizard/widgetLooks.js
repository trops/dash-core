/**
 * widgetLooks — step 4 · Looks (the approved "Widget, step by step" looks
 * and tweak frames): the ways a widget could look, drawn in the app with
 * dash-react from the user's real data (or the Planner's sample), and the
 * options each look has. Pure: StepLooks draws them; the Builder is told
 * the one picked (planBuild lookLines).
 */

const MAX_ITEMS = 8;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

const LIST_KEYS =
  /^(items|results|events|data|entries|records|rows|list|todos|tasks|messages|values)$/i;

/**
 * The list of things in a value: under a list-like key (items, results,
 * events…) first, else the longest list found — so a calendar's
 * defaultReminders never stand in for its events.
 */
function firstList(v) {
  const found = [];
  const walk = (x, key, depth) => {
    if (depth > 5) return;
    if (Array.isArray(x)) {
      if (x.some((y) => isObj(y) || typeof y === "string")) {
        found.push({ list: x, key: String(key || "") });
      }
      return;
    }
    if (isObj(x)) {
      for (const k of Object.keys(x)) walk(x[k], k, depth + 1);
    }
  };
  walk(v, "", 0);
  if (!found.length) return null;
  const named = found.find((f) => LIST_KEYS.test(f.key) && f.list.length);
  if (named) return named.list;
  return found.reduce((a, b) => (b.list.length > a.list.length ? b : a)).list;
}

const flat = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObj(v)) {
    // { dateTime } / { date } (calendars), { name } (people, places),
    // { friendly_name } (Home Assistant attributes).
    for (const k of [
      "dateTime",
      "date",
      "friendly_name",
      "name",
      "title",
      "value",
      "text",
    ]) {
      if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
    }
  }
  return "";
};

/**
 * The things a widget would show, from a read's result (an MCP tool result
 * or its text) — or the Planner's sample lines. Each: { key: text }.
 * @returns {Array<object>}
 */
export function itemsFrom(result) {
  let raw = result;
  if (isObj(result) && Array.isArray(result.content)) {
    const texts = result.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text);
    // One block per thing: each its own JSON.
    const each = texts.map((t) => {
      try {
        return JSON.parse(t);
      } catch (_e) {
        return undefined;
      }
    });
    raw =
      texts.length > 1 && each.every((x) => x !== undefined)
        ? each
        : texts.join("\n");
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    try {
      raw = JSON.parse(t);
    } catch (_e) {
      // Plain lines.
      return (
        t
          .split(/\n+/)
          // List marks only ("- ", "* ", "3. ") — a time or a date stays.
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
          .filter(Boolean)
          .slice(0, MAX_ITEMS)
          .map((l) => ({ title: l }))
      );
    }
  }
  const list = firstList(raw) || [];
  return list.slice(0, MAX_ITEMS).map((x) => {
    if (typeof x === "string") return { title: x };
    const out = {};
    for (const k of Object.keys(x)) {
      const v = flat(x[k]);
      if (v && v.length <= 200) out[k] = v;
    }
    return out;
  });
}

// Each role's keys, best first: a calendar's start, never when the event
// was created.
const ROLE_KEYS = {
  title: [
    "summary",
    "title",
    "friendly_name",
    "name",
    "subject",
    "item",
    "label",
    "message",
    "text",
    "description",
  ],
  time: [
    "start",
    "starts_at",
    "startTime",
    "start_time",
    "dateTime",
    "datetime",
    "time",
    "when",
    "date",
    "due",
    "begin",
    "scheduled",
    "last_changed",
    "updated",
    "created",
  ],
  place: ["location", "place", "where", "venue", "area", "room", "address"],
  status: ["status", "state", "completed", "done"],
};
const SKIP =
  /^(id|uid|uuid|_id|etag|kind|icon|url|link|context|attributes|entity_?id|html_?link)$|(^|_)(id|url)$|[a-z](Id|Url|Link)$/;

/**
 * Which of the items' fields is the title, the time, the place, the
 * status — and every field shown as a choice ("For each, show").
 */
export function fieldRoles(items) {
  const keys = [];
  for (const it of items || []) {
    for (const k of Object.keys(it || {})) {
      if (!keys.includes(k)) keys.push(k);
    }
  }
  const find = (names) => {
    for (const n of names) {
      const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
      if (k) return k;
    }
    return null;
  };
  const title =
    find(ROLE_KEYS.title) ||
    keys.find(
      (k) =>
        !SKIP.test(k) &&
        !ROLE_KEYS.time.some((n) => n.toLowerCase() === k.toLowerCase()),
    ) ||
    null;
  const roles = {
    title,
    time: find(ROLE_KEYS.time),
    place: find(ROLE_KEYS.place),
    status: find(ROLE_KEYS.status),
  };
  const fields = keys.filter((k) => !SKIP.test(k));
  return { ...roles, fields };
}

/** "start" → "Start"; "location_name" → "Location name". */
export function fieldLabel(key) {
  const w = String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : "";
}

/** An ISO date-time as "9:00 AM" (today) or "Wed, Nov 11"; else as it is. */
export function timeText(v) {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  if (!/T\d/.test(s)) {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The looks a widget can have — each drawn with Dash's own components
 * (design guide). `fits`: whether it suits the data.
 */
export const LOOKS = [
  {
    id: "list",
    name: "List",
    what: "Every one in order, one row each.",
    builtFrom: "PanelHeader · list rows · EmptyState",
    fits: () => true,
  },
  {
    id: "timeline",
    name: "Timeline",
    what: "Times down the side, so the gaps show.",
    builtFrom: "PanelHeader · list rows",
    fits: (r) => !!r.time,
  },
  {
    id: "next",
    name: "Next up",
    what: "The first one large; the rest below.",
    builtFrom: "PanelHeader · StatusBadge · list rows",
    fits: (r) => !!r.time,
  },
  {
    id: "cards",
    name: "Cards",
    what: "A small card for each, side by side.",
    builtFrom: "PanelHeader · cards",
    fits: () => true,
  },
  {
    id: "count",
    name: "Count",
    what: "How many there are, large, with the first few below.",
    builtFrom: "PanelHeader · stat · list rows",
    fits: () => true,
  },
];

export const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];

/** The looks in the order offered: the ones that suit the data first. */
export function looksFor(roles) {
  const r = roles || {};
  const fit = LOOKS.filter((l) => l.fits(r));
  return [...fit, ...LOOKS.filter((l) => !fit.includes(l))];
}

/** What a look starts with (the tweak frame's controls). */
export function defaultOptions(roles, whenEmpty = "") {
  const r = roles || {};
  return {
    spacing: "Roomy",
    header: "Title and count",
    markFirst: r.time ? "On" : "Off",
    timeAt: "Left column",
    fields: [r.title, r.time, r.place].filter(Boolean),
    empty: text(whenEmpty) || "Nothing to show",
  };
}

/** The controls a look offers, as segmented choices. */
export function optionControls(look, roles) {
  const r = roles || {};
  const out = [
    { key: "spacing", label: "Spacing", options: ["Roomy", "Compact"] },
    {
      key: "header",
      label: "Header",
      options: ["Title and count", "Title only", "None"],
    },
  ];
  if (look.id !== "count" && look.id !== "cards") {
    out.push({
      key: "markFirst",
      label: r.time ? "Mark the next one" : "Mark the first one",
      options: ["On", "Off"],
    });
  }
  if (r.time && look.id !== "timeline" && look.id !== "count") {
    out.push({
      key: "timeAt",
      label: "Time",
      options: ["Left column", "Under the title"],
    });
  }
  return out;
}

const words = (s) =>
  String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The read's arguments from the widget's settings: each input the tool
 * takes, filled from a setting that names it ("entity_id" from
 * "todoEntityId") — so the previews read what the widget will.
 * @param {object} schema    the tool's inputSchema
 * @param {object} settings  the widget's settings
 */
export function argsFromSettings(schema, settings) {
  const props = (schema && isObj(schema.properties) && schema.properties) || {};
  const out = {};
  for (const p of Object.keys(props)) {
    const want = words(p);
    if (!want.length) continue;
    const k = Object.keys(settings || {}).find((key) => {
      const have = words(key);
      return want.every((w) => have.includes(w));
    });
    const v = k !== undefined ? settings[k] : undefined;
    if (typeof v === "string" ? v.trim() : typeof v === "number") out[p] = v;
  }
  return out;
}

/**
 * How many the widget shows at most: its number setting that says so
 * ("maxItems", "limit", "count") — or null.
 */
export function shownLimit(settings) {
  for (const k of Object.keys(settings || {})) {
    const v = Number(settings[k]);
    if (/max|limit|count|show/i.test(k) && Number.isInteger(v) && v > 0) {
      return v;
    }
  }
  return null;
}
