/**
 * rules.js — a check made of ready-made rules (flows PRD, phase 2; frame
 * 13). Each rule passes or fails on its own; the check passes when every
 * ticked rule does. Rules only compare the step's input — the one that
 * reaches out, "All links work", only asks each link for its status.
 *
 * Pure apart from the injected `fetchStatus` (links).
 */
"use strict";

const { valueAt } = require("../stepInput");

const MAX_LINKS = 100;

/** The rules a check can tick, with what the setup screen says. */
const RULE_TYPES = {
  required: {
    label: "Has a value",
    help: (r) => `${r.field || "A field"} is filled in`,
  },
  words: {
    label: "Length",
    help: (r) => `Between ${r.min || 0} and ${r.max || "any number of"} words`,
  },
  maxLength: {
    label: "Short enough",
    help: (r) => `Under ${r.max || 0} characters`,
  },
  banned: {
    label: "No banned words",
    help: (r) => {
      const n = Array.isArray(r.words) ? r.words.length : 0;
      return `From your list: ${n} word${n === 1 ? "" : "s"}`;
    },
  },
  linksWork: {
    label: "All links work",
    help: () => "Every link answers, no 404s",
  },
  everyIncluded: {
    label: "Every item is used",
    help: (r) => `Each of ${r.list || "the list"} appears in ${r.in || "it"}`,
  },
  equals: {
    label: "Matches",
    help: (r) =>
      `${r.field || "A field"} equals ${r.ref ? r.ref : JSON.stringify(r.value)}`,
  },
  sumEquals: {
    label: "Totals add up",
    help: (r) =>
      `${(r.fields || []).join(" + ") || "The parts"} = ${r.total || "the total"}, to the cent`,
  },
  noDuplicates: {
    label: "Nothing used twice",
    help: (r) =>
      `No ${r.key || "item"} appears twice in ${r.field || "the list"}`,
  },
};

const words = (s) =>
  String(s || "")
    .split(/\s+/)
    .filter(Boolean).length;

const asText = (v) =>
  v == null
    ? ""
    : typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map(asText).join("\n")
        : typeof v === "object"
          ? Object.values(v).map(asText).join("\n")
          : String(v);

const cents = (n) => Math.round(Number(n) * 100);

const sum = (v) => {
  if (Array.isArray(v)) {
    return v.reduce(
      (a, x) => a + cents(x && typeof x === "object" ? x.amount : x),
      0,
    );
  }
  return cents(v);
};

const LINK = /https?:\/\/[^\s)"'<>\]]+/gi;

function linksIn(v) {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
    return v.filter((x) => /^https?:\/\//i.test(x));
  }
  return [...new Set(asText(v).match(LINK) || [])];
}

