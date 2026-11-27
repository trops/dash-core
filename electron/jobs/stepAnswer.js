/**
 * stepAnswer.js — a step's answer, as the job keeps it (DASH-123): the
 * bot's prose (its Markdown, newlines and all) and, apart, the handoff its
 * answer ends with (DASH-101), so the job view shows a message and a
 * card, never the raw JSON.
 *
 * The handoff is found the one way Dash reads it (answerJson): the whole
 * answer when it's JSON, else its last ```json (or bare ```) block.
 *
 * Pure.
 */
"use strict";

const { lastJsonBlock } = require("../bots/answerJson");

const MAX_PROSE = 4000;
// A handoff kept on a step, as JSON. Bigger ones keep shorter strings, then
// only Dash's own keys.
const MAX_HANDOFF = 8000;
const MAX_STRING = 1000;
const OWN_KEYS = [
  "status",
  "item",
  "workspace",
  "question",
  "items",
  "summary",
  "picks",
];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Prose, kept as Markdown: control characters out, blank runs shortened. */
function cleanProse(text, max = MAX_PROSE) {
  const t = String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * An answer split in two: { prose, handoff } — handoff is the JSON object
 * it ends with, or null (no block, a list, or one that doesn't parse: then
 * the prose is the whole answer).
 */
function splitAnswer(text) {
  const s = String(text == null ? "" : text).trim();
  const j = lastJsonBlock(s);
  if (!j.found || !isObj(j.value)) return { prose: s, handoff: null };
  if (!j.fenced) return { prose: "", handoff: j.value };
  // The last json (or bare) block is the one that was read.
  let at = null;
  for (const m of s.matchAll(/```([A-Za-z0-9_+-]*)([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase();
    if (lang === "json" || lang === "jsonc" || lang === "") at = m;
  }
  if (!at) return { prose: s, handoff: j.value };
  const prose = `${s.slice(0, at.index)}${s.slice(at.index + at[0].length)}`;
  return { prose: prose.trim(), handoff: j.value };
}

const size = (v) => {
  try {
    return JSON.stringify(v).length;
  } catch (_e) {
    return Infinity;
  }
};

/** Long strings shortened, all the way down. */
function clipStrings(v, n) {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clipStrings(x, n));
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clipStrings(x, n);
    return out;
  }
  return v;
}

/**
 * A handoff small enough to keep on a step: as given; else with long
 * strings shortened; else only Dash's own keys (`clipped: true` says so).
 */
function keepHandoff(value) {
  if (!isObj(value)) return null;
  if (size(value) <= MAX_HANDOFF) return value;
  const short = clipStrings(value, MAX_STRING);
  if (size(short) <= MAX_HANDOFF) return short;
  const own = {};
  for (const k of OWN_KEYS) if (k in value) own[k] = value[k];
  const kept = { ...clipStrings(own, 300), clipped: true };
  return size(kept) <= MAX_HANDOFF ? kept : { clipped: true };
}

/** A finished answer, as a step keeps it: { summary, handoff }. */
function stepAnswer(output) {
  const { prose, handoff } = splitAnswer(output);
  return { summary: cleanProse(prose), handoff: keepHandoff(handoff) };
}

module.exports = { splitAnswer, cleanProse, keepHandoff, stepAnswer };
