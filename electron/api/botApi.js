/**
 * botApi.js
 *
 * Preload bridge for Bot Factory operations: bot CRUD, run control, approvals,
 * and subscription to streamed run/approval events. Mirrors the invoke +
 * event-listener pattern used by llmApi.
 */
const { ipcRenderer } = require("electron");
const {
  BOTS_LIST,
  BOTS_GET,
  BOTS_SAVE,
  BOTS_DELETE,
  BOTS_RUN,
  BOTS_STOP,
  BOTS_APPROVE,
  BOTS_LIST_APPROVALS,
  BOT_STREAM,
  BOT_APPROVAL_PENDING,
} = require("../events/botEvents");

let _nextListenerId = 0;
const _listenerMap = new Map();

function _addListener(channel, callback) {
  const id = String(++_nextListenerId);
  const wrapped = (_event, data) => callback(data);
  ipcRenderer.on(channel, wrapped);
  _listenerMap.set(id, { channel, wrapped });
  return id;
}

const botApi = {
  list: () => ipcRenderer.invoke(BOTS_LIST),
  get: (botId) => ipcRenderer.invoke(BOTS_GET, { botId }),
  save: (definition) => ipcRenderer.invoke(BOTS_SAVE, { definition }),
  delete: (botId) => ipcRenderer.invoke(BOTS_DELETE, { botId }),

  /** Start a run. Stream events arrive via onStream(). */
  run: (botId, prompt) => ipcRenderer.invoke(BOTS_RUN, { botId, prompt }),
  stop: (botId) => ipcRenderer.invoke(BOTS_STOP, { botId }),

  /** Resolve a pending approval. decision: { allow, reason? } */
  approve: (approvalId, decision) =>
    ipcRenderer.invoke(BOTS_APPROVE, { approvalId, decision }),
  listApprovals: () => ipcRenderer.invoke(BOTS_LIST_APPROVALS),

  /** Subscribe to streamed run events: { botId, event }. */
  onStream: (callback) => _addListener(BOT_STREAM, callback),
  /** Subscribe to new pending approvals: { id, request }. */
  onApprovalPending: (callback) => _addListener(BOT_APPROVAL_PENDING, callback),

  removeListener: (id) => {
    const entry = _listenerMap.get(id);
    if (!entry) return false;
    ipcRenderer.removeListener(entry.channel, entry.wrapped);
    _listenerMap.delete(id);
    return true;
  },
};

module.exports = botApi;
