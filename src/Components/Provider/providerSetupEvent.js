/**
 * Ask ProviderSetupHost to open a provider's setup in front of any window
 * (dash-profiles). No imports, so any screen can ask.
 */
export const PROVIDER_SETUP_EVENT = "dash:open-provider-setup";

/**
 * @param {string} name  the provider (it exists — a loaded profile added it)
 * @param {{ review?: boolean }} [opts]  review: its page (a program waiting
 *   for the user's OK has Allow there), not its edit form
 */
export function openProviderSetup(name, { review = false } = {}) {
  if (typeof window === "undefined" || !name) return;
  window.dispatchEvent(
    new CustomEvent(PROVIDER_SETUP_EVENT, { detail: { name, review } }),
  );
}
