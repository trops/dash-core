/**
 * criteria.js
 *
 * What done means for a goal (flows PRD, phase 6; frames 29–30). Each
 * criterion needs a way to be proven before the goal starts — otherwise it
 * could only be judged at the very end, which is how a loop ends up chasing
 * the wrong goal:
 *
 *   test      a test passes (the Builder writes it: it must fail before the
 *             change and pass after)
 *   check     a check in the flow
 *   reviewer  the Reviewer looks — labelled as judgment
 *   you       you decide at the end
 *   none      nothing yet: the goal can't start
 *
 * Vague criteria ("it should feel fast") are flagged with a measurable
 * rewrite. Criteria are locked once the goal starts.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const PROOFS = ["test", "check", "reviewer", "you", "none"];
const PROOF_LABELS = {
  test: "Test passes",
  check: "A check in the flow",
  reviewer: "Reviewer looks · judgment",
  you: "You decide",
  none: "Nothing yet",
};

// Words that can't be checked as written, unless a number or a named thing
// comes with them.
const VAGUE = [
  {
    re: /\b(fast|quick(ly)?|snappy|speedy|responsive|slow)\b/i,
    rewrite: (t) => `${subjectOf(t)} opens in under 200 ms`,
    proof: "test",
  },
  {
    re: /\b(nice|pretty|beautiful|modern|polished|clean|sleek)\b/i,
    rewrite: (t) =>
      `${subjectOf(t)} matches the approved mockup in light and dark`,
    proof: "reviewer",
  },
  {
    re: /\b(easy|intuitive|simple|user[- ]friendly|obvious)\b/i,
    rewrite: (t) =>
      `${subjectOf(t)} takes at most 2 clicks from where it starts`,
    proof: "test",
  },
  {
    re: /\b(robust|reliable|stable|solid)\b/i,
    rewrite: (t) =>
      `${subjectOf(t)} keeps working after a restart and with no network`,
    proof: "test",
  },
  {
    re: /\b(better|improved?|good|great)\b/i,
    rewrite: (t) => `${subjectOf(t)}: say what changes, and by how much`,
    proof: "none",
  },
  {
    re: /\bworks? like (the )?(old|previous|before)\b/i,
    rewrite: () =>
      "Name what should match the old version, and how it's compared",
    proof: "none",
  },
];
const MEASURABLE =
  /\d|\b(ms|seconds?|minutes?|clicks?|percent|%|equals?|shows?|says?|returns?|lists?|has|have|appears?|named|called|"[^"]+")\b/i;
const LOOKS =
  /\b(looks?|light|dark|screen|layout|design|mockup|theme|screenshot|visual)\b/i;

function subjectOf(text) {
  const t = String(text || "").trim();
  const m =
    /^(the |a |an |it |this )?([\w\s'-]{2,40}?)\s+(should|must|is|are|feels?|looks?|works?|opens?)\b/i.exec(
      t,
    );
  if (m && !/^it$/i.test(m[2].trim()))
    return m[2].trim().replace(/^\w/, (c) => c.toUpperCase());
  return "It";
}

/** Is a criterion too vague to check, and how could it be written instead? */
function vagueness(text) {
  const t = String(text || "").trim();
  if (!t) return { vague: true, why: "It's empty.", rewrite: null };
  for (const v of VAGUE) {
    if (v.re.test(t) && !(MEASURABLE.test(t) && !/\bworks? like\b/i.test(t))) {
      return {
        vague: true,
        why: "Nothing can check this as written. Make it measurable, or judge it yourself at the end.",
        rewrite: v.rewrite(t),
        rewriteProof: v.proof,
      };
    }
  }
  return { vague: false };
}

/** A way to prove a criterion that came without one. */
function guessProof(text, flow) {
  if (vagueness(text).vague) return "none";
  const steps = (flow && flow.steps) || [];
  if (LOOKS.test(text) && steps.some((s) => s.judgment)) return "reviewer";
  const builds = steps.some(
    (s) =>
      s.kind === "bot" &&
      /build|code|develop|implement/i.test(`${s.name} ${s.note || ""}`),
  );
  if (builds) return "test";
  if (steps.some((s) => s.kind === "check")) return "check";
  if (steps.some((s) => s.judgment)) return "reviewer";
  return "you";
}

/** One criterion, cleaned: { id, text, proof, detail }. */
function cleanCriterion(c, i, flow) {
  const raw = typeof c === "string" ? { text: c } : c || {};
  const text = String(raw.text || "")
    .trim()
    .slice(0, 400);
  const proof = PROOFS.includes(raw.proof) ? raw.proof : guessProof(text, flow);
  return {
    id: raw.id ? String(raw.id).slice(0, 20) : `c${i + 1}`,
    text,
    proof,
    detail: String(raw.detail || "").slice(0, 300),
    ...(raw.leftOut ? { leftOut: true } : {}),
  };
}

/**
 * Criteria for a new goal, each with a way to be proven, and whether the
 * goal must wait for the user first (frame 30).
 */
function proveCriteria(list, flow) {
  const criteria = (Array.isArray(list) ? list : [])
    .slice(0, 20)
    .map((c, i) => cleanCriterion(c, i, flow))
    .filter((c) => c.text);
  return {
    criteria,
    waiting: criteria.some((c) => !c.leftOut && c.proof === "none"),
  };
}

/** Can a goal with these criteria start? */
function canStart(criteria) {
  const blocking = (Array.isArray(criteria) ? criteria : []).filter(
    (c) => !c.leftOut && c.proof === "none",
  );
  return {
    ok: blocking.length === 0,
    blocking: blocking.map((c) => c.id),
    reason: blocking.length
      ? `${blocking.length} criterion${blocking.length === 1 ? "" : "s"} can't be checked yet: give ${blocking.length === 1 ? "it" : "each"} a way to be proven, leave ${blocking.length === 1 ? "it" : "them"} out, or decide ${blocking.length === 1 ? "it" : "them"} yourself.`
      : "",
  };
}

module.exports = {
  PROOFS,
  PROOF_LABELS,
  vagueness,
  guessProof,
  cleanCriterion,
  proveCriteria,
  canStart,
};
