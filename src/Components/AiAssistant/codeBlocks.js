/**
 * collapseCodeBlocks — for ChatCore's `hideCodeBlocks` option.
 *
 * Replaces each fenced code block (and the `File: path` marker line that
 * labels it) with a one-line italic note, so a chat whose code is shown
 * elsewhere (the Widget Builder's Code tab) stays readable. Back-to-back
 * blocks share one note. A block that is still streaming (no closing
 * fence yet) becomes "Writing code…". Inline `code` is untouched.
 *
 * @param {string} text  assistant Markdown
 * @param {string} note  what a hidden block says
 * @param {{ plain?: boolean }} [opts]  plain: no Markdown italics (for the
 *   streaming view, which shows raw text)
 * @returns {string}
 */
export function collapseCodeBlocks(text, note, { plain = false } = {}) {
  if (!text || typeof text !== "string" || !text.includes("```")) return text;
  const wrap = (t) => (plain ? t : `_${t}_`);
  const marker = wrap(note);
  let out = text
    // Complete blocks, with an optional "File: …" line just above.
    .replace(
      /(^|\n)(?:[ \t]*File:[^\n]*\n)?[ \t]*```[^\n]*\n[\s\S]*?\n[ \t]*```[ \t]*(?=\n|$)/g,
      `$1${marker}`,
    )
    // A block still being written: open fence with no close.
    .replace(
      /(^|\n)(?:[ \t]*File:[^\n]*\n)?[ \t]*```[^\n]*(?:\n[\s\S]*)?$/,
      `$1${wrap("Writing code…")}`,
    );
  // One note for back-to-back blocks.
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(`${escaped}(\\s*${escaped})+`, "g"), marker);
  return out;
}
