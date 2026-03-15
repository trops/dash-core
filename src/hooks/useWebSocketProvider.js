import { useContext, useState, useCallback, useEffect, useRef } from "react";
import { AppContext } from "../Context/App/AppContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";
import { WidgetContext } from "../Context/WidgetContext";

/**
 * Module-level shared state for WebSocket connections.
 * Prevents multiple hook instances (e.g., 4 widgets using the same WS provider)
 * from each firing their own IPC connect call.
 *
 * connectionStates: tracks connection status + consumer reference count per provider
 * pendingConnects: deduplicates in-flight IPC calls so only 1 fires per provider
 */
const connectionStates = new Map();
// Map<providerName, { status, consumerCount }>

const pendingConnects = new Map();
// Map<providerName, Promise<result>>

const STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

/**
 * useWebSocketProvider Hook
 *
 * Provides access to a WebSocket connection for a widget.
 * Handles connection lifecycle, shared-connection ref counting,
 * message buffering, and bidirectional communication.
 *
 * Mirrors useMcpProvider.js patterns exactly:
 * - Module-level Maps (not component state) for connection sharing
 * - consumerCount determines socket lifecycle
 * - pendingConnects prevents duplicate connect calls during mount storms
 *
 * @param {string} providerType - The WebSocket provider type (e.g., "crypto-ws")
 * @param {Object} options - Optional configuration
 * @param {boolean} options.autoConnect - Whether to auto-connect on mount (default: true)
 * @param {number} options.maxMessages - Max messages in buffer (default: 100)
 *
 * @returns {Object} WebSocket provider interface
 */
