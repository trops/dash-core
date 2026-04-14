/**
 * DashboardPublisher
 * - Pub/Sub for the Dashboard
 */
import { isObject } from "@trops/dash-react";

const event = {
  list: new Map(),

  //  Map(1) { '<widget-UUID>' => { 'CustomSearchbar[10].searchQueryChanged': [] } }

  /**
   * on
   *
   * Register a unique event to a unique widget
   * Widgets can ONLY listen to an event ONCE, you cannot have
   * multiple handlers in the same widget.
   *
   * @param {string} eventType the unique event type for a widget
   * @param {*} eventAction the handler for the event type
   * @param {*} uuid the UUID of the widget listening
   * @returns
   */
  on(eventType, eventAction, uuid = null) {
    this.list.has(eventType) || this.list.set(eventType, []);
    // this.list.has(uuid) || this.list.set(uuid, {});
    if (this.list.get(eventType)) {
      // this is key:value pair mapping
      // each key is a widget UUID
      let currentActionsForEvent = this.list.get(eventType);

      // lets check to see if the UUID is available for the event type...
      let hasEvent = false;
      currentActionsForEvent.forEach((e, index) => {
        if (e.uuid === uuid) {
          hasEvent = index;
        }
      });

      // if we have a match at the index, lets remove it
      // and replace with the new one
      if (hasEvent !== false) currentActionsForEvent.splice(hasEvent, 1);

      // if (hasEvent === false) {
      const eventObject = {
        uuid: uuid,
        action: eventAction,
      };
      currentActionsForEvent.push(eventObject);
      this.list.set(eventType, currentActionsForEvent);
      // }
    }
    return this;
  },

  // publish events...
  emit(eventType, ...args) {
    const subscriptionsToEvent = this.list.get(eventType);
    if (subscriptionsToEvent && subscriptionsToEvent.length > 0) {
      subscriptionsToEvent.forEach((subscriber) => {
        console.log("calling handler ", subscriber["uuid"], args, subscriber);
        const objectToSend = {
          message: args[0],
          event: eventType,
          uuid: subscriber["uuid"],
        };
        console.log("SEND ", objectToSend);
        if ("action" in subscriber && subscriber.action !== undefined) {
          subscriber["action"]({ ...objectToSend });
        }
      });
    }
  },

  clear() {
    this.list = new Map();
  },
};

let ipcBridgeListener = null;
const monitorCallbacks = new Set();

// Cache of last-seen event payloads by eventType. Used to replay the most
// recent value to late subscribers in popout windows — so a widget rendered
// in a popout can hydrate from current state without requiring the event to
// re-fire. Populated on-demand by enableIpcBridge({ replay: true }) and kept
// current via pub() and the broadcast listener.
const lastEventCache = new Map();
// Replay is opt-in per window to avoid resurrecting stale or command-style
// events when the main dashboard is reopened. Popout windows set this true;
// the main window leaves it false.
let replayEnabled = false;

export const DashboardPublisher = {
  sub: (eventType, action, uuid) => {
    event.on(eventType, action, uuid);

    // Replay last known payload to this subscriber so popouts can hydrate
    // from current state without needing the event to re-fire. Only active
    // in windows that opted in via enableIpcBridge({ replay: true }).
    if (
      replayEnabled &&
      lastEventCache.has(eventType) &&
      typeof action === "function"
    ) {
      const cached = lastEventCache.get(eventType);
      // Defer so the caller finishes wiring up before the handler runs.
      setTimeout(() => {
        try {
          action({
            message: cached.content,
            event: eventType,
            uuid,
            replay: true,
          });
        } catch (_) {
          // Replay must not break subscription
        }
      }, 0);
    }
  },
  pub: (eventType, content) => {
    lastEventCache.set(eventType, { content, timestamp: Date.now() });
    event.emit(eventType, content);

    // Notify monitor callbacks (debugger)
    if (monitorCallbacks.size > 0) {
      const subscriberCount = (event.list.get(eventType) || []).length;
      const monitorData = {
        eventType,
        content,
        timestamp: Date.now(),
        subscriberCount,
      };
      monitorCallbacks.forEach((cb) => {
        try {
          cb(monitorData);
        } catch (_) {
          // Monitor callbacks must not break event delivery
        }
      });
    }

    // Forward to other windows via IPC bridge
    if (window.mainApi?.widgetEvent) {
      window.mainApi.widgetEvent.publish(eventType, content);
    }
  },

  onMonitor: (callback) => {
    monitorCallbacks.add(callback);
    return () => monitorCallbacks.delete(callback);
  },

  enableIpcBridge: (options = {}) => {
    if (ipcBridgeListener) return;
    if (!window.mainApi?.on) return;

    const { replay = false } = options;
    replayEnabled = replay;

    ipcBridgeListener = (_e, message) => {
      if (replayEnabled && message && message.eventType) {
        lastEventCache.set(message.eventType, {
          content: message.content,
          timestamp: Date.now(),
        });
      }
      event.emit(message.eventType, message.content);
    };
    window.mainApi.on("widget-event:broadcast", ipcBridgeListener);

    // Hydrate this window's cache from the main-process cache so that
    // widgets mounted in a fresh window (popout) can replay events that
    // fired before this window existed. Only for windows that opted in.
    if (replayEnabled && window.mainApi?.widgetEvent?.getLastEvents) {
      window.mainApi.widgetEvent
        .getLastEvents()
        .then((events) => {
          if (events && typeof events === "object") {
            for (const [eventType, entry] of Object.entries(events)) {
              const existing = lastEventCache.get(eventType);
              if (!existing || existing.timestamp < (entry.timestamp || 0)) {
                lastEventCache.set(eventType, entry);
              }
            }
          }
        })
        .catch(() => {});
    }
  },

  disableIpcBridge: () => {
    if (!ipcBridgeListener) return;
    if (window.mainApi?.removeListener) {
      window.mainApi.removeListener(
        "widget-event:broadcast",
        ipcBridgeListener,
      );
    }
    ipcBridgeListener = null;
    replayEnabled = false;
  },

  listeners: () => event.list,

  registerListeners: (listeners, handlerMap, uuid) => {
    if (listeners !== undefined) {
      if (isObject(listeners) === true) {
        Object.keys(listeners).forEach((handlerKey) => {
          if (handlerKey in listeners) {
            const events = listeners[handlerKey];
            if (!Array.isArray(events)) return;
            events.forEach((event) => {
              // subscribe our listeners
              DashboardPublisher.sub(event, handlerMap[handlerKey], uuid);
            });
          }
        });
      }
    }
  },

  removeAllListeners: () => {
    // we want to begin fresh when we switch workspaces...
    // event = new Map();
    //event.clear();
  },

  clearAllMessage: () => {
    event.emit("clearAllMessage");
  },
};
