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
const PROFILE_PREVIEW_LOAD = "profile:preview-load";
const PROFILE_APPLY_LOAD = "profile:apply-load";
// Profiles kept in the account (step 2).
const PROFILE_SAVE_ACCOUNT = "profile:save-account";
const PROFILE_LIST_ACCOUNT = "profile:list-account";
const PROFILE_PREVIEW_LOAD_ACCOUNT = "profile:preview-load-account";
const PROFILE_DELETE_ACCOUNT = "profile:delete-account";

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
  PROFILE_PREVIEW_LOAD,
  PROFILE_APPLY_LOAD,
  PROFILE_SAVE_ACCOUNT,
  PROFILE_LIST_ACCOUNT,
  PROFILE_PREVIEW_LOAD_ACCOUNT,
  PROFILE_DELETE_ACCOUNT,
};
