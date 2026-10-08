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

function TextArea({ label, value, onChange, placeholder, rows, ...htmlProps }) {
  // dash-react spreads extra props (onKeyDown, aria-label…) onto <textarea>.
  const {
    className: _c,
    inputClassName: _i,
    padding: _p,
    backgroundColor: _b,
    textColor: _t,
    borderColor: _bc,
    // dash-react sizes the box itself; expose the flag for tests.
    autoGrow,
    ...rest
  } = htmlProps;
  return React.createElement(
    "label",
    null,
    label,
    React.createElement("textarea", {
      ...rest,
      "data-autogrow": autoGrow ? "true" : undefined,
      value: value,
      onChange: (e) => onChange(e.target.value),
      placeholder: placeholder,
      rows: rows,
    }),
  );
}

// dash-react ≥1.0.58 SegmentedControl: a radiogroup of option buttons.
function SegmentedControl({ options = [], value, onChange, ariaLabel }) {
  return React.createElement(
    "div",
    { role: "radiogroup", "aria-label": ariaLabel },
    options.map((o) =>
      React.createElement(
        "button",
        {
          key: String(o.value),
          type: "button",
          role: "radio",
          "aria-checked": o.value === value,
          onClick: () => o.value !== value && onChange && onChange(o.value),
        },
        o.label,
      ),
    ),
  );
}

