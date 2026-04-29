import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FontAwesomeIcon,
  Button,
  Card2,
  Tag3,
  InputText,
} from "@trops/dash-react";
import { useRegistrySearch } from "../../../../hooks/useRegistrySearch";
import { useRegistryAuth } from "../../../../hooks/useRegistryAuth";
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
 * Step 0 of the Dashboard Wizard. Two-column layout mirroring the
 * dash-registry homepage: a left filter sidebar (TYPE / CATEGORIES /
 * PROVIDERS as vertical lists) and a right content pane with the
 * search input + result grid.
 *
 * - TYPE filter (single-select): All / Dashboards / Widgets. Replaces
 *   the previous tab bar so the right pane is a single result surface.
 * - CATEGORIES + PROVIDERS (multi-select): preserves the existing
 *   wizard filter shape (`filters.categories[]`, `filters.providers[]`).
 *
 * Selecting a dashboard sets path = "prebuilt" and clears widget
 * selections. Selecting widgets sets path = "custom" and clears the
 * dashboard selection.
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
    refetch,
  } = useRegistrySearch({ filterByCapabilities: true });

  // --- Registry auth (device-code OAuth) ---
  // Surfaces a sign-in CTA when the user isn't authenticated so they
  // see private dashboards/widgets they have access to. After
  // successful auth, `refetch` re-runs the registry search so the
  // results refresh automatically — no manual reload needed.
  const {
    isAuthenticated,
    isAuthenticating,
    authError,
    checkAuth,
    initiateAuth,
    cancelAuth,
  } = useRegistryAuth();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleSignIn = useCallback(() => {
    initiateAuth(refetch);
  }, [initiateAuth, refetch]);

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

  // --- Filter handlers ---
  const handleToggleCategory = useCallback(
    (cat) => dispatch({ type: "TOGGLE_FILTER_CATEGORY", payload: cat }),
    [dispatch],
  );

  const handleToggleProvider = useCallback(
    (prov) => dispatch({ type: "TOGGLE_FILTER_PROVIDER", payload: prov }),
    [dispatch],
  );

  // TYPE filter — replaces the old tab bar. Binary because the
  // wizard's data model is mutually exclusive: selecting a dashboard
  // clears widgets and sets path="prebuilt"; selecting a widget
  // clears the dashboard and sets path="custom". An "All" view would
  // imply you can browse both freely when in reality the first click
  // commits you to one of two paths. Defaulting to "dashboards" since
  // pre-built is the simpler, more common starting point.
  const [typeFilter, setTypeFilter] = useState("dashboards");

  const TYPE_OPTIONS = [
    { key: "dashboards", label: "Dashboards" },
    { key: "widgets", label: "Widgets" },
  ];

  // Clear-selection handler
  const hasSelection =
    state.selectedDashboard !== null || state.selectedWidgets.length > 0;

  const handleClearSelection = useCallback(() => {
    dispatch({ type: "SET_SELECTED_DASHBOARD", payload: null });
    dispatch({ type: "SET_SELECTED_WIDGETS", payload: [] });
    dispatch({ type: "SET_PATH", payload: null });
  }, [dispatch]);

  const showDashboards = typeFilter === "dashboards";
  const showWidgets = typeFilter === "widgets";

  const visibleDashboards = showDashboards ? filteredDashboards : [];
  const visibleWidgets = showWidgets ? filteredWidgets : [];

  const hasResults = visibleDashboards.length > 0 || visibleWidgets.length > 0;
  const hasActiveFilters =
    filters.categories.length > 0 || filters.providers.length > 0;

  // Shared row class for sidebar list items.
  const rowClass = (active) =>
    `text-sm py-1.5 px-3 rounded text-left transition-colors flex items-center justify-between ${
      active
        ? "bg-blue-900 text-blue-200"
        : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
    }`;

  const sectionLabelClass =
    "text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-1";

  return (
    <div className="flex flex-row gap-4">
      {/* Left sidebar — filters */}
      <aside className="flex-shrink-0 w-56 flex flex-col gap-4 overflow-y-auto">
        {/* Registry sign-in CTA */}
        {!isAuthenticated && (
          <div className="flex flex-col gap-2 px-3 py-3 rounded bg-gray-800 text-gray-300">
            <span className="text-xs font-semibold text-gray-200">
              Sign in to registry
            </span>
            <span className="text-xs text-gray-400">
              See dashboards and widgets you have access to
            </span>
            {!isAuthenticating ? (
              <button
                type="button"
                onClick={handleSignIn}
                className="mt-1 text-xs py-1.5 px-3 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                Sign in
              </button>
            ) : (
              <div className="mt-1 flex flex-col gap-1">
                <span className="text-xs text-gray-400">
                  Waiting for browser…
                </span>
                <button
                  type="button"
                  onClick={cancelAuth}
                  className="text-xs text-gray-400 hover:text-gray-200 underline self-start"
                >
                  Cancel
                </button>
              </div>
            )}
            {authError && (
              <span className="text-xs text-red-400">{authError}</span>
            )}
          </div>
        )}
        {isAuthenticated && (
          <div className="flex items-center gap-2 px-3 text-xs text-gray-500">
            <FontAwesomeIcon
              icon="circle-check"
              className="text-green-400 text-xs"
            />
            <span>Signed in</span>
          </div>
        )}

        {/* TYPE */}
        <div className="flex flex-col">
          <span className={sectionLabelClass}>TYPE</span>
          {TYPE_OPTIONS.map((opt) => {
            const active = typeFilter === opt.key;
            const showBadge =
              opt.key === "widgets" && state.selectedWidgets.length > 0;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTypeFilter(opt.key)}
                className={rowClass(active)}
              >
                <span>{opt.label}</span>
                {showBadge && (
                  <Tag3 text={`${state.selectedWidgets.length} selected`} />
                )}
              </button>
            );
          })}
        </div>

        {/* CATEGORIES */}
        <div className="flex flex-col">
          <span className={sectionLabelClass}>CATEGORIES</span>
          {DASHBOARD_TAGS.map((tag) => {
            const active = filters.categories.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleToggleCategory(tag)}
                className={`${rowClass(active)} capitalize`}
              >
                <span>{tag}</span>
              </button>
            );
          })}
        </div>

        {/* PROVIDERS */}
        <div className="flex flex-col">
          <span className={sectionLabelClass}>PROVIDERS</span>
          {KNOWN_PROVIDERS.map((prov) => {
            const active = filters.providers.includes(prov.key);
            return (
              <button
                key={prov.key}
                type="button"
                onClick={() => handleToggleProvider(prov.key)}
                className={rowClass(active)}
              >
                <span>{prov.name}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right content */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* Search bar + Clear Selection */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <InputText
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search registry..."
            />
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

        {/* Result count line — mirrors the Widgets sidebar pattern */}
        {!isLoading && !error && (
          <div className="text-xs text-gray-500 px-1">
            {showDashboards
              ? `${visibleDashboards.length} dashboard${visibleDashboards.length === 1 ? "" : "s"}`
              : `${visibleWidgets.length} widget${visibleWidgets.length === 1 ? "" : "s"}`}
          </div>
        )}

        {/* Results body */}
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
              {/* Dashboards */}
              {showDashboards && visibleDashboards.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    {visibleDashboards.map((dash) => {
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

              {/* Widgets */}
              {showWidgets && visibleWidgets.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    {visibleWidgets.map((widget) => {
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
            </>
          )}
        </div>
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
