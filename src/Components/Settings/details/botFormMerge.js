/**
 * keepLatest — what a bot form saves. The form holds a copy of the bot from
 * when it opened; the bot may have been saved since (its provider changed in
 * another view, a trigger added on the team diagram…). Saving the whole copy
 * would put those values back. So: fields the form changed keep the form's
 * value; every other field takes the latest saved value.
 *
 * @param {object} edited  the definition the form would save now
 * @param {object|null} opened  the same definition as the form opened (or
 *   last saved)
 * @param {object|null} latest  the bot as saved right now
 */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function keepLatest(edited, opened, latest) {
  if (!edited || !opened || !latest) return edited;
  const out = { ...edited };
  for (const key of Object.keys(edited)) {
    if (key === "id") continue;
    if (same(edited[key], opened[key]) && key in latest) {
      out[key] = latest[key];
    }
  }
  return out;
}
