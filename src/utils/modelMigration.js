/**
 * modelMigration.js (renderer mirror)
 *
 * Mirrors the retired-model map + default from the main-process provider
 * registry (electron/llm/modelProviders.js) so the Settings UI can detect a
 * stale saved selection, auto-migrate it, and show a notice — without an IPC
 * round-trip. KEEP IN SYNC with modelProviders.js (anthropic provider).
 */
export const DEFAULT_MODEL = "claude-opus-4-8";

const RETIRED_MODEL_MAP = {
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
  "claude-opus-4-20250514": "claude-opus-4-8",
  "claude-opus-4-1-20250805": "claude-opus-4-8",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-opus-20240229": "claude-opus-4-8",
};

export function isRetiredModel(id) {
  return !!RETIRED_MODEL_MAP[id];
}

export function migrateModelId(id) {
  if (!id) return DEFAULT_MODEL;
  return RETIRED_MODEL_MAP[id] || id;
}