export const useWebSocketProvider = (providerType, options = {}) => {
  const { autoConnect = true, maxMessages = 100 } = options;

  const app = useContext(AppContext);
  const workspace = useContext(WorkspaceContext);
  const widgetContext = useContext(WidgetContext);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(STATUS.DISCONNECTED);

  const connectedRef = useRef(false);
  const mountedRef = useRef(true);
  const messagesRef = useRef([]);
  const maxMessagesRef = useRef(maxMessages);
  maxMessagesRef.current = maxMessages;

  const dashApi = app?.dashApi;

  // Get the widget data
  const widgetData = widgetContext?.widgetData;

  // Get the selected WebSocket provider for this widget
  // Same two-layer lookup as useMcpProvider:
  // 1. Widget-level: stored directly on the layout item
  // 2. Workspace-level: stored as workspace.selectedProviders[widgetId][providerType]
  const widgetId = widgetData?.uuidString;
  const selectedProviderName = (() => {
    if (widgetData?.selectedProviders?.[providerType]) {
      return widgetData.selectedProviders[providerType];
    }
    if (
      widgetId &&
      workspace?.workspaceData?.selectedProviders?.[widgetId]?.[providerType]
    ) {
      return workspace.workspaceData.selectedProviders[widgetId][providerType];
    }
    return null;
  })();

  // Get the provider data (including credentials)
  // Read from AppContext.providers (not DashboardContext)
  const provider = selectedProviderName
    ? app?.providers?.[selectedProviderName]
    : null;

  /**
   * Apply connection result to this hook instance's local state.
   */
  const applyConnected = useCallback(() => {
    if (!mountedRef.current) return;
    setIsConnected(true);
    setIsConnecting(false);
    setStatus(STATUS.CONNECTED);
    connectedRef.current = true;
  }, []);

  /**
   * Connect to the WebSocket server.
   * Uses module-level deduplication so only one IPC call fires per provider,
   * even when multiple hook instances call connect() simultaneously.
   */
  const connect = useCallback(async () => {
    if (connectedRef.current) return;

    if (!dashApi?.webSocket || !provider) {
      setError(
        !provider
          ? `No ${providerType} WebSocket provider selected for this widget`
          : "Dashboard API not available",
      );
      return;
    }

    if (provider.providerClass !== "websocket") {
      setError(
        `Provider "${selectedProviderName}" is not a WebSocket provider`,
      );
      return;
    }

    if (!provider.wsConfig?.url) {
      setError(
        `Provider "${selectedProviderName}" has no WebSocket URL configured`,
      );
      return;
    }

    // 1. Already connected at module level? Verify with main process.
    const cached = connectionStates.get(selectedProviderName);
    if (cached && cached.status === STATUS.CONNECTED) {
      try {
        const statusResult =
          await dashApi.webSocket.getStatus(selectedProviderName);
        if (statusResult?.status === "connected") {
          cached.consumerCount++;
          applyConnected();
          return;
        }
        // Server was stopped externally — clear stale cache and reconnect
        connectionStates.delete(selectedProviderName);
      } catch {
        connectionStates.delete(selectedProviderName);
      }
    }

    setIsConnecting(true);
    setError(null);
    setStatus(STATUS.CONNECTING);

    // 2. Another hook instance already connecting? Piggyback on its promise
    if (pendingConnects.has(selectedProviderName)) {
      try {
        const result = await pendingConnects.get(selectedProviderName);
        if (!mountedRef.current) return;

        if (result.error) {
          setError(result.message);
          setIsConnecting(false);
          setStatus(STATUS.ERROR);
          return;
        }

        const state = connectionStates.get(selectedProviderName);
        if (state) state.consumerCount++;
        applyConnected();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err?.message || "Failed to connect to WebSocket server");
        setIsConnecting(false);
        setStatus(STATUS.ERROR);
      }
      return;
    }

    // 3. First caller — fire the IPC call and share the promise
    const connectPromise = (async () => {
      try {
        const result = await dashApi.webSocket.connect(selectedProviderName, {
          url: provider.wsConfig.url,
          headers: provider.wsConfig.headers || null,
          subprotocols: provider.wsConfig.subprotocols || null,
          credentials: provider.credentials || null,
        });

        pendingConnects.delete(selectedProviderName);

        if (result.error) {
          connectionStates.set(selectedProviderName, {
            status: STATUS.ERROR,
            consumerCount: 0,
          });
          return result;
        }

        connectionStates.set(selectedProviderName, {
          status: STATUS.CONNECTED,
          consumerCount: 1,
        });

        return result;
      } catch (err) {
        pendingConnects.delete(selectedProviderName);
        connectionStates.set(selectedProviderName, {
          status: STATUS.ERROR,
          consumerCount: 0,
        });
        throw err;
      }
    })();

    pendingConnects.set(selectedProviderName, connectPromise);

    try {
      const result = await connectPromise;
      if (!mountedRef.current) return;

      if (result.error) {
        setError(result.message);
        setIsConnecting(false);
        setStatus(STATUS.ERROR);
        return;
      }

      applyConnected();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err?.message || "Failed to connect to WebSocket server");
      setIsConnecting(false);
      setStatus(STATUS.ERROR);
    }
  }, [dashApi, provider, providerType, selectedProviderName, applyConnected]);

  /**
   * Disconnect from the WebSocket server.
   * Only sends the IPC disconnect call when this is the last consumer.
   */
  const disconnect = useCallback(async () => {
    if (!dashApi?.webSocket || !selectedProviderName) return;

    const state = connectionStates.get(selectedProviderName);
    if (state) {
      state.consumerCount = Math.max(0, state.consumerCount - 1);

      if (state.consumerCount > 0) {
        // Other widgets still using this connection — just update local state
        setIsConnected(false);
        setLastMessage(null);
        setMessages([]);
        messagesRef.current = [];
        setStatus(STATUS.DISCONNECTED);
        connectedRef.current = false;
        return;
      }

      // Last consumer — actually disconnect
      connectionStates.delete(selectedProviderName);
    }

    // Clear state synchronously before the IPC call
    setIsConnected(false);
    setLastMessage(null);
    setMessages([]);
    messagesRef.current = [];
    setStatus(STATUS.DISCONNECTED);
    connectedRef.current = false;
    pendingConnects.delete(selectedProviderName);

    try {
      await dashApi.webSocket.disconnect(selectedProviderName);
    } catch (err) {
      console.error(
        "[useWebSocketProvider] Error disconnecting:",
        err?.message,
      );
    }
  }, [dashApi, selectedProviderName]);

  /**
   * Send data through the WebSocket connection
   */
  const send = useCallback(
    async (data) => {
      if (!dashApi?.webSocket || !selectedProviderName) {
        throw new Error("WebSocket not connected");
      }

      const result = await dashApi.webSocket.send(selectedProviderName, data);
      if (result.error) {
        throw new Error(result.message);
      }
      return result;
    },
    [dashApi, selectedProviderName],
  );

  // Keep a ref to connect so the auto-connect effect doesn't depend on it
  const connectRef = useRef(connect);
  connectRef.current = connect;

  // Listen for incoming messages from main process
  useEffect(() => {
    if (!dashApi?.webSocket || !selectedProviderName) return;

    const handleMessage = (_event, payload) => {
      if (payload.provider !== selectedProviderName) return;
      if (!mountedRef.current) return;

      const msg = payload.data;

      // Update circular buffer
      const next = [...messagesRef.current, msg];
      if (next.length > maxMessagesRef.current) {
        next.splice(0, next.length - maxMessagesRef.current);
      }
      messagesRef.current = next;
      setMessages(next);
      setLastMessage(msg);
    };

    dashApi.webSocket.onMessage(handleMessage);
    return () => dashApi.webSocket.offMessage(handleMessage);
  }, [dashApi, selectedProviderName]);

  // Listen for status changes from main process
  useEffect(() => {
    if (!dashApi?.webSocket || !selectedProviderName) return;

    const handleStatusChange = (_event, payload) => {
      if (payload.provider !== selectedProviderName) return;
      if (!mountedRef.current) return;

      const newStatus = payload.status;
      setStatus(newStatus);

      if (newStatus === STATUS.CONNECTED) {
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        connectedRef.current = true;
      } else if (newStatus === STATUS.DISCONNECTED) {
        setIsConnected(false);
        setIsConnecting(false);
        connectedRef.current = false;
      } else if (newStatus === STATUS.ERROR) {
        setIsConnected(false);
        setIsConnecting(false);
        setError(payload.error || "WebSocket error");
        connectedRef.current = false;
      } else if (newStatus === STATUS.CONNECTING) {
        setIsConnecting(true);
      }
    };

    dashApi.webSocket.onStatusChange(handleStatusChange);
    return () => dashApi.webSocket.offStatusChange(handleStatusChange);
  }, [dashApi, selectedProviderName]);

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

      // Decrement consumer count; only disconnect if last consumer
      if (connectedRef.current && dashApi?.webSocket && selectedProviderName) {
        const state = connectionStates.get(selectedProviderName);
        if (state) {
          state.consumerCount = Math.max(0, state.consumerCount - 1);

          if (state.consumerCount > 0) {
            // Other widgets still using this connection — don't disconnect
            return;
          }

          // Last consumer — disconnect
          connectionStates.delete(selectedProviderName);
        }

        dashApi.webSocket.disconnect(selectedProviderName).catch(() => {});
      }
    };
  }, [dashApi, selectedProviderName]);

  return {
    isConnected,
    isConnecting,
    error,
    lastMessage,
    messages,
    send,
    connect,
    disconnect,
    status,
    provider,
    serverName: selectedProviderName,
  };
};