// dash-react ≥1.0.60 FilterMenu: rendered open — a labelled group with a
// checkbox per option, so tests can toggle values directly.
function FilterMenu({ label, options = [], selected = [], onChange }) {
  const opts = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  return React.createElement(
    "div",
    { role: "group", "aria-label": `${label} filter` },
    opts.map((o) =>
      React.createElement(
        "label",
        { key: String(o.value) },
        React.createElement("input", {
          type: "checkbox",
          checked: selected.includes(o.value),
          onChange: () =>
            onChange &&
            onChange(
              selected.includes(o.value)
                ? selected.filter((v) => v !== o.value)
                : [...selected, o.value],
            ),
        }),
        o.label,
      ),
    ),
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return React.createElement("input", {
    type: "search",
    value: value || "",
    placeholder,
    "aria-label": placeholder,
    onChange: (e) => onChange && onChange(e.target.value),
  });
}

function Checkbox({ label, checked, onChange, disabled }) {
  return React.createElement(
    "label",
    null,
    label,
    React.createElement("input", {
      type: "checkbox",
      checked: !!checked,
      disabled: disabled,
      onChange: (e) => onChange(e.target.checked),
      "aria-label": label,
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

function Button3({ title, children, onClick, disabled, ariaLabel, tooltip }) {
  // Mirrors dash-react ≥1.0.58: ariaLabel → aria-label, tooltip → title attr.
  return React.createElement(
    "button",
    {
      onClick: onClick,
      disabled: disabled,
      "aria-label": ariaLabel,
      title: tooltip,
    },
    children !== undefined ? children : title,
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

function FontAwesomeIcon({ icon, className, onClick }) {
  const name = typeof icon === "string" ? icon : (icon && icon.iconName) || "";
  return React.createElement("span", {
    "data-testid": "icon-" + name,
    className: className,
    onClick: onClick,
  });
}

function Button({ title, children, onClick, disabled }) {
  return React.createElement(
    "button",
    { onClick: onClick, disabled: disabled },
    children !== undefined ? children : title,
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

// Mirrors dash-react useStatusTokens() shape (Utils/statusColors.js), dark palette.
function useStatusTokens() {
  const make = (c) => ({
    bg: `bg-${c}-950`,
    text: `text-${c}-200`,
    strongText: `text-${c}-100`,
    border: `border-${c}-800`,
    accentBorder: `border-${c}-500`,
    icon: `text-${c}-400`,
    solidBg: `bg-${c}-500`,
    hoverBg: `hover:bg-${c}-900`,
    hoverText: `hover:text-${c}-100`,
  });
  return {
    error: make("red"),
    success: make("green"),
    warning: make("amber"),
    info: make("blue"),
  };
}

function AlertBanner({ message, children, variant }) {
  return React.createElement(
    "div",
    { role: "alert", "data-variant": variant },
    message,
    children,
  );
}

function Code({ children, className = "" }) {
  return React.createElement(
    "code",
    { "data-testid": "code", className: className },
    children,
  );
}

function ButtonIcon({ icon, text, title, onClick, disabled, ariaLabel }) {
  // Render visible text (from `text`) and a `title` attribute (from
  // `title`) so RTL queries by either work. Either prop is optional.
  // `ariaLabel` → aria-label, as in dash-react.
  return React.createElement(
    "button",
    {
      onClick: onClick,
      disabled: disabled,
      title: title || undefined,
      "aria-label": ariaLabel || undefined,
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

function Switch({ checked, onChange, disabled }) {
  return React.createElement("input", {
    type: "checkbox",
    role: "switch",
    checked: !!checked,
    disabled: disabled,
    onChange: (e) => onChange && onChange(e.target.checked),
  });
}

function Tag({ text, onClick, className }) {
  return React.createElement(
    "span",
    { "data-testid": "tag", onClick: onClick, className: className },
    text,
  );
}

function SelectInput({ label, value, onChange, options = [], placeholder }) {
  return React.createElement(
    "label",
    null,
    label,
    React.createElement(
      "select",
      {
        value: value,
        onChange: (e) => onChange(e.target.value),
        "aria-label": label || placeholder,
      },
      options.map((o) =>
        React.createElement(
          "option",
          { key: o.value, value: o.value },
          o.label,
        ),
      ),
    ),
  );
}

function EmptyState({ icon, title, description }) {
  return React.createElement(
    "div",
    { "data-testid": "empty-state", "data-icon": icon },
    React.createElement("span", null, title),
    description ? React.createElement("span", null, description) : null,
  );
}

function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmText,
  onConfirm,
  onCancel,
}) {
  // dash-react's real props are isOpen / confirmLabel / cancelLabel;
  // confirmText is kept for older callers. isOpen === false hides it.
  if (isOpen === false) return null;
  return React.createElement(
    "div",
    { "data-testid": "confirmation-modal" },
    React.createElement("span", null, title),
    message ? React.createElement("span", null, message) : null,
    React.createElement(
      "button",
      { onClick: onConfirm },
      confirmLabel || confirmText || "Confirm",
    ),
    React.createElement(
      "button",
      { onClick: onCancel },
      cancelLabel || "Cancel",
    ),
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

// dash-react ≥1.0.58 SectionLabel: uppercase section heading (text or children).
function SectionLabel({ text = null, className = "", children }) {
  return React.createElement(
    "span",
    { className },
    text != null ? text : children,
  );
}

function SubHeading3({ title }) {
  return React.createElement("h3", null, title);
}

// Simple stand-ins (McpCatalogDetail).
function Icon2({ icon }) {
  return React.createElement("span", { "data-icon": icon });
}
function FormLabel({ label, title, children }) {
  return React.createElement("label", null, label || title, children);
}

function Toggle({ text, enabled, setEnabled }) {
  return React.createElement(
    "label",
    null,
    React.createElement("input", {
      type: "checkbox",
      checked: !!enabled,
      onChange: (e) => setEnabled && setEnabled(e.target.checked),
    }),
    text,
  );
}

module.exports = {
  SectionLabel,
  SubHeading3,
  Toggle,
  ButtonIcon2: ButtonIcon,
  isHexColor,
  deriveShades,
  TAILWIND_PALETTE,
  ThemeContext,
  Modal,
  Stepper,
  InputText,
  TextArea,
  SegmentedControl,
  FilterMenu,
  SearchInput,
  Checkbox,
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
  useStatusTokens,
  AlertBanner,
  Code,
  Code2: Code,
  Code3: Code,
  Card2,
  Card3,
  Tag,
  Switch,
  Tag2,
  Tag3,
  SelectInput,
  EmptyState,
  ConfirmationModal,
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
  Icon2,
  FormLabel,
  colorTypes: ["primary", "secondary", "tertiary", "neutral"],
  themeVariants: ["very-light", "light", "medium", "dark", "very-dark"],
};
