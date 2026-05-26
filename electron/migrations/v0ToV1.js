/**
 * v0ToV1 — bootstrap migration for the settings file.
 *
 * Phase 2C of the MVP launch audit shipped the migration framework
 * before any actual schema changes were needed. This migration is
 * intentionally a no-op on the user's data: it only stamps the
 * `schemaVersion` field so subsequent loads can find the chain
 * starting point.
 *
 * When the first real settings migration lands (v1 → v2), this file
 * stays as-is — the chain extends rather than replaces.
 */
function apply(settings) {
  const out = { ...(settings || {}) };
  return out;
}

module.exports = {
  from: "0",
  to: "1",
  description: "Bootstrap: stamp schemaVersion on the settings file.",
  apply,
};
