import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FontAwesomeIcon,
  Button,
  Card2,
  Tag2,
  Tag3,
  InputText,
} from "@trops/dash-react";
import { useRegistrySearch } from "../../../../hooks/useRegistrySearch";
import { resolveIcon } from "../../../../utils/resolveIcon";
import { DASHBOARD_TAGS } from "../../../Settings/constants";

const KNOWN_PROVIDERS = [
  { key: "google-drive", name: "Google Drive" },
  { key: "slack", name: "Slack" },
  { key: "github", name: "GitHub" },
  { key: "gmail", name: "Gmail" },
  { key: "google-calendar", name: "Google Calendar" },
  { key: "notion", name: "Notion" },
  { key: "linear", name: "Linear" },
  { key: "algolia", name: "Algolia" },
  { key: "contentful", name: "Contentful" },
  { key: "jira", name: "Jira" },
  { key: "openai", name: "OpenAI" },
  { key: "postgres", name: "PostgreSQL" },
];

/**
 * WizardDiscoverStep
 *
 * Step 0 of the Dashboard Wizard. Combines search, category/provider
 * filter chips, and results (dashboards + widgets) in a single view.
 * Replaces the old Intent, Providers, and Results steps.
 *
 * - Selecting a dashboard sets path to "prebuilt" and clears widget selections.
 * - Selecting widgets sets path to "custom" and clears dashboard selection.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 */
