import React, { useState, useEffect, useRef, useCallback } from "react";
import { LayoutContainer } from "../../Components/Layout";
import { DashboardPublisher } from "../../DashboardPublisher";

const MAX_LOG_ENTRIES = 200;

function truncateJson(obj, maxLen = 120) {
  try {
    const str = JSON.stringify(obj);
    return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
  } catch {
    return String(obj);
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function parseEventType(eventType) {
  const match = eventType.match(/^(.+)\[(\d+)\]\.(.+)$/);
  if (match) {
    return { widget: match[1], id: match[2], event: match[3] };
  }
  return { widget: "", id: "", event: eventType };
}

export const DashboardMonitor = () => {
  const [eventLog, setEventLog] = useState([]);
  const [activeTab, setActiveTab] = useState("log");
  const [subscriptions, setSubscriptions] = useState([]);
  const logEndRef = useRef(null);

  const refreshSubscriptions = useCallback(() => {
    const listenerMap = DashboardPublisher.listeners();
    const subs = [];
    listenerMap.forEach((subscribers, eventType) => {
      subs.push({
        eventType,
        parsed: parseEventType(eventType),
        subscriberCount: subscribers.length,
        uuids: subscribers.map((s) => s.uuid),
      });
    });
    setSubscriptions(subs);
  }, []);

  useEffect(() => {
    const unsub = DashboardPublisher.onMonitor((data) => {
      setEventLog((prev) => {
        const next = [
          ...prev,
          { ...data, parsed: parseEventType(data.eventType) },
        ];
        return next.length > MAX_LOG_ENTRIES
          ? next.slice(-MAX_LOG_ENTRIES)
          : next;
      });
      refreshSubscriptions();
    });

    refreshSubscriptions();
    return unsub;
  }, [refreshSubscriptions]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [eventLog]);

  const clearLog = () => setEventLog([]);

  return (
    <LayoutContainer direction="col" scrollable={true}>
      <div className="flex flex-col w-full h-full text-xs font-mono">
        {/* Tabs */}
        <div className="flex flex-row items-center border-b border-gray-700 px-2 py-1 gap-2 shrink-0">
          <span className="text-gray-400 font-semibold uppercase text-[10px] mr-2">
            Event Monitor
          </span>
          <button
            className={`px-2 py-0.5 rounded text-[10px] ${activeTab === "log" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
            onClick={() => setActiveTab("log")}
          >
            Event Log ({eventLog.length})
          </button>
          <button
            className={`px-2 py-0.5 rounded text-[10px] ${activeTab === "subs" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
            onClick={() => {
              setActiveTab("subs");
              refreshSubscriptions();
            }}
          >
            Subscriptions ({subscriptions.length})
          </button>
          {activeTab === "log" && eventLog.length > 0 && (
            <button
              className="ml-auto px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-red-400"
              onClick={clearLog}
            >
              Clear
            </button>
          )}
        </div>

        {/* Event Log Tab */}
        {activeTab === "log" && (
          <div className="flex flex-col overflow-y-auto flex-1 p-1 gap-0.5">
            {eventLog.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-500 text-[11px]">
                No events published yet. Interact with widgets to see events
                here.
              </div>
            )}
            {eventLog.map((entry, i) => (
              <div
                key={i}
                className="flex flex-col px-2 py-1 rounded bg-gray-800/50 hover:bg-gray-800"
              >
                <div className="flex flex-row items-center gap-2">
                  <span className="text-gray-500 shrink-0">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span className="text-blue-400 font-medium shrink-0">
                    {entry.parsed.widget}
                    <span className="text-gray-500">[{entry.parsed.id}]</span>
                  </span>
                  <span className="text-yellow-400">.{entry.parsed.event}</span>
                  <span className="text-gray-500 ml-auto shrink-0">
                    {entry.subscriberCount} sub
                    {entry.subscriberCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-gray-400 pl-4 truncate">
                  {truncateJson(entry.content)}
                </div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === "subs" && (
          <div className="flex flex-col overflow-y-auto flex-1 p-1 gap-0.5">
            {subscriptions.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-500 text-[11px]">
                No active subscriptions.
              </div>
            )}
            {subscriptions.map((sub, i) => (
              <div
                key={i}
                className="flex flex-col px-2 py-1 rounded bg-gray-800/50 hover:bg-gray-800"
              >
                <div className="flex flex-row items-center gap-2">
                  <span className="text-blue-400 font-medium">
                    {sub.parsed.widget}
                    <span className="text-gray-500">[{sub.parsed.id}]</span>
                  </span>
                  <span className="text-yellow-400">.{sub.parsed.event}</span>
                  <span className="text-gray-500 ml-auto">
                    {sub.subscriberCount} listener
                    {sub.subscriberCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-gray-500 pl-4 text-[10px]">
                  {sub.uuids.join(", ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </LayoutContainer>
  );
};
