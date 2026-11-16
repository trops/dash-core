/**
 * dismissedNeeds — cards taken off "Needs you" with ×.
 *
 * Dismissing only hides a card: a plan's conversation stays in Recents, a
 * bot's run stays in its Activity. Each dismissal remembers when the thing
 * happened, so a card comes back only for something newer (the plan is
 * ready again, the bot fails again). Asks for permission can't be
 * dismissed — they wait for Allow or Deny.
 *
 * Kept per device, like when the panel was last seen.
 */

const KEY = "dash:botNotifications:dismissed";
const DAY = 24 * 60 * 60 * 1000;
// Older than any card can be (plans and failures show for 7 days).
const KEEP_DAYS = 30;

/** Can this card be dismissed? Plans and failed runs; not asks. */
export function canDismiss(item) {
  return !!item && (item.kind === "plan" || item.kind === "failed");
}

/** The same thing across times: a bot's failures share one key. */
export function dismissKey(item) {
  if (!item) return null;
  if (item.kind === "failed") return `failed:${item.botId}`;
  return item.id;
}

/** Dismissed, and nothing newer since. */
export function isDismissed(item, dismissed) {
  const key = dismissKey(item);
  const at = key && dismissed ? dismissed[key] : null;
  return typeof at === "number" && item.at <= at;
}

/** `dismissed` with `items` added (each at its own time); old ones dropped. */
export function withDismissed(dismissed, items, now = Date.now()) {
  const next = {};
  for (const [k, at] of Object.entries(dismissed || {})) {
    if (typeof at === "number" && now - at < KEEP_DAYS * DAY) next[k] = at;
  }
  for (const it of items || []) {
    if (!canDismiss(it)) continue;
    next[dismissKey(it)] = Math.max(next[dismissKey(it)] || 0, it.at || now);
  }
  return next;
}

export function readDismissed() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (_e) {
    return {};
  }
}

export function writeDismissed(dismissed) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(dismissed || {}));
  } catch (_e) {
    // private window: dismissed only until the panel closes
  }
}
