import { useContext, useState, useCallback, useEffect, useRef } from "react";
import { AppContext } from "../Context/App/AppContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";
import { WidgetContext } from "../Context/WidgetContext";

/**
 * Module-level shared state for MCP server connections.
 * Prevents multiple hook instances (e.g., 4 widgets using "slack") from
 * each firing their own IPC startServer call.
 *
 * serverStates: tracks connection result + consumer reference count per server
 * pendingConnects: deduplicates in-flight IPC calls so only 1 fires per server
 */
const serverStates = new Map();
// Map<serverName, { status, tools, resources, consumerCount }>

const pendingConnects = new Map();
// Map<serverName, Promise<result>>

/**
 * useMcpProvider Hook
 *
 * Provides access to an MCP server's tools and resources for a widget.
 * Handles connection lifecycle, tool scoping, and error handling.
 *
 * @param {string} providerType - The MCP provider type (e.g., "github", "slack")
 * @param {Object} options - Optional configuration
 * @param {boolean} options.autoConnect - Whether to auto-connect on mount (default: true)
 *
 * @returns {Object} MCP provider interface:
 *   - isConnected: boolean
 *   - isConnecting: boolean
 *   - error: string | null
 *   - tools: Array - Available tools (filtered by allowedTools if specified)
 *   - callTool: (toolName, args) => Promise - Call an MCP tool
 *   - resources: Array - Available resources
 *   - readResource: (uri) => Promise - Read a resource
 *   - connect: () => Promise - Manually connect to the server
 *   - disconnect: () => Promise - Manually disconnect from the server
 *   - status: string - Server status
 *
 * @example
 * function MyWidget() {
 *   const { callTool, tools, isConnected, error } = useMcpProvider("github");
 *
 *   if (!isConnected) return <p>Connecting to GitHub...</p>;
 *   if (error) return <p>Error: {error}</p>;
 *
 *   const handleSearch = async () => {
 *     const result = await callTool("search_repositories", { query: "react" });
 *     console.log(result);
 *   };
 * }
 */
