/**
 * A widget's settings as an object keyed by setting name — the documented
 * userConfig shape ({ title: { type, displayName, … } }). Some widgets list
 * them instead ([{ key | name | id, label, … }]); those become the same
 * object, their label read as displayName. Entries without a key are
 * dropped (nothing can set them). Same reading as electron/bots/configDiff.js.
 *
 * Either shape, a field written with `label` (no displayName) gets it as its
 * displayName, and select options written as strings or { value, label }
 * become { value, displayName } — what the settings forms show (QA
 * 2026-10-22: blank labels and blank options in the Create preview). An
 * object that needs none of this is returned as it is.
 */
export function normalizeUserConfig(userConfig) {
  if (!Array.isArray(userConfig)) {
    if (!userConfig || typeof userConfig !== "object") return {};
    let changed = false;
    const out = {};
    for (const [key, field] of Object.entries(userConfig)) {
      const next = normalizeField(field);
      if (next !== field) changed = true;
      out[key] = next;
    }
    return changed ? out : userConfig;
  }
  const out = {};
  for (const item of userConfig) {
    if (!item || typeof item !== "object") continue;
    const key = item.key || item.name || item.id;
    if (!key) continue;
    const { key: _key, label, ...field } = item;
    out[key] = normalizeField({
      ...field,
      displayName: item.displayName || label || key,
    });
  }
  return out;
}

/** A select's options as [{ value, displayName }]. */
export function normalizeOptions(options) {
  if (!Array.isArray(options)) return options;
  let changed = false;
  const out = options.map((option) => {
    if (option == null || typeof option !== "object") {
      changed = true;
      return { value: option, displayName: String(option ?? "") };
    }
    if (option.displayName != null) return option;
    changed = true;
    const text = option.label ?? option.name ?? option.value;
    return { ...option, displayName: text == null ? "" : String(text) };
  });
  return changed ? out : options;
}

function normalizeField(field) {
  if (!field || typeof field !== "object") return field;
  let next = field;
  if (!next.displayName && next.label) {
    next = { ...next, displayName: next.label };
  }
  const options = normalizeOptions(next.options);
  if (options !== next.options) next = { ...next, options };
  return next;
}
