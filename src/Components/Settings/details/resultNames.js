/**
 * resultNameFor — the stable name of a bot result (team-dashboards TD-001),
 * made from the label the user types: "Important emails" → "importantEmails".
 * The name becomes part of the result's event (`…result.importantEmails`), so
 * it's fixed when the result is added; later label edits never change it.
 *
 * Mirrors electron/bots/botSchema.js RESULT_NAME_RE: a letter, then letters,
 * digits or underscores, at most 40 characters.
 */
const MAX = 40;

export function resultNameFor(label, taken = []) {
  const words = String(label || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let base = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
  if (!base) base = "result";
  if (!/^[A-Za-z]/.test(base))
    base = `result${base[0].toUpperCase()}${base.slice(1)}`;
  base = base.slice(0, MAX);

  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const name = base.slice(0, MAX - suffix.length) + suffix;
    if (!used.has(name)) return name;
  }
}
