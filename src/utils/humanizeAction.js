/**
 * humanizeAction
 *
 * Map an internal (domain, action) pair to a user-readable verb phrase
 * for use in consent modals. Engineering terms like `saveToFile` or
 * `readDataFromURL` aren't meaningful to regular users; this lookup
 * lets the modal copy speak plainly.
 *
 * Returns the raw action when no entry exists (defensive — modal
 * still works, just shows the engineering name). Empty string when
 * inputs are non-strings.
 */

const FS_VERBS = {
  saveData: "save changes to a file",
  saveToFile: "save changes to a file",
  readData: "read a file",
  readFromFile: "read a file",
  readJSONFromFile: "read a file",
  transformFile: "transform a file",
  convertJsonToCsvFile: "convert and save a file",
  parseXMLStream: "parse and save a file",
  parseCSVStream: "parse and save a file",
  readDataFromURL: "fetch from a URL and save to a file",
};

const NETWORK_VERBS = {
  readDataFromURL: "fetch from a URL",
  connect: "open a websocket connection",
  wsConnect: "open a websocket connection",
};

const MCP_VERBS = {
  // For MCP, the caller (modal) typically renders "<verb> <tool name>"
  // since the tool name is itself the most informative bit. The verb
  // stays neutral.
  callTool: "use the",
};

export function humanizeAction(domain, action) {
  if (typeof domain !== "string" || typeof action !== "string") return "";
  const table =
    domain === "fs"
      ? FS_VERBS
      : domain === "network"
        ? NETWORK_VERBS
        : domain === "mcp"
          ? MCP_VERBS
          : null;
  if (!table) return action;
  return table[action] || action;
}
