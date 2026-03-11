/**
 * Event Constants File - Notification Events
 *
 * IPC channel constants for the notification system.
 */
const NOTIFICATION_SEND = "notification-send";
const NOTIFICATION_SEND_COMPLETE = "notification-send-complete";
const NOTIFICATION_SEND_ERROR = "notification-send-error";

const NOTIFICATION_GET_PREFERENCES = "notification-get-preferences";
const NOTIFICATION_GET_PREFERENCES_COMPLETE =
  "notification-get-preferences-complete";
const NOTIFICATION_GET_PREFERENCES_ERROR = "notification-get-preferences-error";

const NOTIFICATION_SET_PREFERENCES = "notification-set-preferences";
const NOTIFICATION_SET_PREFERENCES_COMPLETE =
  "notification-set-preferences-complete";
const NOTIFICATION_SET_PREFERENCES_ERROR = "notification-set-preferences-error";

const NOTIFICATION_SET_GLOBAL = "notification-set-global";
const NOTIFICATION_SET_GLOBAL_COMPLETE = "notification-set-global-complete";
const NOTIFICATION_SET_GLOBAL_ERROR = "notification-set-global-error";

const NOTIFICATION_CLICKED = "notification:clicked";

module.exports = {
  NOTIFICATION_SEND,
  NOTIFICATION_SEND_COMPLETE,
  NOTIFICATION_SEND_ERROR,
  NOTIFICATION_GET_PREFERENCES,
  NOTIFICATION_GET_PREFERENCES_COMPLETE,
  NOTIFICATION_GET_PREFERENCES_ERROR,
  NOTIFICATION_SET_PREFERENCES,
  NOTIFICATION_SET_PREFERENCES_COMPLETE,
  NOTIFICATION_SET_PREFERENCES_ERROR,
  NOTIFICATION_SET_GLOBAL,
  NOTIFICATION_SET_GLOBAL_COMPLETE,
  NOTIFICATION_SET_GLOBAL_ERROR,
  NOTIFICATION_CLICKED,
};
