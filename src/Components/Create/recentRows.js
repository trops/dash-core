/**
 * recentRows.js — what Create's Recent shows (create-entry PRD CRE-007 AC2,
 * phase 4e-1): plan conversations (with their build's live status),
 * questions to the Planner (5e) and Widget Builder drafts, newest first.
 */
import { formatTokens } from "../../utils/runCostLabel";
import { providerLabel } from "./planChecklist";
import { draftAge } from "./createRouting";

/** How many rows the start screen shows. */
export const RECENT_ROWS = 6;

const and = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0] || "";

/**
 * A plan's status in words: "Draft plan" · "Building 3/7 · 21k tokens" ·
 * "Built" · "Built, with problems" · "Waiting for Gmail" · "Stopped" ·
 * "Interrupted" · "Removed".
 */
export function recentStatus(summary) {
  const s = summary || {};
  if (s.kind === "question") {
    const word = s.status === "answered" ? "Answered" : "Asked";
    return s.to ? `${word} · ${s.to}` : word;
  }
  switch (s.status) {
    case "building": {
      const p = s.progress || { done: 0, total: 0 };
      return `Building ${p.done}/${p.total}${
        s.tokens ? ` · ${formatTokens(s.tokens)} tokens` : ""
      }`;
    }
    case "built":
      return "Built";
    case "problems":
      return "Built, with problems";
    case "waiting":
      return `Waiting for ${and((s.waitingFor || []).map(providerLabel))}`;
    case "stopped":
      return "Stopped";
    case "interrupted":
      return "Interrupted";
    case "removed":
      return "Removed";
    default:
      return "Draft plan";
  }
}

const ms = (t) => (typeof t === "number" ? t : Date.parse(t) || 0);

/**
 * Recent's rows, newest first: { key, kind: "plan"|"question"|"widget-draft", id,
 * title, status, updatedAt (ms) }.
 */
export function recentRows(plans = [], drafts = [], limit = RECENT_ROWS) {
  const rows = [
    ...(plans || []).map((p) => ({
      key: `plan:${p.id}`,
      kind: p.kind === "question" ? "question" : "plan",
      id: p.id,
      title: p.title || (p.kind === "question" ? "Question" : "Untitled plan"),
      status: recentStatus(p),
      updatedAt: ms(p.updatedAt),
    })),
    ...(drafts || []).map((d) => ({
      key: `draft:${d.id}`,
      kind: "widget-draft",
      id: d.id,
      title: d.name || "Untitled draft",
      status: "Widget draft",
      updatedAt: ms(d.updatedAt),
    })),
  ];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/**
 * The Dash team's conversations (consolidation Phase 4a): the questions in
 * Recent, newest first — { id, title, sub, to, updatedAt }; `to` names the
 * lead a question went to (null = the Dash team).
 */
export function questionThreads(plans = [], now = Date.now()) {
  return (plans || [])
    .filter((p) => p && p.kind === "question" && p.id)
    .map((p) => ({
      id: p.id,
      title: p.title || "Question",
      to: p.to || null,
      updatedAt: ms(p.updatedAt),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => ({
      ...t,
      sub: [draftAge(t.updatedAt, now), t.to ? `asked ${t.to}` : null]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** "Ask Test · Building 3/7 · 21k tokens · 5m ago" */
export function recentLine(row, now = Date.now()) {
  return `${row.title} · ${row.status} · ${draftAge(row.updatedAt, now)}`;
}
