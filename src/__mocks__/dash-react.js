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

module.exports = {
  ThemeContext,
  Modal,
  Stepper,
  InputText,
  TextArea,
  Button2,
  Button3,
  SelectableCard,
  FontAwesomeIcon,
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