export const WizardDiscoverStep = ({ state, dispatch }) => {
  const { filters } = state;

  // --- Registry search ---
  const {
    packages,
    flatWidgets,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
  } = useRegistrySearch({ filterByCapabilities: true });

  // Sync search query from wizard state on mount
  useEffect(() => {
    if (filters.query) {
      setSearchQuery(filters.query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchChange = useCallback(
    (val) => {
      setSearchQuery(val);
      dispatch({ type: "SET_SEARCH_QUERY", payload: val });
    },
    [setSearchQuery, dispatch],
  );

  // --- Client-side category + provider filtering ---
  const filteredDashboards = useMemo(() => {
    const dashPkgs = packages.filter(
      (pkg) => (pkg.type || "").toLowerCase() === "dashboard",
    );
    return applyFilters(dashPkgs, filters, "package");
  }, [packages, filters]);

  const filteredWidgets = useMemo(() => {
    return applyFilters(flatWidgets, filters, "widget");
  }, [flatWidgets, filters]);

  // --- Selection handlers ---
  const handleSelectDashboard = useCallback(
    (dashboard) => {
      dispatch({ type: "SET_SELECTED_DASHBOARD", payload: dashboard });
      dispatch({ type: "SET_SELECTED_WIDGETS", payload: [] });
      dispatch({ type: "SET_PATH", payload: "prebuilt" });
    },
    [dispatch],
  );

  const handleToggleWidget = useCallback(
    (widget) => {
      dispatch({ type: "TOGGLE_WIDGET", payload: widget });
      dispatch({ type: "SET_SELECTED_DASHBOARD", payload: null });
      dispatch({ type: "SET_PATH", payload: "custom" });
    },
    [dispatch],
  );

  const isWidgetSelected = useCallback(
    (widget) => state.selectedWidgets.some((w) => w.name === widget.name),
    [state.selectedWidgets],
  );

  // --- Filter chip handlers ---
  const handleToggleCategory = useCallback(
    (cat) => dispatch({ type: "TOGGLE_FILTER_CATEGORY", payload: cat }),
    [dispatch],
  );

  const handleToggleProvider = useCallback(
    (prov) => dispatch({ type: "TOGGLE_FILTER_PROVIDER", payload: prov }),
    [dispatch],
  );

  // Tab state (DASH-185)
  const [activeTab, setActiveTab] = useState("dashboards");

  // Clear selection handler (DASH-186)
  const hasSelection =
    state.selectedDashboard !== null || state.selectedWidgets.length > 0;

  const handleClearSelection = useCallback(() => {
    dispatch({ type: "SET_SELECTED_DASHBOARD", payload: null });
    dispatch({ type: "SET_SELECTED_WIDGETS", payload: [] });
    dispatch({ type: "SET_PATH", payload: null });
  }, [dispatch]);

  const hasResults =
    filteredDashboards.length > 0 || filteredWidgets.length > 0;
  const hasActiveFilters =
    filters.categories.length > 0 || filters.providers.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <InputText
        value={searchQuery}
        onChange={handleSearchChange}
        placeholder="Search registry..."
      />

      {/* Filter chips */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Categories
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DASHBOARD_TAGS.map((tag) => (
              <Tag2
                key={tag}
                text={tag}
                onClick={() => handleToggleCategory(tag)}
                className={
                  filters.categories.includes(tag) ? "ring-1 ring-blue-400" : ""
                }
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Providers
          </span>
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_PROVIDERS.map((prov) => (
              <Tag2
                key={prov.key}
                text={prov.name}
                onClick={() => handleToggleProvider(prov.key)}
                className={
                  filters.providers.includes(prov.key)
                    ? "ring-1 ring-blue-400"
                    : ""
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar + Clear Selection (DASH-185, DASH-186) */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === "dashboards"
                ? "bg-gray-800 text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
            onClick={() => setActiveTab("dashboards")}
          >
            Dashboards ({filteredDashboards.length})
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === "widgets"
                ? "bg-gray-800 text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
            onClick={() => setActiveTab("widgets")}
          >
            Widgets ({filteredWidgets.length})
            {state.selectedWidgets.length > 0 && (
              <span className="ml-1.5">
                <Tag3 text={`${state.selectedWidgets.length} selected`} />
              </span>
            )}
          </button>
        </div>
        {hasSelection && (
          <Button
            onClick={handleClearSelection}
            title="Clear Selection"
            textSize="text-xs"
            padding="py-1 px-3"
            backgroundColor="bg-gray-700"
            textColor="text-gray-400"
            hoverTextColor="hover:text-white"
            hoverBackgroundColor="hover:bg-gray-600"
            icon="xmark"
          />
        )}
      </div>

      {/* Results */}
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
            <FontAwesomeIcon icon="spinner" spin fixedWidth />
            <span>Searching registry...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-400 py-4">
            <FontAwesomeIcon icon="circle-exclamation" fixedWidth />
            <span>{error}</span>
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
            <FontAwesomeIcon icon="magnifying-glass" fixedWidth />
            <p>No results match your search.</p>
            {hasActiveFilters && (
              <p className="text-xs text-gray-600">
                Try removing some filters to see more results.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Dashboards tab */}
            {activeTab === "dashboards" && filteredDashboards.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  {filteredDashboards.map((dash) => {
                    const isSelected =
                      state.selectedDashboard &&
                      state.selectedDashboard.name === dash.name;
                    const widgetCount = (dash.widgets || []).length;
                    const providerTags = (dash.providers || [])
                      .map((p) => p.name || p.type)
                      .filter(Boolean);

                    return (
                      <Card2
                        key={dash.name}
                        hover
                        selected={isSelected}
                        padding="p-5"
                        rounded="rounded-lg"
                        className="hover:shadow-lg"
                        onClick={() => handleSelectDashboard(dash)}
                      >
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="relative">
                            <span className="text-2xl">
                              <FontAwesomeIcon
                                icon={resolveIcon(dash.icon || "grid-2")}
                                fixedWidth
                                className="text-gray-400"
                              />
                            </span>
                            {isSelected && (
                              <FontAwesomeIcon
                                icon="circle-check"
                                className="absolute -top-1 -right-3 text-blue-400 text-xs"
                              />
                            )}
                          </div>
                          <span className="text-sm font-semibold text-gray-200">
                            {dash.displayName || dash.name}
                          </span>
                        </div>
                        {dash.description && (
                          <p className="text-xs text-gray-400 mt-2 line-clamp-2 text-center">
                            {dash.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-700/50">
                          <span className="text-xs text-gray-500">
                            {widgetCount} widget
                            {widgetCount !== 1 ? "s" : ""}
                          </span>
                          {providerTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 justify-end">
                              {providerTags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </Card2>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dashboards tab — empty state */}
            {activeTab === "dashboards" && filteredDashboards.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
                <FontAwesomeIcon icon="grid-2" fixedWidth />
                <p>No dashboards match your search.</p>
              </div>
            )}

            {/* Widgets tab */}
            {activeTab === "widgets" && filteredWidgets.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  {filteredWidgets.map((widget) => {
                    const checked = isWidgetSelected(widget);
                    return (
                      <Card2
                        key={widget.key}
                        hover
                        selected={checked}
                        padding="p-4"
                        rounded="rounded-lg"
                        className="hover:shadow-lg flex flex-col"
                        onClick={() => handleToggleWidget(widget)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {widget.icon && (
                              <FontAwesomeIcon
                                icon={resolveIcon(widget.icon)}
                                fixedWidth
                                className="text-gray-400 text-sm"
                              />
                            )}
                            <span className="text-sm font-medium text-gray-200 truncate">
                              {widget.name}
                            </span>
                          </div>
                          <FontAwesomeIcon
                            icon={checked ? "square-check" : "square"}
                            fixedWidth
                            className={
                              checked
                                ? "text-blue-400 flex-shrink-0"
                                : "text-gray-500 flex-shrink-0"
                            }
                          />
                        </div>
                        {widget.description && (
                          <p className="text-xs text-gray-400 line-clamp-2 mt-1.5 flex-1">
                            {widget.description}
                          </p>
                        )}
                        {widget.packageDisplayName && (
                          <span className="text-xs text-gray-500 mt-2 pt-1.5 border-t border-gray-700/50 truncate">
                            {widget.packageDisplayName}
                          </span>
                        )}
                      </Card2>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Widgets tab — empty state */}
            {activeTab === "widgets" && filteredWidgets.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-500">
                <FontAwesomeIcon icon="puzzle-piece" fixedWidth />
                <p>No widgets match your search.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// --- Helpers ---

function applyFilters(items, filters, mode) {
  return items.filter((item) => {
    // Category filter
    if (filters.categories.length > 0) {
      const itemCategory =
        mode === "widget"
          ? (item.packageCategory || "").toLowerCase()
          : (item.category || "").toLowerCase();
      if (!filters.categories.some((c) => c.toLowerCase() === itemCategory)) {
        return false;
      }
    }

    // Provider filter
    if (filters.providers.length > 0) {
      const itemProviders =
        mode === "widget"
          ? [...(item.providers || []), ...(item.packageProviders || [])]
          : item.providers || [];
      const hasMatchingProvider = itemProviders.some((p) =>
        filters.providers.includes(p.type),
      );
      if (!hasMatchingProvider) {
        return false;
      }
    }

    return true;
  });
}
