/**
 * flowsApi.js
 *
 * Preload-side IPC bindings for flows (flows PRD). Exposed to the renderer
 * as mainApi.flows. Changes arrive on "flows:changed" ({ type, flowId,
 * workspaceId? }) via mainApi.on.
 */
const { ipcRenderer } = require("electron");
const E = require("../events/flowEvents");

const call = (channel, msg = {}) => ipcRenderer.invoke(channel, msg);

const flowsApi = {
  /** A dashboard's flows, each with where its goals are and its warnings. */
  list: (workspaceId) => call(E.FLOWS_LIST, { workspaceId }),
  get: (flowId) => call(E.FLOWS_GET, { flowId }),
  save: (flowId, flow) => call(E.FLOWS_SAVE, { flowId, flow }),
  /** The + on an arrow: { from, to, step }. */
  addStep: (flowId, at) => call(E.FLOWS_ADD_STEP, { flowId, ...at }),
  removeStep: (flowId, stepId) => call(E.FLOWS_REMOVE_STEP, { flowId, stepId }),
  updateStep: (flowId, stepId, patch) =>
    call(E.FLOWS_UPDATE_STEP, { flowId, stepId, patch }),
  create: (workspaceId, name) => call(E.FLOWS_CREATE, { workspaceId, name }),
  /** Delete a flow; `removeBots` also deletes the bots it made. */
  remove: (flowId, removeBots = false) =>
    call(E.FLOWS_REMOVE, { flowId, removeBots }),
  starters: () => call(E.FLOWS_STARTERS),
  /** A starter id or the Lead's proposal, as it would be made. */
  preview: (workspaceId, proposal) =>
    call(E.FLOWS_PREVIEW, { workspaceId, proposal }),
  /** "Make this flow": its bots, then the flow. */
  make: (workspaceId, proposal, opts = {}) =>
    call(E.FLOWS_MAKE, { workspaceId, proposal, ...opts }),
  undo: (flowId) => call(E.FLOWS_UNDO, { flowId }),
  /** Ask the dashboard's lead to propose a flow from what it should do. */
  propose: (workspaceId, text) => call(E.FLOWS_PROPOSE, { workspaceId, text }),
  /** A script check's function, written once by the dashboard's lead. */
  writeScript: (workspaceId, opts) =>
    call(E.FLOWS_WRITE_SCRIPT, { workspaceId, ...opts }),
  whatItGets: (flowId, stepId) =>
    call(E.FLOWS_WHAT_IT_GETS, { flowId, stepId }),
  /** Try a check on the last real record before saving it. */
  trial: (flowId, stepId, check) =>
    call(E.FLOWS_TRIAL, { flowId, stepId, check }),
  suggestFields: (flowId, stepId) =>
    call(E.FLOWS_SUGGEST_FIELDS, { flowId, stepId }),
  fieldUsage: (flowId, stepId) => call(E.FLOWS_FIELD_USAGE, { flowId, stepId }),
  readOnlyTools: (workspaceId) =>
    call(E.FLOWS_READ_ONLY_TOOLS, { workspaceId }),
  ruleTypes: () => call(E.FLOWS_RULE_TYPES),
  /** A dashboard with no flows: its bots, what they read and show. */
  simpleGraph: (workspaceId) => call(E.FLOWS_SIMPLE_GRAPH, { workspaceId }),
  criterionHelp: (text) => call(E.FLOWS_CRITERION_HELP, { text }),
  newGoal: (workspaceId, goal) => call(E.FLOWS_NEW_GOAL, { workspaceId, goal }),
  startGoal: (goalId, criteria) =>
    call(E.FLOWS_START_GOAL, { goalId, criteria }),
  setCriteria: (goalId, criteria) =>
    call(E.FLOWS_SET_CRITERIA, { goalId, criteria }),
  files: (flowId) => call(E.FLOWS_FILES_LIST, { flowId }),
  readFile: (flowId, ref) => call(E.FLOWS_FILE_READ, { flowId, ref }),
  writeFile: (flowId, ref, content) =>
    call(E.FLOWS_FILE_WRITE, { flowId, ref, content }),
  /** "Copy in from this computer…": opens a file picker. */
  copyIn: (flowId, folder) => call(E.FLOWS_FILE_COPY_IN, { flowId, folder }),
  removeFile: (flowId, ref) => call(E.FLOWS_FILE_REMOVE, { flowId, ref }),
  /** Choose a folder (a work folder, a file only on this computer). */
  pickFolder: (opts = {}) => call(E.FLOWS_PICK_FOLDER, opts),
  publishPreview: (flowId) => call(E.FLOWS_PUBLISH_PREVIEW, { flowId }),
  publish: (flowId, opts) => call(E.FLOWS_PUBLISH, { flowId, ...opts }),
  installPreview: (packageRef) => call(E.FLOWS_INSTALL_PREVIEW, { packageRef }),
  install: (previewId, choices) =>
    call(E.FLOWS_INSTALL, { previewId, choices }),
  updatePreview: (flowId) => call(E.FLOWS_UPDATE_PREVIEW, { flowId }),
  update: (previewId, choices) => call(E.FLOWS_UPDATE, { previewId, choices }),
  skipVersion: (flowId, version) =>
    call(E.FLOWS_SKIP_VERSION, { flowId, version }),
  /** Is a newer version of an installed flow out? */
  checkUpdate: (flowId) => call(E.FLOWS_CHECK_UPDATE, { flowId }),
  /** Flow packages on the registry, for "Install a flow". */
  search: (query) => call(E.FLOWS_SEARCH, { query }),
};

module.exports = flowsApi;