/** One rule's result: { pass, reason, details? }. */
async function runRule(rule, input, { fetchStatus } = {}) {
  const r = rule || {};
  const v = valueAt(input, r.field);
  switch (r.type) {
    case "required": {
      const ok =
        v !== undefined &&
        v !== null &&
        !(typeof v === "string" && !v.trim()) &&
        !(Array.isArray(v) && !v.length);
      return {
        pass: ok,
        reason: ok ? `${r.field} is filled in` : `${r.field} is empty`,
      };
    }
    case "words": {
      const n = words(asText(v));
      const min = Number(r.min) || 0;
      const max = Number(r.max) || Infinity;
      const ok = n >= min && n <= max;
      return {
        pass: ok,
        reason: ok
          ? `${n} words`
          : `${n} words: needs ${min}${max === Infinity ? " or more" : `–${max}`}`,
      };
    }
    case "maxLength": {
      const n = asText(v).length;
      const ok = n > 0 && n < (Number(r.max) || 0);
      return {
        pass: ok,
        reason: ok
          ? `${n} characters`
          : n
            ? `${n} characters: over ${r.max}`
            : `${r.field} is empty`,
      };
    }
    case "banned": {
      const list = (Array.isArray(r.words) ? r.words : [])
        .map((w) => String(w).trim().toLowerCase())
        .filter(Boolean);
      const t = asText(v).toLowerCase();
      const found = list.filter((w) =>
        new RegExp(
          `(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
        ).test(t),
      );
      return {
        pass: !found.length,
        reason: found.length
          ? `Banned words: ${found.join(", ")}`
          : "No banned words",
        ...(found.length ? { details: found } : {}),
      };
    }
    case "linksWork": {
      const links = linksIn(v).slice(0, MAX_LINKS);
      if (!fetchStatus)
        return { pass: false, reason: "Links can't be checked here" };
      const broken = [];
      await Promise.all(
        links.map(async (url) => {
          let status = 0;
          try {
            status = await fetchStatus(url);
          } catch (_e) {
            status = 0;
          }
          if (!(status >= 200 && status < 400)) broken.push({ url, status });
        }),
      );
      return {
        pass: !broken.length,
        reason: broken.length
          ? `${broken.length} link${broken.length === 1 ? " is" : "s are"} broken: ${broken
              .slice(0, 3)
              .map(
                (b) =>
                  `${b.url.replace(/^https?:\/\//, "")} (${b.status || "no answer"})`,
              )
              .join(", ")}`
          : `${links.length} link${links.length === 1 ? "" : "s"} checked`,
        ...(broken.length ? { details: broken } : {}),
      };
    }
    case "everyIncluded": {
      const list = valueAt(input, r.list);
      const items = Array.isArray(list) ? list : [];
      const hay = valueAt(input, r.in);
      const hayText = asText(hay);
      const hayIds = new Set(
        (Array.isArray(hay) ? hay : []).map((x) =>
          String(x && typeof x === "object" && r.key ? x[r.key] : x),
        ),
      );
      const missing = items
        .map((it) =>
          String(it && typeof it === "object" && r.key ? it[r.key] : it),
        )
        .filter((k) => k && !hayIds.has(k) && !hayText.includes(k));
      return {
        pass: !missing.length,
        reason: missing.length
          ? `${missing.length} of ${items.length} not used`
          : `All ${items.length} used`,
        ...(missing.length ? { details: missing } : {}),
      };
    }
    case "equals": {
      const want = r.ref ? valueAt(input, r.ref) : r.value;
      const ok = JSON.stringify(v) === JSON.stringify(want);
      return {
        pass: ok,
        reason: ok
          ? `${r.field} = ${JSON.stringify(v)}`
          : `${r.field} is ${JSON.stringify(v)}, not ${JSON.stringify(want)}`,
      };
    }
    case "sumEquals": {
      const parts = (Array.isArray(r.fields) ? r.fields : []).map((f) =>
        sum(valueAt(input, f)),
      );
      const got = parts.reduce((a, b) => a + b, 0);
      const want = sum(valueAt(input, r.total));
      const ok = got === want;
      return {
        pass: ok,
        reason: ok
          ? `Adds up: ${(got / 100).toFixed(2)}`
          : `Off by ${((want - got) / 100).toFixed(2)}: ${(got / 100).toFixed(2)} vs ${(want / 100).toFixed(2)}`,
      };
    }
    case "noDuplicates": {
      const list = Array.isArray(v) ? v : [];
      const seen = new Set();
      const dup = [];
      for (const it of list) {
        const k = JSON.stringify(
          it && typeof it === "object" && r.key ? it[r.key] : it,
        );
        if (seen.has(k)) dup.push(JSON.parse(k));
        seen.add(k);
      }
      return {
        pass: !dup.length,
        reason: dup.length
          ? `Used twice: ${dup.slice(0, 3).join(", ")}`
          : "Nothing used twice",
        ...(dup.length ? { details: dup } : {}),
      };
    }
    default:
      return { pass: false, reason: `Unknown rule '${r.type}'` };
  }
}

/**
 * Run a rules check.
 * @param {{ rules: object[] }} check
 * @returns {Promise<{ pass, reason, details }>}
 */
async function runRules(check, input, deps = {}) {
  const rules = (check && Array.isArray(check.rules) ? check.rules : []).filter(
    (r) => r && r.on !== false,
  );
  if (!rules.length)
    return { pass: false, reason: "No rules are ticked", details: [] };
  const results = [];
  for (const rule of rules) {
    const res = await runRule(rule, input, deps);
    results.push({
      rule: (RULE_TYPES[rule.type] && RULE_TYPES[rule.type].label) || rule.type,
      ...res,
    });
  }
  const failed = results.filter((x) => !x.pass);
  return {
    pass: !failed.length,
    reason: failed.length
      ? `${results.length - failed.length} of ${results.length} passed. ${failed
          .map((f) => f.reason)
          .join(". ")}.`
      : `All ${results.length} passed.`,
    details: results,
  };
}

module.exports = { RULE_TYPES, runRule, runRules, linksIn };
