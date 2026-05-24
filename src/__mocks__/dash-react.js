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

function Divider({ orientation = "horizontal", className = "" }) {
  return React.createElement("div", {
    role: "separator",
    "aria-orientation": orientation,
    "data-testid": "divider",
    className: className,
  });
}

function Caption({ text, children, className = "", block = false }) {
  return React.createElement(
    block ? "div" : "span",
    { "data-testid": "caption", className: className },
    text !== null && text !== undefined ? text : children,
  );
}

function Code({ children, className = "" }) {
  return React.createElement(
    "code",
    { "data-testid": "code", className: className },
    children,
  );
}

function ButtonIcon({ icon, text, title, onClick, disabled }) {
  // Render visible text (from `text`) and a `title` attribute (from
  // `title`) so RTL queries by either work. Either prop is optional.
  return React.createElement(
    "button",
    {
      onClick: onClick,
      disabled: disabled,
      title: title || undefined,
      "data-icon": icon,
    },
    text || null,
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

function Card2({ children, hover, selected, onClick, className }) {
  return React.createElement(
    "button",
    {
      "data-testid": "card2",
      "aria-selected": selected,
      onClick: onClick,
      className: className,
    },
    children,
  );
}

function Card3({ children, hover, selected, onClick, className }) {
  return React.createElement(
    "button",
    {
      "data-testid": "card3",
      "aria-selected": selected,
      onClick: onClick,
      className: className,
    },
    children,
  );
}

function Tag2({ text, onClick, className }) {
  return React.createElement(
    "button",
    {
      "data-testid": "tag2",
      onClick: onClick,
      className: className,
    },
    text,
  );
}

function Tag3({ text, onClick, className }) {
  return React.createElement(
    "span",
    {
      "data-testid": "tag3",
      onClick: onClick,
      className: className,
    },
    text,
  );
}

// colorMath stubs — mirror the real exports from
// `dash-react/src/Utils/colorMath.js`. Minimal-but-correct
// implementations so ThemeModel tests can verify the hex-color
// branch without pulling the full dash-react package into dash-core's
// peerDep-only node_modules tree.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function isHexColor(value) {
  return typeof value === "string" && HEX_RE.test(value.trim());
}
function deriveShades(hex) {
  if (!isHexColor(hex)) return null;
  // Mock: return a unique sentinel hex per shade so ThemeModel tests
  // can distinguish which shade was looked up. The real algorithm is
  // exercised by dash-react's colorMath.test.js — these tests only
  // need to verify that cssValueFor routes hex channels through
  // deriveShades at the correct shade level.
  const shades = {};
  for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    // Shade `s` (decimal, e.g. 700) → hex "#000s" (e.g. "#000700").
    // Encodes the shade number as readable trailing digits.
    shades[s] = `#${s.toString().padStart(6, "0")}`;
  }
  return shades;
}

// Minimal TAILWIND_PALETTE subset for the colors ThemeModel tests
// reference. The real palette ships from dash-react's
// `tailwindPalette.js`; this mock just provides the families we
// touch so cssValueFor lookups succeed in jest-land.
const TAILWIND_PALETTE = {
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },
  indigo: {
    50: "#eef2ff",
    100: "#e0e7ff",
    200: "#c7d2fe",
    300: "#a5b4fc",
    400: "#818cf8",
    500: "#6366f1",
    600: "#4f46e5",
    700: "#4338ca",
    800: "#3730a3",
    900: "#312e81",
    950: "#1e1b4b",
  },
  rose: {
    50: "#fff1f2",
    100: "#ffe4e6",
    200: "#fecdd3",
    300: "#fda4af",
    400: "#fb7185",
    500: "#f43f5e",
    600: "#e11d48",
    700: "#be123c",
    800: "#9f1239",
    900: "#881337",
    950: "#4c0519",
  },
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
    950: "#030712",
  },
};

module.exports = {
  isHexColor,
  deriveShades,
  TAILWIND_PALETTE,
  ThemeContext,
  Modal,
  Stepper,
  InputText,
  TextArea,
  Button,
  Button2,
  Button3,
  ButtonIcon,
  Divider,
  Divider2: Divider,
  Divider3: Divider,
  Caption,
  Caption2: Caption,
  Caption3: Caption,
  Code,
  Code2: Code,
  Code3: Code,
  Card2,
  Card3,
  Tag2,
  Tag3,
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
