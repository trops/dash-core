/**
 * Event Constants File - Flow Events
 *
 * IPC channel constants for flows: the steps a dashboard's work goes
 * through, checks, and who hands work to whom (flows PRD).
 */
const FLOWS_LIST = "flows-list";
const FLOWS_GET = "flows-get";
const FLOWS_SAVE = "flows-save";
const FLOWS_ADD_STEP = "flows-add-step";
const FLOWS_REMOVE_STEP = "flows-remove-step";
const FLOWS_UPDATE_STEP = "flows-update-step";
const FLOWS_CREATE = "flows-create";
const FLOWS_REMOVE = "flows-remove";
const FLOWS_STARTERS = "flows-starters";
const FLOWS_PREVIEW = "flows-preview";
const FLOWS_MAKE = "flows-make";
const FLOWS_UNDO = "flows-undo";
const FLOWS_WHAT_IT_GETS = "flows-what-it-gets";
const FLOWS_TRIAL = "flows-trial";
const FLOWS_SUGGEST_FIELDS = "flows-suggest-fields";
const FLOWS_FIELD_USAGE = "flows-field-usage";
const FLOWS_READ_ONLY_TOOLS = "flows-read-only-tools";
const FLOWS_RULE_TYPES = "flows-rule-types";
const FLOWS_SIMPLE_GRAPH = "flows-simple-graph";
const FLOWS_CRITERION_HELP = "flows-criterion-help";
const FLOWS_NEW_GOAL = "flows-new-goal";
const FLOWS_START_GOAL = "flows-start-goal";
const FLOWS_SET_CRITERIA = "flows-set-criteria";
const FLOWS_FILES_LIST = "flows-files-list";
const FLOWS_FILE_READ = "flows-file-read";
const FLOWS_FILE_WRITE = "flows-file-write";
const FLOWS_FILE_COPY_IN = "flows-file-copy-in";
const FLOWS_FILE_REMOVE = "flows-file-remove";
const FLOWS_PICK_FOLDER = "flows-pick-folder";
const FLOWS_PROPOSE = "flows-propose";
const FLOWS_WRITE_SCRIPT = "flows-write-script";
const FLOWS_PUBLISH_PREVIEW = "flows-publish-preview";
const FLOWS_PUBLISH = "flows-publish";
const FLOWS_INSTALL_PREVIEW = "flows-install-preview";
const FLOWS_INSTALL = "flows-install";
const FLOWS_UPDATE_PREVIEW = "flows-update-preview";
const FLOWS_UPDATE = "flows-update";
const FLOWS_SKIP_VERSION = "flows-skip-version";
const FLOWS_CHECK_UPDATE = "flows-check-update";
const FLOWS_SEARCH = "flows-search";

// Main → every window: { type, flowId, workspaceId? }
const FLOWS_CHANGED = "flows:changed";

module.exports = {
  FLOWS_LIST,
  FLOWS_GET,
  FLOWS_SAVE,
  FLOWS_ADD_STEP,
  FLOWS_REMOVE_STEP,
  FLOWS_UPDATE_STEP,
  FLOWS_CREATE,
  FLOWS_REMOVE,
  FLOWS_STARTERS,
  FLOWS_PREVIEW,
  FLOWS_MAKE,
  FLOWS_UNDO,
  FLOWS_WHAT_IT_GETS,
  FLOWS_TRIAL,
  FLOWS_SUGGEST_FIELDS,
  FLOWS_FIELD_USAGE,
  FLOWS_READ_ONLY_TOOLS,
  FLOWS_RULE_TYPES,
  FLOWS_SIMPLE_GRAPH,
  FLOWS_CRITERION_HELP,
  FLOWS_NEW_GOAL,
  FLOWS_START_GOAL,
  FLOWS_SET_CRITERIA,
  FLOWS_FILES_LIST,
  FLOWS_FILE_READ,
  FLOWS_FILE_WRITE,
  FLOWS_FILE_COPY_IN,
  FLOWS_FILE_REMOVE,
  FLOWS_PICK_FOLDER,
  FLOWS_PROPOSE,
  FLOWS_WRITE_SCRIPT,
  FLOWS_PUBLISH_PREVIEW,
  FLOWS_PUBLISH,
  FLOWS_INSTALL_PREVIEW,
  FLOWS_INSTALL,
  FLOWS_UPDATE_PREVIEW,
  FLOWS_UPDATE,
  FLOWS_SKIP_VERSION,
  FLOWS_CHECK_UPDATE,
  FLOWS_SEARCH,
  FLOWS_CHANGED,
};
