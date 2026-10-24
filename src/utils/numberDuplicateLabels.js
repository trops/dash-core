/**
 * numberDuplicateLabels — two widgets of the same kind read "Notepad 1" and
 * "Notepad 2" instead of being told apart by an internal id or uuid.
 * Labels that appear once are left alone; numbering follows list order.
 *
 * @param {Array<object>} list
 * @param {string} key  the label field ("label", "title")
 * @returns {Array<object>} a copy; only duplicated labels change
 */
export function numberDuplicateLabels(list, key) {
  if (!Array.isArray(list)) return list;
  const counts = new Map();
  for (const item of list) {
    const label = item && item[key];
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const seen = new Map();
  return list.map((item) => {
    const label = item && item[key];
    if (!label || counts.get(label) < 2) return item;
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    return { ...item, [key]: `${label} ${n}` };
  });
}
