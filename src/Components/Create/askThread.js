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
 * A reopened conversation's next question: the Planner's own session has
 * moved on, so it gets the conversation so far (the last few turns).
 * @param {{ who: string, text: string }[]} messages
 */
export function reopenedQuestion(messages, text, keep = 6) {
  const turns = (messages || [])
    .filter((m) => m && (m.who === "you" || m.who === "planner") && m.text)
    .slice(-keep)
    .map((m) => `${m.who === "you" ? "Me" : "You"}: ${m.text}`);
  const now = questionRequest(text);
  return turns.length
    ? `Earlier in this conversation:\n${turns.join("\n")}\n\n${now}`
    : now;
}

/** Whether an answer's plan is worth opening (it plans something). */
export function hasPlan(plan) {
  return !!(plan && Array.isArray(plan.pieces) && plan.pieces.length);
}

/**
 * Open as a plan: Create starts from the plan the answer suggested, and the
 * Planner is asked to carry on with it (the seed CreatePlanStep takes, 5b).
 */
export function planSeed(question, plan) {
  const asked = String(question || "").trim();
  return {
    plan,
    label: asked ? `From a question: ${asked}` : "From a question",
    request: `I asked: "${asked}". You suggested the plan below. Keep it, change it only where I ask, and ask me anything you need before building.\n<plan>${JSON.stringify(
      plan,
    )}</plan>`,
  };
}
