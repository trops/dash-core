/**
 * reuseSpec — a widget the user already has, going into a cell (the approved
 * "A widget you already have goes through its own steps"): Which one,
 * Settings, Review. Nothing is built; the user picks which of the package's
 * widgets and how it's set — the Planner only suggests. Pure.
 */
import { keepsConnection } from "../../Create/planChecklist";
import { normalizeUserConfig } from "../../../utils/userConfigFields";
import { getUserConfigurableProviders } from "../../../utils/providerUtils";

/** The reuse steps, in order (the header's step bar). */
export const REUSE_STEPS = [
  { id: "which", label: "Which one" },
  { id: "settings", label: "Settings" },
  { id: "review", label: "Review" },
];

/**
 * The one widget a cell plan reuses (one the user has, or one from the
 * registry), or -1: a plan that makes a new widget has the wizard; several
 * widgets or bots keep the plan card.
 */
export function reuseIndex(plan) {
  if (!plan || !plan.cell || plan.widgetChange) return -1;
  const pieces = Array.isArray(plan.pieces) ? plan.pieces : [];
  if (pieces.some((p) => p && p.kind === "bot")) return -1;
  const widgets = pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && p.kind === "widget");
  if (widgets.length !== 1) return -1;
  const { p, i } = widgets[0];
  // Yours — installed, or built for you by the Dash team before
  // ("ai-built", found live: an earlier Calendar was planned as new) — or
  // the registry's.
  return (p.source === "yours" ||
    p.source === "ai-built" ||
    p.source === "registry") &&
    !keepsConnection(p) &&
    p.package
    ? i
    : -1;
}

/**
 * A package's widgets among the registered component ids
 * ("trops.clock.FlipClockWidget"): by its bare name ("clock") or scoped
 * ("@trops/clock"), as the Planner named it.
 */
export function packageComponentIds(pkg, ids = []) {
  const raw = String(pkg || "").trim();
  if (!raw) return [];
  const bare = raw.replace(/^@/, "").split("/").pop().toLowerCase();
  const scope = raw.startsWith("@")
    ? raw.slice(1).split("/")[0].toLowerCase()
    : null;
  return [
    ...new Set(
      ids.filter((id) => {
        const parts = String(id || "").split(".");
        if (parts.length < 3) return false;
        return (
          parts[parts.length - 2].toLowerCase() === bare &&
          (!scope || parts[0].toLowerCase() === scope)
        );
      }),
    ),
  ];
}

/** "Digital Clock" names "trops.clock.DigitalClockWidget" (or its display name). */
export function componentNamed(ids, name, displayNameOf = () => "") {
  const squash = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/widget$/, "");
  const want = squash(name);
  if (!want) return null;
  return (
    ids.find((id) => squash(String(id).split(".").pop()) === want) ||
    ids.find((id) => squash(displayNameOf(id)) === want) ||
    null
  );
}

const asText = (v) =>
  v === undefined || v === null
    ? ""
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

/**
 * A widget's own settings for the Settings step: each with its choices
 * (the Planner's value first — its suggestion), or a field to type in.
 * @returns {Array<{ key, label, kind: "choice"|"text", options, value, suggested }>}
 */
export function settingFields(userConfig, planned = {}, chosen = {}) {
  const fields = normalizeUserConfig(userConfig);
  const out = [];
  for (const [key, field] of Object.entries(fields)) {
    if (!field || typeof field !== "object") continue;
    const suggested =
      planned && planned[key] !== undefined
        ? asText(planned[key])
        : asText(field.defaultValue);
    const value =
      chosen && chosen[key] !== undefined ? asText(chosen[key]) : suggested;
    const label = field.displayName || key;
    const options = Array.isArray(field.options)
      ? field.options
          .filter((o) => o && o.value !== undefined)
          .map((o) => ({
            value: asText(o.value),
            label: o.displayName || asText(o.value),
          }))
      : [];
    if (options.length) {
      // The suggestion first.
      const first = options.filter((o) => o.value === suggested);
      const rest = options.filter((o) => o.value !== suggested);
      out.push({
        key,
        label,
        kind: "choice",
        options: [...first, ...rest],
        value,
        suggested,
      });
    } else {
      out.push({ key, label, kind: "text", options: [], value, suggested });
    }
  }
  return out;
}

/** Settings as one line ("Hour Format: 12-hour · Show Date: Yes"). */
export function settingsLine(fields) {
  const shown = (fields || [])
    .map((f) => {
      if (f.kind === "choice") {
        const o = f.options.find((x) => x.value === f.value);
        return `${f.label}: ${o ? o.label : f.value}`;
      }
      return f.value ? `${f.label}: ${f.value}` : null;
    })
    .filter(Boolean);
  return shown.length ? shown.join(" · ") : "As it comes";
}

/** The reuse step after `stage` ("which" → "settings" → "review"). */
export function nextReuseStage(stage) {
  const ids = REUSE_STEPS.map((s) => s.id);
  const i = ids.indexOf(stage);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : "review";
}

const providerList = (providers) =>
  (Array.isArray(providers)
    ? providers
    : Object.values(providers || {})
  ).filter((p) => p && p.name);

/**
 * What a widget the user already has reads from: for each kind of provider
 * it's built for, the user's providers of that kind (and class) — one is
 * used as it is, several are the user's to choose, none is missing. A
 * pin (the user's pick, or the plan's) holds when it's one of them.
 *
 * @param {Array} needs      the widget config's providers ({ type, providerClass, required })
 * @param {Array|object} providers  the user's providers
 * @param {{ [type]: string }} pins
 * @returns {Array<{ type, required, options: string[], selected: string|null }>}
 */
export function readsFromNeeds(needs, providers, pins = {}) {
  const mine = providerList(providers);
  const seen = new Set();
  const out = [];
  for (const p of getUserConfigurableProviders(
    Array.isArray(needs) ? needs : [],
  )) {
    if (!p.type || seen.has(p.type)) continue;
    seen.add(p.type);
    const options = mine
      .filter(
        (x) =>
          x.type === p.type &&
          (!p.providerClass ||
            (x.providerClass || "credential") === p.providerClass),
      )
      .map((x) => x.name)
      .sort((a, b) => a.localeCompare(b));
    const pin = pins && pins[p.type];
    out.push({
      type: p.type,
      providerClass: p.providerClass || null,
      required: p.required !== false,
      options,
      selected:
        (pin && options.includes(pin) && pin) ||
        (options.length === 1 ? options[0] : null),
    });
  }
  return out;
}
