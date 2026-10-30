/**
 * How long ago a conversation was touched, for lists (create-entry PRD
 * CRE-001/005). The Create screen's types and routing that lived here went
 * with the Create window (lead-workspace release 6c).
 */

/** "just now" · "5m ago" · "3h ago" · "2d ago" for a draft's updatedAt. */
export function draftAge(updatedAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(updatedAt || 0));
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
