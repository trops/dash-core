/**
 * flowsApi.js
 *
 * Preload-side IPC bindings for a bot's checks (bot-checks PRD) and the
 * folder picker. Exposed to the renderer as mainApi.flows.
 */
const { ipcRenderer } = require("electron");
const E = require("../events/flowEvents");

const call = (channel, msg = {}) => ipcRenderer.invoke(channel, msg);

const flowsApi = {
  /** A script check's function, written once by the dashboard's lead. */
  writeScript: (workspaceId, opts) =>
    call(E.FLOWS_WRITE_SCRIPT, { workspaceId, ...opts }),
  /** Per connected provider, the tools a tool call check may use. */
  readOnlyTools: (workspaceId) =>
    call(E.FLOWS_READ_ONLY_TOOLS, { workspaceId }),
  /** Choose a folder (a bot's work folder) or a file. */
  pickFolder: (opts = {}) => call(E.FLOWS_PICK_FOLDER, opts),
};

module.exports = flowsApi;
