import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FontAwesomeIcon, Tabs3 } from "@trops/dash-react";
import { useRegistrySearch } from "../../../../hooks/useRegistrySearch";
import { resolveIcon } from "../../../../utils/resolveIcon";

/**
 * WizardResultsStep
 *
 * Step 2 of the Dashboard Wizard. Dual-tab browser:
 *   Tab A — "Pre-built Dashboards": queries registry.searchDashboards()
 *   Tab B — "Build Your Own": queries registry.search() for widgets
 *
 * Dashboard tab is single-select; widget tab is multi-select with checkboxes.
 * Both tabs filter by the user's selected categories + providers from prior steps.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 */
export const WizardResultsStep = ({ state, dispatch }) => {
  const [activeTab, setActiveTab] = useState("prebuilt");

  // --- Dashboard search (Tab A) ---
  const [dashboards, setDashboards] = useState([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState(null);

  const dashFilters = useMemo(
    () => ({
      category: state.intent.length ? state.intent.join(",") : undefined,
      providerTypes: state.providers.length ? state.providers : undefined,
    }),
    [state.intent, state.providers],
  );

  const searchDashboards = useCallback(async () => {
    if (!window.mainApi?.registry?.searchDashboards) {
      setDashboards([]);
      return;
    }
    setDashLoading(true);
    setDashError(null);
    try {
      const result = await window.mainApi.registry.searchDashboards(
        "",
        dashFilters,
      );
      setDashboards(result.packages || []);
    } catch (err) {
      console.error("[WizardResultsStep] Dashboard search error:", err);
      setDashError(err.message || "Failed to search dashboards");
      setDashboards([]);
    } finally {
      setDashLoading(false);
    }
  }, [dashFilters]);

  useEffect(() => {
    searchDashboards();
  }, [searchDashboards]);

  // --- Widget search (Tab B) ---
  const {
    flatWidgets,
    isLoading: widgetsLoading,
    error: widgetsError,
  } = useRegistrySearch({ filterByCapabilities: true });

  // Filter widgets by selected categories + providers
  const filteredWidgets = useMemo(() => {
    return flatWidgets.filter((w) => {
      // Category filter: match if widget's category overlaps user intent
      const catMatch =
        state.intent.length === 0 ||
        state.intent.some(
          (cat) =>
            (w.packageCategory || "").toLowerCase() === cat.toLowerCase(),
        );

      // Provider filter: match if widget requires any of the selected providers
      const providerMatch =
        state.providers.length === 0 ||
        (w.providers || []).some((p) => state.providers.includes(p.type)) ||
        (w.packageProviders || []).some((p) =>
          state.providers.includes(p.type),
        );

      return catMatch && providerMatch;
    });
  }, [flatWidgets, state.intent, state.providers]);

  // --- Tab change: set wizard path ---
  const handleTabChange = useCallback(
    (tab) => {
      setActiveTab(tab);
      dispatch({
        type: "SET_PATH",
        payload: tab === "prebuilt" ? "prebuilt" : "custom",
      });
    },
    [dispatch],
  );

  // Set initial path on mount
  useEffect(() => {
    if (!state.path) {
      dispatch({ type: "SET_PATH", payload: "prebuilt" });
    }
  }, [state.path, dispatch]);

  // --- Dashboard selection (single-select) ---
  const handleSelectDashboard = useCallback(
    (dashboard) => {
      dispatch({ type: "SET_SELECTED_DASHBOARD", payload: dashboard });
    },
    [dispatch],
  );

  // --- Widget selection (multi-select) ---
  const handleToggleWidget = useCallback(
    (widget) => {
      dispatch({ type: "TOGGLE_WIDGET", payload: widget });
    },
    [dispatch],
  );

  const isWidgetSelected = useCallback(
    (widget) => {
      return state.selectedWidgets.some((w) => w.name === widget.name);
    },
    [state.selectedWidgets],
  );

  return (
    <div className="wizard-results-step">
      <h3 className="wizard-step-header">Choose your starting point</h3>

      <Tabs3
        value={activeTab}
        onValueChange={handleTabChange}
        className="wizard-results-tabs"
      >
        <Tabs3.List className="wizard-results-tab-list">
          <Tabs3.Trigger value="prebuilt">Pre-built Dashboards</Tabs3.Trigger>
          <Tabs3.Trigger value="custom">
            Build Your Own
            {state.selectedWidgets.length > 0 && (
              <span className="wizard-count-badge">
                {state.selectedWidgets.length}
              </span>
            )}
          </Tabs3.Trigger>
        </Tabs3.List>

        {/* Tab A: Pre-built Dashboards */}
        <Tabs3.Content value="prebuilt">
          <DashboardList
            dashboards={dashboards}
            isLoading={dashLoading}
            error={dashError}
            selectedDashboard={state.selectedDashboard}
            onSelect={handleSelectDashboard}
          />
        </Tabs3.Content>

        {/* Tab B: Build Your Own */}
        <Tabs3.Content value="custom">
          <WidgetList
            widgets={filteredWidgets}
            isLoading={widgetsLoading}
            error={widgetsError}
            isSelected={isWidgetSelected}
            onToggle={handleToggleWidget}
            selectedCount={state.selectedWidgets.length}
          />
        </Tabs3.Content>
      </Tabs3>
    </div>
  );
};

// --- Sub-components ---

const DashboardList = ({
  dashboards,
  isLoading,
  error,
  selectedDashboard,
  onSelect,
}) => {
  if (isLoading) {
    return (
      <div className="wizard-loading">
        <FontAwesomeIcon
          icon="spinner"
          spin
          fixedWidth
          className="wizard-loading-icon"
        />
        <span>Searching dashboards...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wizard-error">
        <FontAwesomeIcon icon="circle-exclamation" fixedWidth />
        <span>{error}</span>
      </div>
    );
  }

  if (dashboards.length === 0) {
    return (
      <div className="wizard-empty">
        <FontAwesomeIcon
          icon="box-open"
          fixedWidth
          className="wizard-empty-icon"
        />
        <p>No pre-built dashboards match your selections.</p>
        <p className="wizard-empty-hint">
          Try the "Build Your Own" tab to pick individual widgets.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-dashboard-list">
      {dashboards.map((dash) => {
        const isSelected =
          selectedDashboard && selectedDashboard.name === dash.name;
        const widgetCount = (dash.widgets || []).length;
        const providerNames = (dash.providers || [])
          .map((p) => p.name || p.type)
          .join(", ");

        return (
          <button
            key={dash.name}
            type="button"
            className={`wizard-dashboard-card ${isSelected ? "wizard-dashboard-card--selected" : ""}`}
            onClick={() => onSelect(dash)}
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
              <p className="wizard-dashboard-card-desc">{dash.description}</p>
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
  );
};

const WidgetList = ({
  widgets,
  isLoading,
  error,
  isSelected,
  onToggle,
  selectedCount,
}) => {
  if (isLoading) {
    return (
      <div className="wizard-loading">
        <FontAwesomeIcon
          icon="spinner"
          spin
          fixedWidth
          className="wizard-loading-icon"
        />
        <span>Searching widgets...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wizard-error">
        <FontAwesomeIcon icon="circle-exclamation" fixedWidth />
        <span>{error}</span>
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="wizard-empty">
        <FontAwesomeIcon
          icon="puzzle-piece"
          fixedWidth
          className="wizard-empty-icon"
        />
        <p>No widgets match your selections.</p>
        <p className="wizard-empty-hint">
          Try adjusting your categories or providers in the previous steps.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-widget-list">
      {selectedCount > 0 && (
        <p className="wizard-widget-count">
          {selectedCount} widget{selectedCount !== 1 ? "s" : ""} selected
        </p>
      )}
      {widgets.map((widget) => {
        const checked = isSelected(widget);
        return (
          <button
            key={widget.key}
            type="button"
            className={`wizard-widget-card ${checked ? "wizard-widget-card--selected" : ""}`}
            onClick={() => onToggle(widget)}
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
                <span className="wizard-widget-card-name">{widget.name}</span>
              </div>
              {widget.description && (
                <p className="wizard-widget-card-desc">{widget.description}</p>
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
  );
};
