/**
 * Event Constants File - Flow Events
 *
 * IPC channel constants for what a bot's checks window needs (bot-checks
 * PRD): the read-only tools a tool call check may use, a script check
 * written by the dashboard's lead, and a folder or file picker.
 */
const FLOWS_READ_ONLY_TOOLS = "flows-read-only-tools";
const FLOWS_WRITE_SCRIPT = "flows-write-script";
const FLOWS_PICK_FOLDER = "flows-pick-folder";

module.exports = {
  FLOWS_READ_ONLY_TOOLS,
  FLOWS_WRITE_SCRIPT,
  FLOWS_PICK_FOLDER,
};
