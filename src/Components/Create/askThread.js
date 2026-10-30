/**
 * askThread.js — the words around a question to the Planner (create-entry
 * PRD CRE-007 AC4 / CRE-011 AC6, phase 5e). Pure.
 */

/** The first message: the question, marked as one so it gets no plan. */
export function questionRequest(text) {
  return `(A question from the Ask box — answer it; write a plan only if I ask you to make or change something.)\n${String(
    text || "",
  ).trim()}`;
}

/**
 * A question to a Dash team role other than the Planner (the Builder,
 * Scout, Checker): it answers, and says a plan is how things get made —
 * from a chat it has no tools that build or change anything.
 */
export function roleQuestion(text) {
  return `(A question from the Dash team chat — answer it. You can't build, install or place anything from here; if I ask for that, say the Planner can plan it and I approve the plan.)\n${String(
    text || "",
  ).trim()}`;
}

/** A question to a team lead (5e-2a): the lead gets the words as typed. */
export function leadQuestion(text) {
  return String(text || "").trim();
}

/**
 * A reopened conversation's next question: the Planner's (or lead's) own
 * session has moved on, so it gets the conversation so far (the last few
 * turns). `wrap` words the new question (questionRequest for the Planner,
 * leadQuestion for a lead).
 * @param {{ who: string, text: string }[]} messages
 */
export function reopenedQuestion(
  messages,
  text,
  keep = 6,
  wrap = questionRequest,
) {
  const turns = (messages || [])
    .filter(
      (m) =>
        m &&
        (m.who === "you" ||
          m.who === "planner" ||
          m.who === "lead" ||
          m.who === "role") &&
        m.text,
    )
    .slice(-keep)
    .map((m) => `${m.who === "you" ? "Me" : "You"}: ${m.text}`);
  const now = wrap(text);
  return turns.length
    ? `Earlier in this conversation:\n${turns.join("\n")}\n\n${now}`
    : now;
}

/**
 * Whether an answer's plan is worth opening: it plans something, or it asks
 * the questions that come before a plan (they're answered in Create).
 */
export function hasPlan(plan) {
  const some = (list) => Array.isArray(list) && list.length > 0;
  return !!(plan && (some(plan.pieces) || some(plan.questions)));
}

/**
 * The Dash team chat hands a plan to Create as soon as an answer has one:
 * the conversation so far comes along, and nothing is asked again — the
 * answer's questions show as taps, and Build is there.
 * @param {{ who: string, text: string, meta?: string }[]} messages
 */
export function handoverSeed(messages, plan) {
  const kept = (messages || [])
    .filter(
      (m) =>
        m &&
        (m.who === "you" || m.who === "planner" || m.who === "note") &&
        m.text,
    )
    .map((m) => ({
      who: m.who,
      text: m.text,
      ...(m.meta ? { meta: m.meta } : {}),
    }));
  const first = kept.find((m) => m.who === "you");
  return {
    plan,
    label: first ? String(first.text).trim() : "From the Dash team chat",
    messages: kept,
  };
}

/**
 * The turns a handed-over conversation carries to the Planner's next
 * question in Create (its own session there starts fresh).
 */
export function earlierTurns(messages, keep = 6) {
  const turns = (messages || [])
    .filter((m) => m && (m.who === "you" || m.who === "planner") && m.text)
    .slice(-keep)
    .map((m) => `${m.who === "you" ? "Me" : "You"}: ${m.text}`);
  return turns.length
    ? `Earlier in this conversation:\n${turns.join("\n")}`
    : "";
}

/** The Planner's words without its <plan> block. */
export function withoutPlan(text) {
  return String(text || "")
    .replace(/<plan>[\s\S]*?<\/plan>/gi, "")
    .trim();
}
