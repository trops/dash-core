/**
 * Event Constants — Publisher Key Events
 *
 * IPC event constants for the publisher signing flow. The renderer
 * calls these via `window.mainApi.publisherKey.*` (see
 * `api/publisherKeyApi.js`); the main process registers handlers in
 * the host shell.
 */
const PUBLISHER_KEY_GET_OR_CREATE = "publisher-key:get-or-create";
const PUBLISHER_KEY_DESCRIBE = "publisher-key:describe";
const PUBLISHER_KEY_REVOKE = "publisher-key:revoke";

module.exports = {
  PUBLISHER_KEY_GET_OR_CREATE,
  PUBLISHER_KEY_DESCRIBE,
  PUBLISHER_KEY_REVOKE,
};
