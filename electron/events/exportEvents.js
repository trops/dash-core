/**
 * Event Constants — Export Events
 *
 * IPC event constants for the Export Everything bundle (Phase 4A).
 * The renderer calls these via `window.mainApi.export.*`; the main
 * process registers a handler against `exportController.exportEverythingForApplication`.
 */
const EXPORT_EVERYTHING = "export:everything";

module.exports = {
  EXPORT_EVERYTHING,
};
