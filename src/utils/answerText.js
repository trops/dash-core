/**
 * answerText.js — joins a bot's streamed answer text. Pieces of one stretch
 * of text join as-is; text written after a tool call starts a new paragraph
 * so "…you prefer." + "Done" doesn't read "prefer.Done". Pure.
 *
 * Mirrors electron/bots/answerText.js (the renderer can't load that CommonJS
 * file, and `node --test` can't load this ES module) — keep them in step.
 */

export const ANSWER_BREAK = "\n\n";

export function appendAnswerText(text, chunk, { afterTool = false } = {}) {
  const prev = text || "";
  const next = chunk || "";
  if (!next) return prev;
  if (afterTool && prev && !/\s$/.test(prev) && !/^\s/.test(next)) {
    return prev + ANSWER_BREAK + next;
  }
  return prev + next;
}
