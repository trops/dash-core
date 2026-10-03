import React, { useContext } from "react";
import { FontAwesomeIcon, ThemeContext } from "@trops/dash-react";
import { getAppPage } from "./appPages";

/**
 * DashTabBar — open dashboards and Manage pages (app-navigation NAV-002).
 * A page tab (`kind: "page"`) shows its page's icon.
 */

export const DashTabBar = ({
  tabs = [],
  activeTabId = null,
  onSwitchTab = null,
  onCloseTab = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);

  if (tabs.length === 0) return null;

  return (
    <div
      className={`dr-tabstrip flex flex-row items-center shrink-0 overflow-x-auto gap-1 px-2 py-2.5 border-t ${
        currentTheme["border-primary-dark"] || "border-gray-700"
      } ${currentTheme["bg-primary-dark"] || "bg-gray-900"} scrollbar-none`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const page = tab.kind === "page" ? getAppPage(tab.pageKey) : null;
        const label = (tab.name || "Untitled").replace(/^./, (c) =>
          c.toUpperCase(),
        );
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSwitchTab && onSwitchTab(tab.id)}
            className={`dr-pill ${isActive ? "dr-pill-active" : ""} group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-all duration-100 cursor-pointer ${
              isActive
                ? "bg-white/15 text-white"
                : "text-gray-400 hover:bg-white/10 hover:text-gray-200"
            }`}
          >
            {page ? (
              <FontAwesomeIcon icon={page.icon} className="h-3 w-3" />
            ) : null}
            <span className="truncate max-w-[140px]">{label}</span>
            <span
              role="button"
              aria-label={`Close ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab && onCloseTab(tab.id);
              }}
              className={`flex items-center justify-center h-4 w-4 rounded-sm hover:bg-white/10 ${
                isActive ? "opacity-60" : "opacity-0 group-hover:opacity-60"
              }`}
            >
              <svg
                className="h-2.5 w-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
};
