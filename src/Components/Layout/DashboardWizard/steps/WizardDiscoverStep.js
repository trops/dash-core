import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
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
    (e) => {
      const q = e.target.value;
      setSearchQuery(q);
      dispatch({ type: "SET_SEARCH_QUERY", payload: q });
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
    <div className="wizard-discover-step">
      {/* Search bar */}
      <div className="wizard-discover-search">
        <div className="wizard-discover-search-input">
          <FontAwesomeIcon
            icon="magnifying-glass"
            fixedWidth
            className="wizard-discover-search-icon"
          />
          <input
            type="text"
            placeholder="Search registry..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="wizard-discover-input"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="wizard-discover-filters">
        <div className="wizard-discover-filter-row">
          <span className="wizard-discover-filter-label">Categories</span>
          <div className="wizard-discover-chips">
            {DASHBOARD_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`wizard-chip ${filters.categories.includes(tag) ? "wizard-chip--active" : ""}`}
                onClick={() => handleToggleCategory(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="wizard-discover-filter-row">
          <span className="wizard-discover-filter-label">Providers</span>
          <div className="wizard-discover-chips">
            {KNOWN_PROVIDERS.map((prov) => (
              <button
                key={prov.key}
                type="button"
                className={`wizard-chip ${filters.providers.includes(prov.key) ? "wizard-chip--active" : ""}`}
                onClick={() => handleToggleProvider(prov.key)}
              >
                {prov.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="wizard-discover-results">
        {isLoading ? (
          <div className="wizard-loading">
            <FontAwesomeIcon
              icon="spinner"
              spin
              fixedWidth
              className="wizard-loading-icon"
            />
            <span>Searching registry...</span>
          </div>
        ) : error ? (
          <div className="wizard-error">
            <FontAwesomeIcon icon="circle-exclamation" fixedWidth />
            <span>{error}</span>
          </div>
        ) : !hasResults ? (
          <div className="wizard-empty">
            <FontAwesomeIcon
              icon="magnifying-glass"
              fixedWidth
              className="wizard-empty-icon"
            />
            <p>No results match your search.</p>
            {hasActiveFilters && (
              <p className="wizard-empty-hint">
                Try removing some filters to see more results.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Dashboards section */}
            {filteredDashboards.length > 0 && (
              <div className="wizard-discover-section">
                <h4 className="wizard-discover-section-title">
                  Dashboards ({filteredDashboards.length} result
                  {filteredDashboards.length !== 1 ? "s" : ""})
                </h4>
                <div className="wizard-dashboard-list">
                  {filteredDashboards.map((dash) => {
                    const isSelected =
                      state.selectedDashboard &&
                      state.selectedDashboard.name === dash.name;
                    const widgetCount = (dash.widgets || []).length;
                    const providerNames = (dash.providers || [])
                      .map((p) => p.name || p.type)
                      .join(", ");

                    return (
                      <button
                        key={dash.name}
                        type="button"
                        className={`wizard-dashboard-card ${isSelected ? "wizard-dashboard-card--selected" : ""}`}
                        onClick={() => handleSelectDashboard(dash)}
                      >
                        <div className="wizard-dashboard-card-header">
                          <FontAwesomeIcon
                            icon={resolveIcon(dash.icon || "grid-2")}
                            fixedWidth
                            className="wizard-dashboard-card-icon"
                          />
                          <span className="wizard-dashboard-card-name">
                            {dash.displayName || dash.name}
                          </span>
                          {isSelected && (
                            <FontAwesomeIcon
                              icon="circle-check"
                              className="wizard-dashboard-card-check"
                            />
                          )}
                        </div>
                        {dash.description && (
                          <p className="wizard-dashboard-card-desc">
                            {dash.description}
                          </p>
                        )}
                        <div className="wizard-dashboard-card-meta">
                          <span>
                            {widgetCount} widget
                            {widgetCount !== 1 ? "s" : ""}
                          </span>
                          {providerNames && <span>{providerNames}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Widgets section */}
            {filteredWidgets.length > 0 && (
              <div className="wizard-discover-section">
                <h4 className="wizard-discover-section-title">
                  Widgets ({filteredWidgets.length} result
                  {filteredWidgets.length !== 1 ? "s" : ""})
                  {state.selectedWidgets.length > 0 && (
                    <span className="wizard-count-badge">
                      {state.selectedWidgets.length} selected
                    </span>
                  )}
                </h4>
                <div className="wizard-widget-list">
                  {filteredWidgets.map((widget) => {
                    const checked = isWidgetSelected(widget);
                    return (
                      <button
                        key={widget.key}
                        type="button"
                        className={`wizard-widget-card ${checked ? "wizard-widget-card--selected" : ""}`}
                        onClick={() => handleToggleWidget(widget)}
                      >
                        <div className="wizard-widget-card-checkbox">
                          <FontAwesomeIcon
                            icon={checked ? "square-check" : "square"}
                            fixedWidth
                          />
                        </div>
                        <div className="wizard-widget-card-info">
                          <div className="wizard-widget-card-header">
                            {widget.icon && (
                              <FontAwesomeIcon
                                icon={resolveIcon(widget.icon)}
                                fixedWidth
                                className="wizard-widget-card-icon"
                              />
                            )}
                            <span className="wizard-widget-card-name">
                              {widget.name}
                            </span>
                          </div>
                          {widget.description && (
                            <p className="wizard-widget-card-desc">
                              {widget.description}
                            </p>
                          )}
                          {widget.packageDisplayName && (
                            <span className="wizard-widget-card-package">
                              {widget.packageDisplayName}
                            </span>
                          )}
                        </div>
                      </button>
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
