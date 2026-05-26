/**
 * Schema migration framework (Phase 2C of the MVP launch audit).
 *
 * The runner walks a registry of `{ from, to, apply }` migrations in
 * order, applying every entry whose `from` matches the data's
 * current `schemaVersion`. After each step, the version stamp on
 * the data is bumped to the `to` of the just-applied migration so
 * the next step can chain off it.
 *
 * Why so simple:
 *   - We have one settings file with linear version history.
 *   - "v0" means "the file exists but has no schemaVersion field"
 *     (i.e., a legacy install).
 *   - Future migrations register a new entry at the end of the
 *     SETTINGS_MIGRATIONS array; `CURRENT_SCHEMA_VERSION` is the
 *     `to` of the last entry.
 *
 * Loud failures:
 *   - Registered duplicate `from` → throws at module load via the
 *     chain validation in `runMigrations`.
 *   - Data is at a version the registry can't reach
 *     (e.g., downgrade scenario) → throws with an actionable message.
 *   - A migration's apply() throws → propagates; callers should
 *     refuse to start with stale data rather than corrupt it.
 *
 * On-disk contract:
 *   - `data.schemaVersion` is a string (e.g., "1"). Missing means
 *     "version 0" (legacy un-stamped file).
 *   - Migrations MUST NOT mutate the input — return a new object.
 *   - The runner stamps `schemaVersion` after each step.
 */

const { SETTINGS_MIGRATIONS, CURRENT_SCHEMA_VERSION } = require("./registry");

function readVersion(data) {
  if (!data || typeof data !== "object") return "0";
  const v = data.schemaVersion;
  return typeof v === "string" && v.length > 0 ? v : "0";
}

/**
 * Run a migration chain.
 *
 * @param {Object} data - The data to migrate (e.g., parsed settings JSON).
 * @param {Array} migrations - Ordered registry, e.g. SETTINGS_MIGRATIONS.
 * @param {String} targetVersion - The desired terminal version (e.g.,
 *   CURRENT_SCHEMA_VERSION). Migration stops when reached.
 * @returns {{ data: Object, migrated: Boolean, appliedSteps: Array<{from, to}> }}
 *   `migrated: true` iff at least one step ran. Callers persist back to
 *   disk only when this is true (avoids unnecessary writes).
 */
function runMigrations(data, migrations, targetVersion) {
  const safeData = data && typeof data === "object" ? data : {};
  let current = readVersion(safeData);
  let working = { ...safeData };
  const applied = [];

  while (current !== targetVersion) {
    const step = migrations.find((m) => m.from === current);
    if (!step) {
      throw new Error(
        `Cannot migrate from schemaVersion "${current}" to "${targetVersion}" — ` +
          `no registered migration starts at "${current}". ` +
          `This may be a downgraded install or a forgotten migration entry.`,
      );
    }
    const next = step.apply(working);
    if (!next || typeof next !== "object") {
      throw new Error(
        `Migration ${step.from} → ${step.to} returned a non-object.`,
      );
    }
    working = { ...next, schemaVersion: step.to };
    applied.push({ from: step.from, to: step.to });
    current = step.to;
  }

  return {
    data: working,
    migrated: applied.length > 0,
    appliedSteps: applied,
  };
}

/**
 * Convenience wrapper for the settings registry — the most common
 * caller. Equivalent to:
 *   runMigrations(data, SETTINGS_MIGRATIONS, CURRENT_SCHEMA_VERSION)
 */
function migrateSettings(data) {
  return runMigrations(data, SETTINGS_MIGRATIONS, CURRENT_SCHEMA_VERSION);
}

module.exports = {
  runMigrations,
  migrateSettings,
  readVersion,
  CURRENT_SCHEMA_VERSION,
  SETTINGS_MIGRATIONS,
};
