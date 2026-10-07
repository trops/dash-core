/**
 * htmlToText.js
 *
 * Small HTML → readable text (light markdown) converter for Web Fetch's
 * fetch_url. Not a full parser: it drops non-content elements, keeps headings,
 * list items and link targets, and decodes entities. Pages that build their
 * content with JavaScript come back mostly empty (out of scope, per the PRD).
 * Pure — no Electron, no DOM.
 */
"use strict";

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      try {
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      } catch (_e) {
        return m;
      }
    }
    const v = NAMED[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

/**
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  let s = String(html || "");
  // Elements whose content is never page text.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(
    /<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  // Keep the page title, drop the rest of <head>.
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s);
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/i, "");
  if (title) s = `<h1>${title[1]}</h1>${s}`;

  // Headings → "# text"; links → [text](href); list items → "- ".
  s = s.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
    (_m, level, inner) =>
      `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`,
  );
  s = s.replace(
    /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_m, _q, dq, sq, inner) => {
      const text = stripTags(inner).trim();
      const href = dq !== undefined ? dq : sq;
      return text && href && !/^(javascript:|#)/i.test(href)
        ? `[${text}](${href})`
        : text;
    },
  );
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(
    /<\/(p|div|section|article|header|footer|main|ul|ol|table|tr|blockquote|pre|figure|form|nav|aside)\s*>/gi,
    "\n\n",
  );
  s = s.replace(/<\/(td|th)\s*>/gi, "\t");

  s = decodeEntities(stripTags(s));

  // Tidy whitespace: collapse runs within lines, trim lines, ≤ 1 blank line.
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { htmlToText, decodeEntities };
