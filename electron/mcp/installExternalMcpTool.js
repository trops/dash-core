/**
 * installExternalMcpTool.js
 *
 * Registers the `install_known_mcp_server` tool on Dash's own MCP server.
 *
 * Why this tool exists:
 * The AI Widget Builder asks Claude to use MCP-first when a user requests
 * a widget for an external service. The built-in catalog covers 13 servers;
 * for anything else the AI consults the curated allow-list at
 * `electron/mcp/knownExternalMcpServers.json`. To keep the user in control
 * (npm install + spawning a child process is a non-trivial trust grant),
 * the actual install is gated by a renderer-side confirmation modal: this
 * tool emits an IPC event with the curated entry, waits for the user's
 * response, and only then routes through the existing add-provider flow.
 *
 * Trust boundary: the `id` argument MUST match an entry in
 * knownExternalMcpServers.json. Any other id is rejected before the
 * confirmation modal is even shown.
 *
 * Returns one of:
 *   - { success: true, name }      — installed
 *   - { success: false, declined } — user clicked Cancel
 *   - { success: false, error }    — id not in allow-list, IPC timeout, or
 *                                    install error from add-provider flow
 */
const { BrowserWindow } = require("electron");
const { registerTool } = require("../controller/mcpDashServerController");
const mcpController = require("../controller/mcpController");
const {
  MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM,
  MCP_INSTALL_KNOWN_EXTERNAL_RESULT,
} = require("../events/mcpEvents");
const { handleAddProvider } = require("./toolHandlers");
const { ipcMain } = require("electron");

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — user may stop to read

// Pending requests keyed by requestId so we can resolve when the result IPC arrives.
const pendingRequests = new Map();

let resultListenerInstalled = false;
function ensureResultListener() {
  if (resultListenerInstalled) return;
  resultListenerInstalled = true;
  ipcMain.on(MCP_INSTALL_KNOWN_EXTERNAL_RESULT, (_event, payload) => {
    const { requestId, result } = payload || {};
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(result || { confirmed: false });
  });
}

function findEntryInAllowList(id) {
  const { servers } = mcpController.getKnownExternalCatalog();
  if (!Array.isArray(servers)) return null;
  return servers.find((s) => s && s.id === id) || null;
}

function newRequestId() {
  return `mcp-install-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function awaitUserConfirmation(server) {
  ensureResultListener();
  const requestId = newRequestId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ confirmed: false, error: "Install confirmation timed out" });
      }
    }, CONFIRM_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, timer });

    // Broadcast to all open windows; whichever has the modal mounted picks it up.
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) {
      pendingRequests.delete(requestId);
      clearTimeout(timer);
      resolve({ confirmed: false, error: "No window available" });
      return;
    }
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send(MCP_INSTALL_KNOWN_EXTERNAL_CONFIRM, {
          requestId,
          id: server.id,
          server,
        });
      }
    }
  });
}

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function fail(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

async function handleInstallKnownMcpServer({ id, name }) {
  if (!id || typeof id !== "string") {
    return fail({ success: false, error: "id is required" });
  }
  const server = findEntryInAllowList(id);
  if (!server) {
    return fail({
      success: false,
      error: `id "${id}" is not in the known-external MCP allow-list. The user can only install servers explicitly listed in knownExternalMcpServers.json.`,
    });
  }

  const decision = await awaitUserConfirmation(server);
  if (!decision || !decision.confirmed) {
    if (decision?.error) {
      return fail({ success: false, error: decision.error });
    }
    return ok({ success: false, declined: true });
  }

  // Route through the existing add-provider tool handler. The renderer
  // collected credentials in its modal — we trust those to match the
  // curated `credentialSchema`.
  const providerName = (name && name.trim()) || server.name || server.id;
  try {
    const addResult = await handleAddProvider({
      name: providerName,
      type: server.id,
      providerClass: "mcp",
      credentials: decision.credentials || {},
      mcpConfig: server.mcpConfig,
    });
    if (addResult?.isError) {
      // Surface add-provider's error text verbatim.
      return addResult;
    }
    return ok({ success: true, name: providerName, type: server.id });
  } catch (err) {
    return fail({ success: false, error: err.message });
  }
}

const installExternalMcpToolDef = {
  name: "install_known_mcp_server",
  description:
    "Install an MCP server from Dash's curated known-external allow-list. The user is shown a confirmation modal before any install runs. Use this when the user asks for a widget that needs a service NOT in the built-in MCP catalog but IS in the known-external list. Returns { success, name } on install, { success: false, declined: true } if the user cancels, or an error if the id isn't allow-listed.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "The id of the server in the known-external catalog (e.g. 'trello', 'asana', 'stripe').",
      },
      name: {
        type: "string",
        description:
          "Optional display name for the resulting provider entry. Defaults to the catalog entry's name.",
      },
    },
    required: ["id"],
  },
};

function registerInstallKnownMcpServerTool() {
  registerTool({
    ...installExternalMcpToolDef,
    handler: handleInstallKnownMcpServer,
  });
  console.log("[installExternalMcpTool] Registered install_known_mcp_server");
}

module.exports = {
  registerInstallKnownMcpServerTool,
  // Exported for tests
  handleInstallKnownMcpServer,
};
