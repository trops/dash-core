/**
 * resultsDigest.js — what the Planner reads to answer questions about the
 * user's bots (create-entry PRD CRE-011 AC6, phase 5e): the latest result
 * each bot sent and the latest runs, as plain text, clipped.
 *
 * Pure (NFR-006): botController gathers the results and runs and passes them
 * in, leaving out the Dash team's own bots (dashTeam.isDashTeam) — their runs
 * are the user's plan conversations, not findings.
 */
"use strict";

const ITEM_CHARS = 300;
const MAX_ITEMS = 10;
const ANSWER_CHARS = 1500;
const MAX_RUNS = 25;
const TOTAL_CHARS = 16000;

/**
 * A stored time (UTC ISO) in the user's local time — read as UTC, "8:00Z"
 * becomes the wrong hour of the user's day.
 */
function localTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The first line of each digest: now, in the user's local time. */
function nowLine(now = new Date()) {
  return `Now: ${localTime(now.toISOString(), now)} (the user's local time; all times below are local).`;
}

const clip = (text, n) => {
  const s = String(text == null ? "" : text).trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function itemText(item) {
  if (item == null) return "";
  if (typeof item !== "object") return clip(item, ITEM_CHARS);
  // A one-line item reads better than JSON when it has a title-ish field.
  const head = item.title || item.name || item.subject || item.text;
  const rest = Object.entries(item)
    .filter(([k, v]) => v !== head && v != null && typeof v !== "object")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return clip(head ? `${head}${rest ? ` — ${rest}` : ""}` : rest, ITEM_CHARS);
}

function capTotal(lines, note) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > TOTAL_CHARS) {
      out.push(note);
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/**
 * The latest results, one block per bot result.
 * @param {{ botName, dashboard, name, label, summary, items, sentAt }[]} results
 */
function describeResults(results, now = new Date()) {
  const list = (results || []).filter(Boolean);
  if (!list.length) {
    return "No bot has sent results yet. Only the latest result for each name is kept.";
  }
  const sorted = [...list].sort(
    (a, b) => (Date.parse(b.sentAt) || 0) - (Date.parse(a.sentAt) || 0),
  );
  const lines = [nowLine(now), "Only the latest result for each name is kept."];
  for (const r of sorted) {
    const items = Array.isArray(r.items) ? r.items : [];
    lines.push(
      `- ${r.botName} · ${r.label || r.name}${
        r.dashboard ? ` (dashboard ${r.dashboard})` : ""
      } — sent ${localTime(r.sentAt, now) || "at an unknown time"}, ${items.length} item${
        items.length === 1 ? "" : "s"
      }${r.summary ? `. Summary: ${clip(r.summary, ITEM_CHARS)}` : ""}`,
    );
    for (const item of items.slice(0, MAX_ITEMS)) {
      lines.push(`    • ${itemText(item)}`);
    }
    if (items.length > MAX_ITEMS) {
      lines.push(`    • …and ${items.length - MAX_ITEMS} more`);
    }
  }
  return capTotal(lines, "(More results left out — ask about one bot.)");
}

/**
 * Pick runs: by bot name (contains, any case) and/or the last `sinceHours`.
 * @param {{ botName, dashboard, run }[]} runs  newest first
 */
function filterRuns(runs, { bot, sinceHours, now = Date.now() } = {}) {
  const want = String(bot || "")
    .trim()
    .toLowerCase();
  const hours = Number(sinceHours);
  const after = hours > 0 ? now - hours * 3600 * 1000 : null;
  return (runs || [])
    .filter((r) => r && r.run)
    .filter((r) => !want || String(r.botName).toLowerCase().includes(want))
    .filter((r) => {
      if (after === null) return true;
      const t = Date.parse(r.run.endedAt || r.run.at || r.run.startedAt);
      return !Number.isNaN(t) && t >= after;
    })
    .slice(0, MAX_RUNS);
}

/** Runs as text, newest first. */
function describeRuns(runs, now = new Date()) {
  const list = (runs || []).filter((r) => r && r.run);
  if (!list.length) return `${nowLine(now)}\nNo bot runs match.`;
  const lines = [nowLine(now)];
  for (const { botName, dashboard, run } of list) {
    const when =
      localTime(run.endedAt || run.at || run.startedAt, now) || "unknown time";
    const head = `- ${botName}${dashboard ? ` (dashboard ${dashboard})` : ""} · ${when} · ${
      run.status || "unknown"
    }${run.trigger ? ` · ${run.trigger}` : ""}`;
    const body = run.error
      ? `    Error: ${clip(run.error, ITEM_CHARS)}`
      : run.output
        ? `    ${clip(run.output, ANSWER_CHARS).replace(/\n/g, "\n    ")}`
        : "    (no answer)";
    lines.push(`${head}\n${body}`);
  }
  return capTotal(lines, "(Older runs left out — narrow by bot or time.)");
}

module.exports = {
  localTime,
  itemText,
  describeResults,
  filterRuns,
  describeRuns,
  MAX_RUNS,
  TOTAL_CHARS,
};
