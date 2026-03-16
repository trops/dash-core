const React = require("react");

const ThemeContext = React.createContext({ currentTheme: {} });

function Modal({ isOpen, children }) {
  return isOpen
    ? React.createElement("div", { "data-testid": "modal" }, children)
    : null;
}

function Stepper({ activeStep, children, onStepChange }) {
  const steps = React.Children.toArray(children);
  // Only render the active step to avoid duplicate text in tests
  return React.createElement(
    "div",
    { "data-testid": "stepper" },
    steps[activeStep] || null,
  );
}

Stepper.Step = function StepContent({ label, children }) {
  return React.createElement(
    "div",
    { "data-testid": "step-content-" + label },
    React.createElement("span", { "data-testid": "step-label" }, label),
    children,
  );
};

function InputText({ label, value, onChange, placeholder }) {
  return React.createElement(
    "label",
    null,
    label,
    React.createElement("input", {
      value: value,
      onChange: (e) => onChange(e.target.value),
      placeholder: placeholder,
    }),
  );
}

function TextArea({ label, value, onChange, placeholder, rows }) {
  return React.createElement(
    "label",
    null,
    label,
    React.createElement("textarea", {
      value: value,
      onChange: (e) => onChange(e.target.value),
      placeholder: placeholder,
      rows: rows,
    }),
  );
}

function Button2({ title, onClick, disabled }) {
  return React.createElement(
    "button",
    { onClick: onClick, disabled: disabled },
    title,
  );
}

function Button3({ title, onClick, disabled }) {
  return React.createElement(
    "button",
    { onClick: onClick, disabled: disabled },
    title,
  );
}

function SelectableCard({
  icon,
  label,
  description,
  selected,
  onSelect,
  disabled,
}) {
  return React.createElement(
    "div",
    {
      "data-testid": "selectable-card-" + label,
      role: "button",
      "aria-pressed": selected,
      "aria-disabled": disabled,
      onClick: disabled ? undefined : onSelect,
    },
    icon,
    React.createElement("span", null, label),
    description ? React.createElement("span", null, description) : null,
  );
}

function FontAwesomeIcon({ icon, className }) {
  const name = typeof icon === "string" ? icon : (icon && icon.iconName) || "";
  return React.createElement("span", {
    "data-testid": "icon-" + name,
    className: className,
  });
}

function Button({ title, onClick, disabled }) {
  return React.createElement(
    "button",
    { onClick: onClick, disabled: disabled },
    title,
  );
}

// Tabs3 mock — renders only the active tab content
function Tabs3({ value, onValueChange, children, className }) {
  return React.createElement(
    "div",
    { "data-testid": "tabs3", className: className },
    React.Children.map(children, (child) => {
      if (!child) return null;
      // Clone children passing value and onValueChange for triggers
      return React.cloneElement(child, {
        _activeTab: value,
        _onTabChange: onValueChange,
      });
    }),
  );
}

Tabs3.List = function TabsList({
  children,
  _activeTab,
  _onTabChange,
  className,
}) {
  return React.createElement(
    "div",
    { "data-testid": "tabs3-list", role: "tablist", className: className },
    React.Children.map(children, (child) =>
      child ? React.cloneElement(child, { _activeTab, _onTabChange }) : null,
    ),
  );
};

Tabs3.Trigger = function TabsTrigger({
  value,
  children,
  _activeTab,
  _onTabChange,
}) {
  return React.createElement(
    "button",
    {
      "data-testid": "tab-trigger-" + value,
      role: "tab",
      "aria-selected": _activeTab === value,
      onClick: () => _onTabChange && _onTabChange(value),
    },
    children,
  );
};

Tabs3.Content = function TabsContent({ value, children, _activeTab }) {
  if (_activeTab !== value) return null;
  return React.createElement(
    "div",
    { "data-testid": "tab-content-" + value },
    children,
  );
};

module.exports = {
  ThemeContext,
  Modal,
  Stepper,
  InputText,
  TextArea,
  Button,
  Button2,
  Button3,
  SelectableCard,
  FontAwesomeIcon,
  Tabs3,
  getStylesForItem: () => ({}),
  themeObjects: { PANEL: "panel" },
  deepCopy: (obj) => JSON.parse(JSON.stringify(obj)),
  isObject: (val) =>
    val !== null && typeof val === "object" && !Array.isArray(val),
  capitalizeFirstLetter: (str) =>
    str ? str.charAt(0).toUpperCase() + str.slice(1) : "",
  getStyleName: (type) =>
    type === "bg"
      ? "background"
      : type === "text"
        ? "color"
        : type === "border"
          ? "border"
          : type,
  colorTypes: ["primary", "secondary", "tertiary", "neutral"],
};
