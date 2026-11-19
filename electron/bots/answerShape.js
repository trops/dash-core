/**
 * answerShape.js
 *
 * The shape of what a bot returned (bot-test-run PRD): its answer as plain
 * text or JSON, with JSON's fields and their kinds, and each result it sent
 * with its items' fields. A test shows it, and a bot's checks are written
 * against it (bot-checks PRD).
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const MAX_ROWS = 40;
const MAX_DEPTH = 3;

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The JSON in an answer: the whole answer, or its one ```json block. */
function parseAnswer(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return { found: false };
  const tryParse = (t) => {
    try {
      const v = JSON.parse(t);
      return isPlainObject(v) || Array.isArray(v)
        ? { found: true, value: v }
        : null;
    } catch (_e) {
      return null;
    }
  };
  const whole = tryParse(s);
  if (whole) return whole;
  const blocks = [...s.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)];
  if (blocks.length === 1) {
    const inBlock = tryParse(blocks[0][1].trim());
    if (inBlock) return { ...inBlock, fenced: true };
  }
  return { found: false };
}

/** A value's kind, as the shape names it. */
function kindOf(v) {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "yes/no";
  if (typeof v === "string")
    return /^https?:\/\/\S+$/i.test(v) ? "link" : "text";
  if (Array.isArray(v)) return "list";
  return "object";
}

/** "24.99 to 39.5", "in every deal", "in 2 of 3". */
function noteFor(values, total, itemWord) {
  const present = values.filter((v) => v !== undefined && v !== null);
  const nums = present.filter((v) => typeof v === "number");
  if (nums.length && nums.length === present.length && nums.length > 1) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (lo !== hi) return `${lo} to ${hi}`;
  }
  if (total > 1) {
    return present.length === total
      ? `in every ${itemWord}`
      : `in ${present.length} of ${total}`;
  }
  return null;
}

/** The singular of a list's name, for notes ("deals" → "deal"). */
function itemWordOf(name) {
  const n = String(name || "");
  if (/ies$/i.test(n)) return n.replace(/ies$/i, "y");
  if (/s$/i.test(n) && !/ss$/i.test(n)) return n.slice(0, -1);
  return "item";
}

/** The kind most of the values have (mixed → the first one seen). */
function commonKind(values) {
  const kinds = values.filter((v) => v !== undefined && v !== null).map(kindOf);
  if (!kinds.length) return "empty";
  return kinds.every((k) => k === kinds[0]) ? kinds[0] : "mixed";
}

/**
 * Every field of a JSON value, as rows the shape panel lists: its path
 * ("deals", "deals[].price"), kind, how many (lists) and a short note.
 */
function fieldRows(value) {
  const rows = [];
  const add = (row) => {
    if (rows.length < MAX_ROWS) rows.push(row);
  };
  const walkObjects = (objects, prefix, depth, itemWord) => {
    const keys = [];
    for (const o of objects) {
      for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
    }
    for (const k of keys) {
      const values = objects.map((o) => o[k]);
      const path = prefix ? `${prefix}.${k}` : k;
      walkValue(values, path, depth, objects.length, itemWord);
    }
  };
  const walkValue = (values, path, depth, total, itemWord) => {
    const kind = commonKind(values);
    const row = { path, kind };
    const note = noteFor(values, total, itemWord);
    if (kind === "list") {
      const lists = values.filter(Array.isArray);
      if (lists.length === 1) row.count = lists[0].length;
      add(note && total > 1 ? { ...row, note } : row);
      const items = lists.flat();
      if (depth < MAX_DEPTH && items.length && items.every(isPlainObject)) {
        const leaf = path.split(".").pop();
        walkObjects(items, `${path}[]`, depth + 1, itemWordOf(leaf));
      }
      return;
    }
    if (kind === "object") {
      add(note && total > 1 ? { ...row, note } : row);
      if (depth < MAX_DEPTH) {
        walkObjects(values.filter(isPlainObject), path, depth + 1, itemWord);
      }
      return;
    }
    add(note ? { ...row, note } : row);
  };
  if (Array.isArray(value)) {
    rows.push({ path: "[]", kind: "list", count: value.length });
    if (value.length && value.every(isPlainObject)) {
      walkObjects(value, "[]", 1, "item");
    }
  } else if (isPlainObject(value)) {
    walkObjects([value], "", 0, "item");
  }
  return rows;
}

/**
 * The shape of an answer.
 * @returns {{ kind: "empty" }
 *   | { kind: "text", lines: number, chars: number }
 *   | { kind: "json", top: "object"|"list", fenced: boolean, fields: object[] }}
 */
function answerShape(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return { kind: "empty" };
  const parsed = parseAnswer(s);
  if (parsed.found) {
    return {
      kind: "json",
      top: Array.isArray(parsed.value) ? "list" : "object",
      fenced: !!parsed.fenced,
      fields: fieldRows(parsed.value),
    };
  }
  return {
    kind: "text",
    lines: s.trim().split(/\n/).length,
    chars: s.trim().length,
  };
}

/**
 * Each result a run sent (send_result), in short: name, label, how many
 * items and the fields its items have.
 */
function resultsShape(results) {
  return (Array.isArray(results) ? results : []).map((r) => {
    const items = Array.isArray(r && r.items) ? r.items : [];
    const fields = [];
    for (const item of items) {
      if (!isPlainObject(item)) continue;
      for (const k of Object.keys(item))
        if (!fields.includes(k)) fields.push(k);
    }
    return {
      name: (r && r.name) || "",
      label: (r && (r.label || r.name)) || "",
      count: items.length,
      fields,
      ...(r && r.summary ? { summary: String(r.summary) } : {}),
    };
  });
}

module.exports = {
  parseAnswer,
  answerShape,
  resultsShape,
  fieldRows,
  MAX_ROWS,
};
