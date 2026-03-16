import React from "react";
import { FontAwesomeIcon, SelectableCard } from "@trops/dash-react";

const CATEGORIES = [
  {
    key: "reporting",
    label: "Reporting",
    icon: "chart-bar",
    description: "Dashboards for data visualization and reports",
  },
  {
    key: "monitoring",
    label: "Monitoring",
    icon: "heart-pulse",
    description: "System health, uptime, and performance monitoring",
  },
  {
    key: "productivity",
    label: "Productivity",
    icon: "list-check",
    description: "Task tracking, calendars, and workflow management",
  },
  {
    key: "development",
    label: "Development",
    icon: "code",
    description: "Code repos, CI/CD, and developer tools",
  },
  {
    key: "communication",
    label: "Communication",
    icon: "comments",
    description: "Messages, channels, and team communication",
  },
  {
    key: "custom",
    label: "Custom",
    icon: "grid-2",
    description: "Build a fully custom dashboard",
  },
];

/**
 * WizardIntentStep
 *
 * Step 0 of the Dashboard Wizard. Presents category cards so the user
 * can indicate what kind of dashboard they want to build.
 * Multi-select — user can pick multiple categories.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 */
export const WizardIntentStep = ({ state, dispatch }) => {
  const handleToggle = (key) => {
    dispatch({ type: "TOGGLE_INTENT", payload: key });
  };

  return (
    <div className="wizard-intent-step">
      <h3 className="wizard-step-header">What is this dashboard for?</h3>
      <div className="wizard-card-grid">
        {CATEGORIES.map((cat) => (
          <SelectableCard
            key={cat.key}
            icon={<FontAwesomeIcon icon={cat.icon} fixedWidth />}
            label={cat.label}
            description={cat.description}
            selected={state.intent.includes(cat.key)}
            onSelect={() => handleToggle(cat.key)}
          />
        ))}
      </div>
    </div>
  );
};
