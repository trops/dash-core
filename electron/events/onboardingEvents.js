/**
 * Event Constants — Onboarding Events
 *
 * IPC event constants for the first-run onboarding flow (Phase 3A).
 * The renderer calls these via `window.mainApi.onboarding.*`; the main
 * process registers handlers in the host shell against the
 * onboardingController.
 */
const ONBOARDING_GET_STATUS = "onboarding:get-status";
const ONBOARDING_MARK_COMPLETED = "onboarding:mark-completed";

module.exports = {
  ONBOARDING_GET_STATUS,
  ONBOARDING_MARK_COMPLETED,
};
