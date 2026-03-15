/**
 * Event Constants File - WebSocket Events
 *
 * This file contains event constants for WebSocket provider
 * IPC communication between main and renderer processes.
 */
const WS_CONNECT = "ws-connect";
const WS_CONNECT_COMPLETE = "ws-connect-complete";
const WS_CONNECT_ERROR = "ws-connect-error";

const WS_DISCONNECT = "ws-disconnect";
const WS_DISCONNECT_COMPLETE = "ws-disconnect-complete";
const WS_DISCONNECT_ERROR = "ws-disconnect-error";

const WS_SEND = "ws-send";
const WS_SEND_COMPLETE = "ws-send-complete";
const WS_SEND_ERROR = "ws-send-error";

const WS_STATUS = "ws-status";
const WS_STATUS_COMPLETE = "ws-status-complete";
const WS_STATUS_ERROR = "ws-status-error";

const WS_MESSAGE = "ws-message";

const WS_STATUS_CHANGE = "ws-status-change";

const WS_GET_ALL = "ws-get-all";
const WS_GET_ALL_COMPLETE = "ws-get-all-complete";
const WS_GET_ALL_ERROR = "ws-get-all-error";

module.exports = {
  WS_CONNECT,
  WS_CONNECT_COMPLETE,
  WS_CONNECT_ERROR,
  WS_DISCONNECT,
  WS_DISCONNECT_COMPLETE,
  WS_DISCONNECT_ERROR,
  WS_SEND,
  WS_SEND_COMPLETE,
  WS_SEND_ERROR,
  WS_STATUS,
  WS_STATUS_COMPLETE,
  WS_STATUS_ERROR,
  WS_MESSAGE,
  WS_STATUS_CHANGE,
  WS_GET_ALL,
  WS_GET_ALL_COMPLETE,
  WS_GET_ALL_ERROR,
};
