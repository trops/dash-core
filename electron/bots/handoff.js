"use strict";

/**
 * handoff.js — a team lead hands "make something" to the Dash team
 * (consolidation Phase 2c-2). The lead can't make or change bots, widgets or
 * layouts; when asked to, its answer ends with
 *   <handoff>{"type": "bot" | "widget" | "layout", "request": string,
 *             "note": string}</handoff>
 * Dash reads it (a "Plan this with the Dash team" button that opens Create
 * with the request, that dashboard and the note) and never shows it.
 * Keep src/utils/handoff.js the same (handoff.test.js checks).
 */

const TYPES = ["bot", "widget", "layout"];
const MAX_REQUEST = 2000;
const MAX_NOTE = 600;

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The hand-off in a lead's answer: { type, request, note }, or null. */
function extractHandoff(answer) {
  const m = /<handoff>([\s\S]*?)<\/handoff>/i.exec(String(answer || ""));
  if (!m) return null;
  let raw;
  try {
    raw = JSON.parse(m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch (_e) {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const request = text(raw.request, MAX_REQUEST);
  if (!request) return null;
  return {
    type: TYPES.includes(raw.type) ? raw.type : "auto",
    request,
    note: text(raw.note, MAX_NOTE),
  };
}

/** The answer without its hand-off — a half-streamed one included. */
function withoutHandoff(answer) {
  return (
    String(answer || "")
      .replace(/<handoff>[\s\S]*?<\/handoff>/gi, "")
      .replace(/<handoff>[\s\S]*$/i, "")
      // …and the start of its tag, mid-stream ("<hand").
      .replace(/<(h(a(n(d(o(ff?)?)?)?)?)?)?$/i, "")
      .trim()
  );
}

/**
 * Which Create a hand-off opens: a bot → Create › Bot; a widget or layout →
 * a plan that changes that dashboard.
 */
function createType(type) {
  if (type === "bot") return "bot";
  if (type === "widget" || type === "layout") return "dashboard";
  return "auto";
}

module.exports = { extractHandoff, withoutHandoff, createType };
