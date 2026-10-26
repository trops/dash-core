/**
 * Event Constants — Profile Events
 *
 * IPC event constants for profiles. The renderer calls these via
 * `window.mainApi.profiles.*`; the main process registers handlers against
 * `profileController`.
 */
const PROFILE_LIST = "profile:list";
const PROFILE_GET_ACTIVE = "profile:get-active";
const PROFILE_CREATE = "profile:create";
const PROFILE_RENAME = "profile:rename";
const PROFILE_DELETE = "profile:delete";
const PROFILE_SWITCH = "profile:switch";

module.exports = {
  PROFILE_LIST,
  PROFILE_GET_ACTIVE,
  PROFILE_CREATE,
  PROFILE_RENAME,
  PROFILE_DELETE,
  PROFILE_SWITCH,
};
