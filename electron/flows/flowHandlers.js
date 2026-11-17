/**
 * flowHandlers.js
 *
 * The flows IPC handlers, as one map from channel to handler, so the app
 * registers them in a loop:
 *
 *   for (const [channel, handle] of Object.entries(flowHandlers({ dialog })))
 *     ipcMain.handle(channel, (e, msg) => handle(msg || {}));
 *
 * `dialog` (Electron's) opens the file and folder pickers.
 */
"use strict";

const E = require("../events/flowEvents");
const flowController = require("../controller/flowController");

const missing = (name) => () => ({
  error: `${name} isn't available in this build.`,
});
const fc = (name) =>
  typeof flowController[name] === "function"
    ? (...a) => flowController[name](...a)
    : missing(name);

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
    [E.FLOWS_LIST]: (m) => fc("list")(m.workspaceId),
    [E.FLOWS_GET]: (m) => fc("get")(m.flowId),
    [E.FLOWS_SAVE]: (m) => fc("save")(m.flowId, m.flow),
    [E.FLOWS_ADD_STEP]: (m) =>
      fc("addStep")(m.flowId, {
        from: m.from || null,
        to: m.to || null,
        step: m.step || {},
      }),
    [E.FLOWS_REMOVE_STEP]: (m) => fc("removeStep")(m.flowId, m.stepId),
    [E.FLOWS_UPDATE_STEP]: (m) =>
      fc("updateStep")(m.flowId, m.stepId, m.patch || {}),
    [E.FLOWS_CREATE]: (m) => fc("create")(m.workspaceId, { name: m.name }),
    [E.FLOWS_REMOVE]: (m) =>
      fc("remove")(m.flowId, { removeBots: !!m.removeBots }),
    [E.FLOWS_STARTERS]: () => fc("starters")(),
    [E.FLOWS_PREVIEW]: (m) => fc("preview")(m.workspaceId, m.proposal),
    [E.FLOWS_MAKE]: (m) =>
      fc("make")(m.workspaceId, m.proposal, {
        name: m.name || null,
        folder: m.folder || null,
      }),
    [E.FLOWS_UNDO]: (m) => fc("undo")(m.flowId),
    [E.FLOWS_PROPOSE]: (m) => fc("propose")(m.workspaceId, m.text),
    [E.FLOWS_WRITE_SCRIPT]: (m) =>
      fc("writeScript")(m.workspaceId, { ask: m.ask, fields: m.fields || [] }),
    [E.FLOWS_WHAT_IT_GETS]: (m) => fc("whatItGets")(m.flowId, m.stepId),
    [E.FLOWS_TRIAL]: (m) => fc("trial")(m.flowId, m.stepId, m.check),
    [E.FLOWS_SUGGEST_FIELDS]: (m) => fc("suggestFields")(m.flowId, m.stepId),
    [E.FLOWS_FIELD_USAGE]: (m) => fc("fieldUsage")(m.flowId, m.stepId),
    [E.FLOWS_READ_ONLY_TOOLS]: (m) => fc("readOnlyTools")(m.workspaceId),
    [E.FLOWS_RULE_TYPES]: () => fc("ruleTypes")(),
    [E.FLOWS_SIMPLE_GRAPH]: (m) => fc("simpleGraph")(m.workspaceId),
    [E.FLOWS_CRITERION_HELP]: (m) => fc("criterionHelp")(m.text),
    [E.FLOWS_NEW_GOAL]: (m) => fc("newGoal")(m.workspaceId, m.goal || {}),
    [E.FLOWS_START_GOAL]: (m) => fc("startGoal")(m.goalId, m.criteria),
    [E.FLOWS_SET_CRITERIA]: (m) => fc("setCriteria")(m.goalId, m.criteria),
    [E.FLOWS_FILES_LIST]: (m) => fc("listFiles")(m.flowId),
    [E.FLOWS_FILE_READ]: (m) => fc("readFile")(m.flowId, m.ref),
    [E.FLOWS_FILE_WRITE]: (m) => fc("writeFile")(m.flowId, m.ref, m.content),
    [E.FLOWS_FILE_COPY_IN]: async (m) => {
      const file = await pick(["openFile"], "Copy a file into this flow");
      if (!file) return { canceled: true };
      return fc("copyIn")(m.flowId, file, m.folder || "scripts");
    },
    [E.FLOWS_FILE_REMOVE]: (m) => fc("removeFile")(m.flowId, m.ref),
    [E.FLOWS_PICK_FOLDER]: async (m) => {
      const p = await pick(
        m.file ? ["openFile"] : ["openDirectory"],
        m.title || (m.file ? "Choose a file" : "Choose a folder"),
      );
      return p ? { path: p } : { canceled: true };
    },
    [E.FLOWS_PUBLISH_PREVIEW]: (m) => fc("publishPreview")(m.flowId),
    [E.FLOWS_PUBLISH]: (m) => fc("publish")(m.flowId, m),
    [E.FLOWS_INSTALL_PREVIEW]: (m) => fc("installPreview")(m.packageRef),
    [E.FLOWS_INSTALL]: (m) => fc("install")(m.previewId, m.choices || {}),
    [E.FLOWS_UPDATE_PREVIEW]: (m) => fc("updatePreview")(m.flowId),
    [E.FLOWS_UPDATE]: (m) => fc("update")(m.previewId, m.choices || {}),
    [E.FLOWS_SKIP_VERSION]: (m) => fc("skipVersion")(m.flowId, m.version),
    [E.FLOWS_CHECK_UPDATE]: (m) => fc("checkUpdate")(m.flowId),
    [E.FLOWS_SEARCH]: (m) => fc("searchFlows")(m.query || ""),
  };
}

module.exports = { flowHandlers };
