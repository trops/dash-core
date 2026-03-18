import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FontAwesomeIcon,
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

      {/* Results */}
      <div className="flex flex-col gap-6 mt-2">
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
            {/* Dashboards section */}
            {filteredDashboards.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  Dashboards ({filteredDashboards.length} result
                  {filteredDashboards.length !== 1 ? "s" : ""})
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {filteredDashboards.map((dash) => {
                    const isSelected =
                      state.selectedDashboard &&
                      state.selectedDashboard.name === dash.name;
                    const widgetCount = (dash.widgets || []).length;
                    const providerNames = (dash.providers || [])
                      .map((p) => p.name || p.type)
                      .join(", ");

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
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon
                            icon={resolveIcon(dash.icon || "grid-2")}
                            fixedWidth
                            className="text-gray-400"
                          />
                          <span className="text-sm font-medium text-gray-200">
                            {dash.displayName || dash.name}
                          </span>
                          {isSelected && (
                            <FontAwesomeIcon
                              icon="circle-check"
                              className="ml-auto text-blue-400"
                            />
                          )}
                        </div>
                        {dash.description && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                            {dash.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <span>
                            {widgetCount} widget
                            {widgetCount !== 1 ? "s" : ""}
                          </span>
                          {providerNames && <span>{providerNames}</span>}
                        </div>
                      </Card2>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Widgets section */}
            {filteredWidgets.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  Widgets ({filteredWidgets.length} result
                  {filteredWidgets.length !== 1 ? "s" : ""})
                  {state.selectedWidgets.length > 0 && (
                    <Tag3 text={`${state.selectedWidgets.length} selected`} />
                  )}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {filteredWidgets.map((widget) => {
                    const checked = isWidgetSelected(widget);
                    return (
                      <Card2
                        key={widget.key}
                        hover
                        selected={checked}
                        padding="p-5"
                        rounded="rounded-lg"
                        className="hover:shadow-lg"
                        onClick={() => handleToggleWidget(widget)}
                      >
                        <div className="flex items-start gap-2">
                          <FontAwesomeIcon
                            icon={checked ? "square-check" : "square"}
                            fixedWidth
                            className={
                              checked
                                ? "text-blue-400 mt-0.5"
                                : "text-gray-500 mt-0.5"
                            }
                          />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {widget.icon && (
                                <FontAwesomeIcon
                                  icon={resolveIcon(widget.icon)}
                                  fixedWidth
                                  className="text-gray-400 text-xs"
                                />
                              )}
                              <span className="text-sm font-medium text-gray-200 truncate">
                                {widget.name}
                              </span>
                            </div>
                            {widget.description && (
                              <p className="text-xs text-gray-400 line-clamp-2">
                                {widget.description}
                              </p>
                            )}
                            {widget.packageDisplayName && (
                              <span className="text-xs text-gray-500">
                                {widget.packageDisplayName}
                              </span>
                            )}
                          </div>
                        </div>
                      </Card2>
                    );
                  })}
                </div>
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