export const useMcpProvider = (providerType, options = {}) => {
  const { autoConnect = true } = options;

  const app = useContext(AppContext);
  const workspace = useContext(WorkspaceContext);
  const widgetContext = useContext(WidgetContext);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [tools, setTools] = useState([]);
  const [resources, setResources] = useState([]);
  const [status, setStatus] = useState("disconnected");

  const connectedRef = useRef(false);
  const mountedRef = useRef(true);
  const dashApi = app?.dashApi;

  // Get the widget data and compute effective allowed tools
  const widgetData = widgetContext?.widgetData;

  // Get the selected MCP provider for this widget. Resolution chain,
  // highest priority first:
  //   1. Widget-level     — layoutItem.selectedProviders[type]
  //   2. Workspace-level  — workspace.selectedProviders[widgetId][type]
  //   3. App default      — any provider of matching type flagged
  //                         isDefaultForType in app.providers (managed via
  //                         Settings → Providers "Use as default…" toggle)
  //   4. null             — will render MissingProviderPrompt
  // Existing widgets/workspaces retain their explicit bindings — the
  // default layer only activates for widgets with no explicit binding.
  const widgetId = widgetData?.uuidString;
  const selectedProviderName = (() => {
    // Widget-level: stored directly on the layout item
    if (widgetData?.selectedProviders?.[providerType]) {
      return widgetData.selectedProviders[providerType];
    }
    // Workspace-level: stored as workspace.selectedProviders[widgetId][providerType]
    if (
      widgetId &&
      workspace?.workspaceData?.selectedProviders?.[widgetId]?.[providerType]
    ) {
      return workspace.workspaceData.selectedProviders[widgetId][providerType];
    }
    // App-level default for this provider type. `app.providers` is a
    // map keyed by provider name, so walk its entries.
    const appProviders = app?.providers;
    if (appProviders && typeof appProviders === "object") {
      for (const [name, data] of Object.entries(appProviders)) {
        if (
          data?.type === providerType &&
          data?.isDefaultForType === true
        ) {
          return name;
        }
      }
    }
    return null;
  })();

  // Get the provider data (including mcpConfig and credentials)
  // Read from AppContext.providers (not DashboardContext, which has a structural
  // issue where providers don't flow through from AppWrapper)
  const provider = selectedProviderName
    ? app?.providers?.[selectedProviderName]
    : null;

  // Merge widget-declared allowedTools with user-configured allowedTools (intersection)
  const effectiveAllowedTools = (() => {
    // Widget-declared (from .dash.js providers[].allowedTools)
    const widgetAllowed = (() => {
      if (!widgetData?.providers) return null;
      const p = widgetData.providers.find(
        (p) => p.type === providerType && p.providerClass === "mcp",
      );
      return p?.allowedTools || null;
    })();
    // User-configured (from saved provider object)
    const userAllowed = provider?.allowedTools || null;
    // Intersection
    if (!widgetAllowed && !userAllowed) return null;
    if (!widgetAllowed) return userAllowed;
    if (!userAllowed) return widgetAllowed;
    return widgetAllowed.filter((t) => userAllowed.includes(t));
  })();

  /**
   * Apply connection result to this hook instance's local state.
   * Filters tools by effectiveAllowedTools if specified.
   */
  const applyResult = useCallback(
    (result) => {
      if (!mountedRef.current) return;

      let serverTools = result.tools || [];
      if (effectiveAllowedTools) {
        serverTools = serverTools.filter((tool) =>
          effectiveAllowedTools.includes(tool.name),
        );
      }

      setTools(serverTools);
      setResources(result.resources || []);
      setIsConnected(true);
      setIsConnecting(false);
      setStatus("connected");
      connectedRef.current = true;
    },
    [effectiveAllowedTools],
  );

  /**
   * Connect to the MCP server.
   * Uses module-level deduplication so only one IPC call fires per server,
   * even when multiple hook instances call connect() simultaneously.
   */
  const connect = useCallback(async () => {
    if (connectedRef.current) return;

    if (!dashApi || !provider) {
      setError(
        !provider
          ? `No ${providerType} MCP provider selected for this widget`
          : "Dashboard API not available",
      );
      return;
    }

    if (provider.providerClass !== "mcp") {
      setError(`Provider "${selectedProviderName}" is not an MCP provider`);
      return;
    }

    if (!provider.mcpConfig) {
      setError(`Provider "${selectedProviderName}" has no MCP configuration`);
      return;
    }

    // 1. Already connected at module level? Verify with main process before trusting cache.
    //    The server may have been stopped externally (e.g., Test Connection in settings).
    const cached = serverStates.get(selectedProviderName);
    if (cached && cached.status === "connected") {
      try {
        const statusResult = await new Promise((resolve, reject) => {
          dashApi.mcpGetServerStatus(
            selectedProviderName,
            (event, result) => resolve(result),
            (event, err) => reject(err),
          );
        });
        if (statusResult?.status === "connected") {
          cached.consumerCount++;
          applyResult(cached);
          return;
        }
        // Server was stopped externally — clear stale cache and reconnect
        serverStates.delete(selectedProviderName);
      } catch {
        serverStates.delete(selectedProviderName);
      }
    }

    setIsConnecting(true);
    setError(null);

    // 2. Another hook instance already connecting? Piggyback on its promise
    if (pendingConnects.has(selectedProviderName)) {
      try {
        const result = await pendingConnects.get(selectedProviderName);
        if (!mountedRef.current) return;

        if (result.error) {
          setError(result.message);
          setIsConnecting(false);
          setStatus("error");
          return;
        }

        // Increment consumer count and apply
        const state = serverStates.get(selectedProviderName);
        if (state) state.consumerCount++;
        applyResult(result);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err?.message || "Failed to connect to MCP server");
        setIsConnecting(false);
        setStatus("error");
      }
      return;
    }

    // 3. First caller — fire the IPC call and share the promise
    const connectPromise = new Promise((resolve, reject) => {
      dashApi.mcpStartServer(
        selectedProviderName,
        provider.mcpConfig,
        provider.credentials,
        (event, result) => {
          pendingConnects.delete(selectedProviderName);

          if (result.error) {
            serverStates.set(selectedProviderName, {
              status: "error",
              tools: [],
              resources: [],
              consumerCount: 0,
            });
            resolve(result); // resolve (not reject) so piggybacking callers get the result
            return;
          }

          // Store in module-level shared state
          serverStates.set(selectedProviderName, {
            status: "connected",
            tools: result.tools || [],
            resources: result.resources || [],
            consumerCount: 1,
          });

          resolve(result);
        },
        (event, err) => {
          pendingConnects.delete(selectedProviderName);
          serverStates.set(selectedProviderName, {
            status: "error",
            tools: [],
            resources: [],
            consumerCount: 0,
          });
          reject(err);
        },
      );
    });

    pendingConnects.set(selectedProviderName, connectPromise);

    try {
      const result = await connectPromise;
      if (!mountedRef.current) return;

      if (result.error) {
        setError(result.message);
        setIsConnecting(false);
        setStatus("error");
        return;
      }

      applyResult(result);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err?.message || "Failed to connect to MCP server");
      setIsConnecting(false);
      setStatus("error");
    }
  }, [dashApi, provider, providerType, selectedProviderName, applyResult]);

  /**
   * Disconnect from the MCP server.
   * Only sends the IPC stop call when this is the last consumer.
   */
  const disconnect = useCallback(async () => {
    if (!dashApi || !selectedProviderName) return;

    const state = serverStates.get(selectedProviderName);
    if (state) {
      state.consumerCount = Math.max(0, state.consumerCount - 1);

      if (state.consumerCount > 0) {
        // Other widgets still using this server — just update local state
        setIsConnected(false);
        setTools([]);
        setResources([]);
        setStatus("disconnected");
        connectedRef.current = false;
        return;
      }

      // Last consumer — actually stop the server
      serverStates.delete(selectedProviderName);
    }

    // Clear state synchronously BEFORE the IPC call so that
    // a subsequent connect() won't short-circuit on stale connectedRef
    setIsConnected(false);
    setTools([]);
    setResources([]);
    setStatus("disconnected");
    connectedRef.current = false;
    pendingConnects.delete(selectedProviderName);

    return new Promise((resolve) => {
      dashApi.mcpStopServer(
        selectedProviderName,
        () => resolve(),
        (event, err) => {
          console.error("[useMcpProvider] Error disconnecting:", err?.message);
          resolve();
        },
      );
    });
  }, [dashApi, selectedProviderName]);

  /**
   * Call a tool on the MCP server
   */
  const callTool = useCallback(
    async (toolName, args = {}) => {
      if (!dashApi || !selectedProviderName) {
        throw new Error("MCP server not connected");
      }

      // Client-side tool scoping check
      if (effectiveAllowedTools && !effectiveAllowedTools.includes(toolName)) {
        // Provide enhanced error if the tool is in widget's requiredTools
        const widgetRequiredTools = (() => {
          if (!widgetData?.providers) return null;
          const p = widgetData.providers.find(
            (p) => p.type === providerType && p.providerClass === "mcp",
          );
          return p?.requiredTools || null;
        })();
        const isRequired = widgetRequiredTools?.includes(toolName);
        throw new Error(
          `Tool "${toolName}" is not allowed for this widget. Allowed tools: ${effectiveAllowedTools.join(
            ", ",
          )}${isRequired ? `. Note: "${toolName}" is declared as a required tool by this widget — update the provider's allowed tools in Settings → Providers.` : ""}`,
        );
      }

      console.log(`[useMcpProvider] Calling tool: ${toolName}`, args);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Tool call "${toolName}" timed out after 30s`));
        }, 30000);

        dashApi.mcpCallTool(
          selectedProviderName,
          toolName,
          args,
          effectiveAllowedTools,
          (event, result) => {
            clearTimeout(timeout);
            console.log(
              `[useMcpProvider] Tool result for ${toolName}:`,
              result,
            );
            if (result.error) {
              reject(new Error(result.message));
            } else {
              resolve(result.result);
            }
          },
          (event, err) => {
            clearTimeout(timeout);
            reject(new Error(err?.message || "Failed to call MCP tool"));
          },
        );
      });
    },
    [
      dashApi,
      selectedProviderName,
      effectiveAllowedTools,
      widgetData,
      providerType,
    ],
  );

  /**
   * Read a resource from the MCP server
   */
  const readResource = useCallback(
    async (uri) => {
      if (!dashApi || !selectedProviderName) {
        throw new Error("MCP server not connected");
      }

      return new Promise((resolve, reject) => {
        dashApi.mcpReadResource(
          selectedProviderName,
          uri,
          (event, result) => {
            if (result.error) {
              reject(new Error(result.message));
            } else {
              resolve(result.resource);
            }
          },
          (event, err) => {
            reject(new Error(err?.message || "Failed to read MCP resource"));
          },
        );
      });
    },
    [dashApi, selectedProviderName],
  );

  // Keep a ref to connect so the auto-connect effect doesn't depend on it
  const connectRef = useRef(connect);
  connectRef.current = connect;

  // Auto-connect on mount or when provider selection changes
  useEffect(() => {
    if (autoConnect && selectedProviderName && !connectedRef.current) {
      connectRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, selectedProviderName]);

  // Track mounted state and cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Decrement consumer count; only stop server if last consumer
      if (connectedRef.current && dashApi && selectedProviderName) {
        const state = serverStates.get(selectedProviderName);
        if (state) {
          state.consumerCount = Math.max(0, state.consumerCount - 1);

          if (state.consumerCount > 0) {
            // Other widgets still using this server — don't stop it
            return;
          }

          // Last consumer — stop the server
          serverStates.delete(selectedProviderName);
        }

        dashApi.mcpStopServer(
          selectedProviderName,
          () => {},
          () => {},
        );
      }
    };
  }, [dashApi, selectedProviderName]);

  return {
    isConnected,
    isConnecting,
    error,
    tools,
    callTool,
    resources,
    readResource,
    connect,
    disconnect,
    status,
    provider,
    serverName: selectedProviderName,
  };
};
