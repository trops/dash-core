/**
 * What Settings › Profiles should open to, asked for from outside it — the
 * updates dialog's profile actions (dash-profiles step 2, S3). The asker
 * sets it and dispatches `dash:open-profile-sync`; Settings opens to
 * Profiles, which takes it once.
 *
 * Intent: { profileId, action: "save" | "load" | "pick", accountId,
 *   replaceRevision }. "save" with a replaceRevision is "keep this
 *   computer's" (replace the account's newer copy); "pick" (no profile)
 *   opens the account's list to load one (the Welcome screen).
 */
let pending = null;

export function setProfileIntent(intent) {
  pending =
    intent && (intent.profileId || intent.action === "pick")
      ? { ...intent }
      : null;
}

/** The intent, once: the next call returns null. */
export function takeProfileIntent() {
  const intent = pending;
  pending = null;
  return intent;
}

/** Open Settings › Profiles to do `intent`. */
export function openProfileSync(intent) {
  setProfileIntent(intent);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("dash:open-profile-sync", { detail: { ...intent } }),
    );
  }
}
