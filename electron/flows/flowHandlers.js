/**
 * flowHandlers.js
 *
 * The IPC handlers a bot's checks window needs (bot-checks PRD), as one map
 * from channel to handler, so the app registers them in a loop:
 *
 *   for (const [channel, handle] of Object.entries(flowHandlers({ dialog })))
 *     ipcMain.handle(channel, (e, msg) => handle(msg || {}));
 *
 * `dialog` (Electron's) opens the file and folder pickers.
 */
"use strict";

const E = require("../events/flowEvents");
const flowController = require("../controller/flowController");

function flowHandlers({ dialog = null, getMainWindow = () => null } = {}) {
  const pick = async (properties, title) => {
    if (!dialog) return null;
    const win = getMainWindow();
    const r = await (win
      ? dialog.showOpenDialog(win, { properties, title })
      : dialog.showOpenDialog({ properties, title }));
    return r && !r.canceled && r.filePaths && r.filePaths[0]
      ? r.filePaths[0]
      : null;
  };

  return {
    [E.FLOWS_WRITE_SCRIPT]: (m) =>
      flowController.writeScript(m.workspaceId, {
        ask: m.ask,
        fields: m.fields || [],
      }),
    [E.FLOWS_READ_ONLY_TOOLS]: (m) =>
      flowController.readOnlyTools(m.workspaceId),
    [E.FLOWS_PICK_FOLDER]: async (m) => {
      const p = await pick(
        m.file ? ["openFile"] : ["openDirectory"],
        m.title || (m.file ? "Choose a file" : "Choose a folder"),
      );
      return p ? { path: p } : { canceled: true };
    },
  };
}

module.exports = { flowHandlers };
