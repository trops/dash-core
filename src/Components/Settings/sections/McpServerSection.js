import React, { useState, useCallback } from "react";
import {
  Switch,
  SubHeading3,
  Button,
  DataList,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { useMcpDashServer } from "../../../hooks/useMcpDashServer";

/**
 * McpServerSection
 *
 * Settings section for controlling the hosted MCP Dash server.
 * Provides toggle, port configuration, status indicator, token display,
 * and connection stats.
 */
export const McpServerSection = () => {
  const {
    running,
    port,
    connectionCount,
    uptime,
    toolCount,
    resourceCount,
    token,
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
        await startServer(displayPort);
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

  const handlePortBlur = useCallback(async () => {
    if (
      portInput !== null &&
      portInput !== "" &&
      portInput !== port &&
      running
    ) {
      await restartServer(portInput);
    }
    setPortInput(null);
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

      {/* Claude Desktop Config Hint */}
      {running && token && (
        <div className="flex flex-col space-y-3">
          <SubHeading3 title="Client Configuration" padding={false} />
          <span className="text-xs opacity-50">
            Add to your MCP client config (e.g. Claude Desktop):
          </span>
          <pre className="text-xs bg-black/20 rounded p-3 overflow-auto max-h-40 select-all">
            {JSON.stringify(
              {
                mcpServers: {
                  dash: {
                    url: `http://127.0.0.1:${port}/mcp`,
                    headers: {
                      Authorization: `Bearer ${token}`,
                    },
                  },
                },
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
};
