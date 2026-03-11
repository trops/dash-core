/**
 * notificationController.js
 *
 * Main process controller for OS-level notifications.
 * Manages preferences (electron-store), rate limiting, deduplication,
 * and dispatching native Notification instances.
 */
const { Notification } = require("electron");
const Store = require("electron-store");

const store = new Store({ name: "dash-notifications" });

// --- Rate limiting ---
// Sliding window: max 10 notifications per 60s per widget
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateBuckets = new Map(); // widgetId -> [timestamp, ...]

// --- Deduplication ---
// Same (widgetName, type, title, body) within 5s is dropped
const DEDUP_WINDOW_MS = 5_000;
const recentNotifications = new Map(); // dedup key -> timestamp

function getDedupKey(payload) {
  return `${payload.widgetName}:${payload.type}:${payload.title}:${payload.body}`;
}

function isRateLimited(widgetId) {
  const now = Date.now();
  let timestamps = rateBuckets.get(widgetId) || [];
  // Prune old entries
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  rateBuckets.set(widgetId, timestamps);
  return timestamps.length >= RATE_LIMIT_MAX;
}

function recordNotification(widgetId) {
  const timestamps = rateBuckets.get(widgetId) || [];
  timestamps.push(Date.now());
  rateBuckets.set(widgetId, timestamps);
}

function isDuplicate(payload) {
  const key = getDedupKey(payload);
  const now = Date.now();
  const lastSent = recentNotifications.get(key);
  if (lastSent && now - lastSent < DEDUP_WINDOW_MS) {
    return true;
  }
  recentNotifications.set(key, now);
  return false;
}

// Clean up stale dedup entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentNotifications) {
    if (now - ts > DEDUP_WINDOW_MS) {
      recentNotifications.delete(key);
    }
  }
}, 30_000);

const notificationController = {
  /**
   * Send a notification if it passes all checks.
   *
   * @param {BrowserWindow} win - the main window (for click routing)
   * @param {Object} payload
   * @param {string} payload.widgetName - component name of the widget
   * @param {string} payload.widgetId - widget instance UUID
   * @param {string} payload.workspaceId - workspace containing the widget
   * @param {string} payload.type - notification type key (must match .dash.js config)
   * @param {string} payload.title - notification title
   * @param {string} payload.body - notification body
   * @param {Object} [payload.data] - arbitrary data returned on click
   * @param {boolean} [payload.silent] - suppress sound
   * @param {string} [payload.urgency] - "low" | "normal" | "critical"
   * @returns {{ success: boolean, reason?: string }}
   */
  send: (win, payload) => {
    try {
      const {
        widgetName,
        widgetId,
        workspaceId,
        type,
        title,
        body,
        data,
        silent,
        urgency,
      } = payload;

      // 1. Check globalEnabled
      const globalEnabled = store.get("globalEnabled", true);
      if (!globalEnabled) {
        return { success: false, reason: "notifications_disabled" };
      }

      // 2. Check doNotDisturb
      const dnd = store.get("doNotDisturb", false);
      if (dnd) {
        return { success: false, reason: "do_not_disturb" };
      }

      // 3. Check per-widget per-type preference
      const instances = store.get("instances", {});
      const widgetPrefs = instances[widgetId];
      if (widgetPrefs && widgetPrefs[type] === false) {
        return { success: false, reason: "type_disabled" };
      }

      // 4. Rate limit
      if (isRateLimited(widgetId)) {
        return { success: false, reason: "rate_limited" };
      }

      // 5. Deduplication
      if (isDuplicate(payload)) {
        return { success: false, reason: "duplicate" };
      }

      // 6. All checks passed — send native notification
      const notification = new Notification({
        title,
        body,
        silent: silent || false,
        urgency: urgency || "normal",
      });

      notification.on("click", () => {
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
          win.webContents.send("notification:clicked", {
            widgetName,
            widgetId,
            workspaceId,
            type,
            data: data || null,
          });
        }
      });

      notification.show();
      recordNotification(widgetId);

      console.log(
        `[notificationController] Sent: ${widgetName}.${type} — "${title}"`,
      );

      return { success: true };
    } catch (error) {
      console.error(
        "[notificationController] Error sending notification:",
        error,
      );
      return { error: true, message: error.message };
    }
  },

  /**
   * Get all notification preferences.
   *
   * @returns {{ globalEnabled: boolean, doNotDisturb: boolean, instances: Object }}
   */
  getPreferences: () => {
    try {
      return {
        globalEnabled: store.get("globalEnabled", true),
        doNotDisturb: store.get("doNotDisturb", false),
        instances: store.get("instances", {}),
      };
    } catch (error) {
      console.error(
        "[notificationController] Error getting preferences:",
        error,
      );
      return {
        error: true,
        message: error.message,
        globalEnabled: true,
        doNotDisturb: false,
        instances: {},
      };
    }
  },

  /**
   * Set notification preferences for a specific widget instance.
   *
   * @param {string} widgetId - widget instance UUID
   * @param {Object} prefs - { [notificationType]: boolean }
   * @returns {{ success: boolean }}
   */
  setPreferences: (widgetId, prefs) => {
    try {
      const instances = store.get("instances", {});
      instances[widgetId] = { ...(instances[widgetId] || {}), ...prefs };
      store.set("instances", instances);
      console.log(
        `[notificationController] Preferences updated for widget ${widgetId}`,
      );
      return { success: true };
    } catch (error) {
      console.error(
        "[notificationController] Error setting preferences:",
        error,
      );
      return { error: true, message: error.message };
    }
  },

  /**
   * Set global notification settings.
   *
   * @param {Object} settings
   * @param {boolean} [settings.globalEnabled]
   * @param {boolean} [settings.doNotDisturb]
   * @returns {{ success: boolean }}
   */
  setGlobal: (settings) => {
    try {
      if (typeof settings.globalEnabled === "boolean") {
        store.set("globalEnabled", settings.globalEnabled);
      }
      if (typeof settings.doNotDisturb === "boolean") {
        store.set("doNotDisturb", settings.doNotDisturb);
      }
      console.log(
        "[notificationController] Global settings updated:",
        settings,
      );
      return { success: true };
    } catch (error) {
      console.error("[notificationController] Error setting global:", error);
      return { error: true, message: error.message };
    }
  },
};

module.exports = notificationController;
