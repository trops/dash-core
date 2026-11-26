/**
 * answerJson.js — the one way Dash reads the JSON a bot's answer ends with
 * (DASH-101): the whole answer when it's JSON, else its last ```json (or
 * bare ```) block. The handoff, table picks (DASH-84), the work item and
 * workspace (DASH-100) and an answer's shape all read it this way.
 *
 * Pure.
 */
"use strict";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The JSON an answer ends with: the whole answer when it's JSON, else its
 * last ```json (or bare ```) block. Blocks in other languages (```bash) are
 * skipped. `broken`: the last block is there but doesn't parse.
 * @returns {{ found: boolean, value?: any, fenced?: boolean,
 *             broken?: boolean, error?: string }}
 */
function lastJsonBlock(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return { found: false };
  const parse = (t) => {
    try {
      const v = JSON.parse(t);
      return isObj(v) || Array.isArray(v)
        ? { ok: true, v }
        : { ok: false, error: "it isn't a JSON object" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "it isn't JSON" };
    }
  };
  const whole = parse(s);
  if (whole.ok) return { found: true, value: whole.v, fenced: false };
  let last = null;
  for (const m of s.matchAll(/```([A-Za-z0-9_+-]*)([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase();
    if (lang === "json" || lang === "jsonc" || lang === "") last = m[2];
  }
  if (last === null) return { found: false };
  const inBlock = parse(last.trim());
  if (inBlock.ok) return { found: true, value: inBlock.v, fenced: true };
  return { found: false, broken: true, error: inBlock.error };
}

/** The last block as an object, or null (pickFrom, contextFrom). */
function lastJsonObject(text) {
  const j = lastJsonBlock(text);
  return j.found && isObj(j.value) ? j.value : null;
}

module.exports = { lastJsonBlock, lastJsonObject };
