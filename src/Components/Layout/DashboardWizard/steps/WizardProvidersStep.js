import React, { useContext, useMemo } from "react";
import { FontAwesomeIcon, SelectableCard } from "@trops/dash-react";
import { AppContext } from "../../../../Context/App/AppContext";
import { resolveIcon } from "../../../../utils/resolveIcon";

/**
 * WizardProvidersStep
 *
 * Step 1 of the Dashboard Wizard. Shows provider cards sourced from
 * AppContext.providers. Pre-checks providers that are already configured
 * (have credentials). User can select unconfigured providers too — a
 * "Needs setup" badge is shown for those.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 */
export const WizardProvidersStep = ({ state, dispatch }) => {
  const { providers: providersMap } = useContext(AppContext);

  const providerList = useMemo(() => {
    if (!providersMap || typeof providersMap !== "object") return [];
    return Object.values(providersMap).map((p) => ({
      key: p.type || p.name,
      name: p.name,
      type: p.type,
      icon: p.icon || p.type,
      configured: !!(p.credentials && Object.keys(p.credentials).length > 0),
    }));
  }, [providersMap]);

  // Pre-check configured providers on first render
  React.useEffect(() => {
    if (state.providers.length === 0 && providerList.length > 0) {
      const configuredKeys = providerList
        .filter((p) => p.configured)
        .map((p) => p.key);
      if (configuredKeys.length > 0) {
        dispatch({ type: "SET_PROVIDERS", payload: configuredKeys });
      }
    }
  }, [providerList, state.providers.length, dispatch]);

  const handleToggle = (key) => {
    dispatch({ type: "TOGGLE_PROVIDER", payload: key });
  };

  if (providerList.length === 0) {
    return (
      <div className="wizard-providers-step">
        <h3 className="wizard-step-header">
          Which tools and services do you use?
        </h3>
        <p className="wizard-empty-message">
          No providers configured yet. Add providers in Settings first.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-providers-step">
      <h3 className="wizard-step-header">
        Which tools and services do you use?
      </h3>
      <div className="wizard-card-grid">
        {providerList.map((provider) => {
          const isSelected = state.providers.includes(provider.key);
          const needsSetup = isSelected && !provider.configured;

          return (
            <SelectableCard
              key={provider.key}
              icon={
                <FontAwesomeIcon icon={resolveIcon(provider.icon)} fixedWidth />
              }
              label={provider.name}
              description={
                needsSetup ? (
                  <span className="wizard-needs-setup-badge">Needs setup</span>
                ) : null
              }
              selected={isSelected}
              onSelect={() => handleToggle(provider.key)}
            />
          );
        })}
      </div>
    </div>
  );
};
