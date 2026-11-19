/**
 * testResultText.js — what a test of a bot shows, in words (bot-test-run
 * PRD): its answer's shape, the fields it found, how long it took, and the
 * results it would have sent. Pure.
 */
import { toolWords } from "./alwaysAllow";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "JSON", "Text · 3 lines · 212 characters", "No answer". */
export function shapeTag(shape) {
  if (!shape || shape.kind === "empty") return "No answer";
  if (shape.kind === "text") {
    return `Text · ${plural(shape.lines, "line")} · ${plural(
      shape.chars,
      "character",
    )}`;
  }
  return "JSON";
}

/**
 * The shape panel's rows: each field's name (its last part), how deep it
 * sits, its kind and a note ("a list of 3", "24.99 to 39.5").
 */
export function shapeRows(shape) {
  const fields = (shape && shape.kind === "json" && shape.fields) || [];
  return fields.map((f) => {
    const parts = String(f.path || "")
      .split(/\.|\[\]/)
      .filter(Boolean);
    const name = parts.length ? parts[parts.length - 1] : "(the list)";
    const count =
      f.kind === "list" && typeof f.count === "number"
        ? `a list of ${f.count}`
        : null;
    return {
      key: f.path,
      name,
      // "deals" 0, "deals[].title" 1, "deals[].tags[].name" 2.
      depth: (String(f.path).match(/\./g) || []).length,
      kind: f.kind,
      note: [count, f.note].filter(Boolean).join(" · ") || null,
    };
  });
}

/** "14s", "1m 5s" between two times. */
export function tookText(startedAt, endedAt) {
  const ms = Date.parse(endedAt || "") - Date.parse(startedAt || "");
  if (!(ms >= 0)) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "14s · 2 tool calls" — the line under "What it returned". */
export function ranText(result) {
  const r = result || {};
  const calls = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
  return [
    tookText(r.startedAt, r.endedAt),
    calls ? plural(calls, "tool call") : "no tools",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a running test is doing now, from its latest event. */
export function activityText(event) {
  if (!event || !event.type) return null;
  if (event.type === "tool_call" && event.name) {
    const name = String(event.name).replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
    return `Using ${toolWords(name)}`;
  }
  if (event.type === "retrying") return event.message || "Trying again";
  if (event.type === "text") return "Writing its answer";
  return null;
}

/**
 * The answer to show: pretty JSON when it's JSON, else the text as it is.
 * `raw` shows it as the bot wrote it.
 */
export function answerToShow(answer, shape, { raw = false } = {}) {
  const text = String(answer || "");
  if (raw || !shape || shape.kind !== "json") return text;
  const tryParse = (t) => {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch (_e) {
      return null;
    }
  };
  const whole = tryParse(text.trim());
  if (whole) return whole;
  const block = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/);
  return (block && tryParse(block[1].trim())) || text;
}

/** "3 items" — a result's count in words. */
export function itemsText(n) {
  return plural(n, "item");
}

/** The note under the result: what a test does and doesn't do. */
export function testedNote({ name, sampleKept, isCreating }) {
  const what =
    "A test run: nothing was handed on, no widget was sent anything, and no checks ran.";
  if (sampleKept) {
    return `${what} This answer is kept as ${name ? `${name}'s` : "its"} sample, for writing its checks.`;
  }
  // A new bot, or a saved one with unsaved changes: kept with the form.
  return `${what} This answer is kept as its sample when you ${
    isCreating ? "create" : "save"
  } it, for writing its checks.`;
}
