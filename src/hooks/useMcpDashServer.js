import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useMcpDashServer
 *
 * React hook for controlling and monitoring the hosted MCP Dash server.
 * Accesses window.mainApi.mcpDashServer for IPC calls to the main process.
 *
 * Returns server status, control functions (start/stop/restart), token, and port.
 * Polls status every 3 seconds while mounted.
 */
export function useMcpDashServer() {
  const [status, setStatus] = useState({
    running: false,
    enabled: false,
    port: 3141,
    connectionCount: 0,
    uptime: 0,
    toolCount: 0,
    resourceCount: 0,
  });
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const api = window.mainApi?.mcpDashServer;

  const fetchStatus = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.getStatus();
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to get server status");
    }
  }, [api]);

  const fetchToken = useCallback(async () => {
    if (!api) return;
    try {
      const t = await api.getToken();
      setToken(t);
    } catch (err) {
      // Token fetch failed — non-critical
    }
  }, [api]);

  // Initial load
  useEffect(() => {
    if (!api) {
      setLoading(false);
      return;
    }
    Promise.all([fetchStatus(), fetchToken()]).then(() => setLoading(false));
  }, [api, fetchStatus, fetchToken]);

  // Poll status every 3 seconds
  useEffect(() => {
    if (!api) return;
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, [api, fetchStatus]);

  const startServer = useCallback(
    async (port) => {
      if (!api) return;
      setError(null);
      try {
        const result = await api.startServer(port);
        if (!result.success) {
          setError(result.error || "Failed to start server");
        }
        await fetchStatus();
        return result;
      } catch (err) {
        setError(err.message || "Failed to start server");
      }
    },
    [api, fetchStatus],
  );

  const stopServer = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const result = await api.stopServer();
      if (!result.success) {
        setError(result.error || "Failed to stop server");
      }
      await fetchStatus();
      return result;
    } catch (err) {
      setError(err.message || "Failed to stop server");
    }
  }, [api, fetchStatus]);

  const restartServer = useCallback(
    async (port) => {
      await stopServer();
      return startServer(port);
    },
    [stopServer, startServer],
  );

  return {
    // Status
    running: status.running,
    enabled: status.enabled,
    port: status.port,
    connectionCount: status.connectionCount,
    uptime: status.uptime,
    toolCount: status.toolCount,
    resourceCount: status.resourceCount,
    token,
    loading,
    error,

    // Actions
    startServer,
    stopServer,
    restartServer,
    refreshStatus: fetchStatus,
  };
}
