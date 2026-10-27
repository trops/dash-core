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
const PROFILE_DUPLICATE = "profile:duplicate";
const PROFILE_LIST_CONTENTS = "profile:list-contents";
const PROFILE_SET_MEMBERSHIP = "profile:set-membership";
const PROFILE_PREVIEW_SAVE = "profile:preview-save";
const PROFILE_SAVE_FILE = "profile:save-file";
const PROFILE_PUBLISH_WIDGET = "profile:publish-widget";

module.exports = {
  PROFILE_LIST,
  PROFILE_GET_ACTIVE,
  PROFILE_CREATE,
  PROFILE_RENAME,
  PROFILE_DELETE,
  PROFILE_SWITCH,
  PROFILE_DUPLICATE,
  PROFILE_LIST_CONTENTS,
  PROFILE_SET_MEMBERSHIP,
  PROFILE_PREVIEW_SAVE,
  PROFILE_SAVE_FILE,
  PROFILE_PUBLISH_WIDGET,
};
