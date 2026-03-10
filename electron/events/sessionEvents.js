/**
 * Event Constants — Session Events
 *
 * IPC event constants for session management (recents + session restore).
 */
const SESSION_GET_RECENTS = "session:get-recents";
const SESSION_ADD_RECENT = "session:add-recent";
const SESSION_CLEAR_RECENTS = "session:clear-recents";
const SESSION_GET_STATE = "session:get-state";
const SESSION_SAVE_STATE = "session:save-state";
const SESSION_CLEAR_STATE = "session:clear-state";

module.exports = {
  SESSION_GET_RECENTS,
  SESSION_ADD_RECENT,
  SESSION_CLEAR_RECENTS,
  SESSION_GET_STATE,
  SESSION_SAVE_STATE,
  SESSION_CLEAR_STATE,
};
