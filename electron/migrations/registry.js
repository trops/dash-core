/**
 * Migration registry — declarative list of every schema migration
 * the app knows how to apply. Add new migrations at the END of the
 * array and bump `CURRENT_SCHEMA_VERSION` at the same time.
 *
 * Format per entry:
 *   { from: "<string>", to: "<string>",
 *     description: "<one-line>", apply: (data) => migratedData }
 *
 * The chain runner walks this list in order, applying any entry
 * whose `from` matches the data's current version, then advancing.
 * Gaps in the chain throw — see `index.js` for the exact behavior.
 */
const v0ToV1 = require("./v0ToV1");

const SETTINGS_MIGRATIONS = [v0ToV1];

/**
 * The version every fresh settings write stamps. Bumped each time a
 * new migration lands. Always equal to the `to` of the last entry
 * above.
 */
const CURRENT_SCHEMA_VERSION = "1";

module.exports = {
  SETTINGS_MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
};
