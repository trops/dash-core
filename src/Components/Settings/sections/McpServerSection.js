import React, { useState, useCallback } from "react";
import {
  Switch,
  SubHeading3,
  Button,
  DataList,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { useMcpDashServer } from "../../../hooks/useMcpDashServer";
import { TaskPassphraseSection } from "./TaskPassphraseSection";
import { McpToolsSection } from "./McpToolsSection";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { mcpClientSetup } from "./mcpClientSetup";

// One way to connect: its ready-to-paste text and a Copy button.
const SetupSnippet = ({ title, note, text, testId }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className={`text-sm font-medium ${strong}`}>{title}</span>
          <span className={`text-xs ${muted}`}>{note}</span>
        </div>
        <Button title={copied ? "Copied!" : "Copy"} onClick={copy} size="sm" />
      </div>
      <pre
        className={`text-xs rounded border p-3 overflow-auto max-h-48 select-all whitespace-pre-wrap break-all ${fieldBg} ${hairline} ${strong}`}
      >
        {text}
      </pre>
    </div>
  );
};

/**
 * McpServerSection
 *
 * Settings section for controlling the hosted MCP Dash server.
 * Provides toggle, port configuration, status indicator, token display,
 * connection stats, and the task passphrase (bot-teams TEAM-016).
 *
 * @param {object[]} [workspaces]  dashboards (which teams take tasks)
 */
const ConnectClaude = ({ port, token, certPath }) => {
  const { muted } = useConfigTokens();
  const setup = mcpClientSetup({ port, token, certPath });
  return (
    <div className="flex flex-col gap-4" data-testid="mcp-connect-claude">
      <div className="flex flex-col gap-1">
        <SubHeading3 title="Connect Claude" padding={false} />
        <span className={`text-xs ${muted}`}>
          Dash's server is at {setup.url}, over https with a certificate Dash
          makes itself — these trust it for you.
        </span>
      </div>
      <SetupSnippet
        testId="mcp-setup-claude-code"
        title="Claude Code"
        note="Run this once in Terminal. It holds your token — don't share it."
        text={setup.claudeCode}
      />
      <SetupSnippet
        testId="mcp-setup-claude-desktop"
        title="Claude Desktop"
        note="Add to claude_desktop_config.json (Settings › Developer › Edit Config), then restart Claude."
        text={setup.claudeDesktop}
      />
      <span className={`text-xs ${muted}`}>
        Claude on the web (claude.ai connectors) can't reach Dash — it connects
        from the internet, and Dash's server is only open to this computer.
      </span>
    </div>
  );
};

export const McpServerSection = ({ workspaces = [] }) => {
  const {
    running,
    port,
    connectionCount,
    uptime,
    toolCount,
    resourceCount,
    token,
    certPath,
    loading,
    error,
    startServer,
    stopServer,
    restartServer,
  } = useMcpDashServer();

  const [portInput, setPortInput] = useState(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Use live port from server, but allow local override while editing
  const displayPort = portInput !== null ? portInput : port || 3141;

  const handleToggle = useCallback(
    async (enabled) => {
      if (enabled) {
        const result = await startServer(displayPort);
        if (result?.success) setPortInput(null);
      } else {
        await stopServer();
      }
    },
    [startServer, stopServer, displayPort],
  );

  const handlePortChange = useCallback((e) => {
    const val = e.target.value.replace(/\D/g, "");
    setPortInput(val ? parseInt(val, 10) : "");
  }, []);

  // Running: a new port restarts the server on it. Stopped: the port is
  // kept for the next start. Either way a port that fails stays in the
  // field, next to its error, to change.
  const handlePortBlur = useCallback(async () => {
    if (portInput === "" || portInput === port) {
      setPortInput(null);
      return;
    }
    if (!running || portInput === null) return;
    const result = await restartServer(portInput);
    if (result?.success) setPortInput(null);
  }, [portInput, port, running, restartServer]);

  const handlePortKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.target.blur();
    }
  }, []);

  const handleCopyToken = useCallback(async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [token]);

  const formatUptime = (seconds) => {
    if (!seconds || seconds < 1) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const statusColor = running
    ? "bg-green-500"
    : error
      ? "bg-red-500"
      : "bg-gray-500";
  const statusLabel = running ? "Running" : error ? "Error" : "Stopped";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 opacity-50">
        <span className="text-sm">Loading MCP Server settings…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6">
      {/* Server Toggle */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="MCP Server" padding={false} />
        <div className="flex flex-row items-center justify-between py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Enable MCP Server</span>
            <span className="text-xs opacity-50">
              Expose dashboards, widgets, and themes to external LLM clients via
              MCP protocol
            </span>
          </div>
          <Switch checked={running} onChange={handleToggle} />
        </div>
      </div>

      {/* Tasks via MCP: the phrase an agent gives before a team starts. */}
      <TaskPassphraseSection workspaces={workspaces} />

      {/* Which tools clients are offered, the bot tools first (DASH-37). */}
      <McpToolsSection workspaces={workspaces} />

      {/* Status */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Status" padding={false} />
        <div className="flex flex-row items-center space-x-3 py-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor}`}
          />
          <span className="text-sm font-medium">{statusLabel}</span>
          {running && (
            <span className="text-xs opacity-50">on port {port}</span>
          )}
        </div>
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Port Configuration */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Configuration" padding={false} />
        <div className="flex flex-row items-center justify-between py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Port</span>
            <span className="text-xs opacity-50">
              {running
                ? "Changes take effect on restart"
                : "Port the server listens on"}
            </span>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={displayPort}
            onChange={handlePortChange}
            onBlur={handlePortBlur}
            onKeyDown={handlePortKeyDown}
            className="w-24 text-right text-sm bg-white/5 border border-white/10 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-white/30"
          />
        </div>
      </div>

      {/* Bearer Token */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Authentication" padding={false} />
        <div className="flex flex-col space-y-2 py-3">
          <div className="flex flex-row items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Bearer Token</span>
              <span className="text-xs opacity-50">
                Required for client authentication
              </span>
            </div>
            <Button
              title={tokenCopied ? "Copied!" : "Copy"}
              onClick={handleCopyToken}
            />
          </div>
          {token && (
            <div className="font-mono text-xs bg-black/20 rounded px-3 py-2 break-all select-all opacity-70">
              {token}
            </div>
          )}
        </div>
      </div>

      {/* Server Info (when running) */}
      {running && (
        <div className="flex flex-col space-y-3">
          <SubHeading3 title="Server Info" padding={false} />
          <DataList>
            <DataList.Item
              label="Connections"
              value={String(connectionCount)}
            />
            <DataList.Item label="Tools" value={String(toolCount)} />
            <DataList.Item label="Resources" value={String(resourceCount)} />
            <DataList.Item
              label="Uptime"
              value={formatUptime(uptime)}
              divider={false}
            />
          </DataList>
        </div>
      )}

      {/* Connect Claude on this computer: the https address, with Dash's
          own certificate trusted (it only speaks https). */}
      {running && token ? (
        <ConnectClaude port={port} token={token} certPath={certPath} />
      ) : null}
    </div>
  );
};
