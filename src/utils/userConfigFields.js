/**
 * A widget's settings as an object keyed by setting name — the documented
 * userConfig shape ({ title: { type, displayName, … } }). Some widgets list
 * them instead ([{ key | name | id, label, … }]); those become the same
 * object, their label read as displayName. Entries without a key are
 * dropped (nothing can set them). Same reading as electron/bots/configDiff.js.
 */
export function normalizeUserConfig(userConfig) {
  if (!Array.isArray(userConfig)) {
    return userConfig && typeof userConfig === "object" ? userConfig : {};
  }
  const out = {};
  for (const item of userConfig) {
    if (!item || typeof item !== "object") continue;
    const key = item.key || item.name || item.id;
    if (!key) continue;
    const { key: _key, label, ...field } = item;
    out[key] = { ...field, displayName: item.displayName || label || key };
  }
  return out;
}
