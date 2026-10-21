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

function InputText({
  label,
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
  onKeyDown,
}) {
  return React.createElement(
    "label",
    null,
    label,
    React.createElement("input", {
      id,
      "aria-label": ariaLabel || undefined,
      value: value,
      onChange: (e) => onChange(e.target.value),
      onKeyDown,
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

// dash-react RadioGroup: a radio per option, onChange(value).
function RadioGroup({ label, name, value, onChange, options = [] }) {
  return React.createElement(
    "div",
    { role: "radiogroup", "aria-label": label || undefined },
    options.map((o) =>
      React.createElement(
        "label",
        { key: String(o.value) },
        React.createElement("input", {
          type: "radio",
          name: name || "radio-group",
          value: o.value,
          checked: value === o.value,
          onChange: (e) => onChange && onChange(e.target.value, e),
        }),
        o.label,
      ),
    ),
  );
}

// dash-react CodeEditorVS: the code, as text (read-only in tests).
function CodeEditorVS({ code = "" }) {
  return React.createElement("pre", { "data-testid": "code-editor" }, code);
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

function Button2({ title, children, onClick, disabled, ariaLabel }) {
  // Like dash-react: children win over title; ariaLabel → aria-label.
  return React.createElement(
    "button",
    { onClick: onClick, disabled: disabled, "aria-label": ariaLabel },
    children || title,
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

function ButtonIcon({
  icon,
  text,
  title,
  onClick,
  disabled,
  ariaLabel,
  ariaPressed = null,
  selected = false,
  testId,
}) {
  // Render visible text (from `text`) and a `title` attribute (from
  // `title`) so RTL queries by either work. Either prop is optional.
  // `ariaLabel` → aria-label, `ariaPressed` → aria-pressed, `selected` →
  // data-selected, `testId` → data-testid, as in dash-react ≥1.0.75.
  return React.createElement(
    "button",
    {
      onClick: onClick,
      disabled: disabled,
      title: title || undefined,
      "aria-label": ariaLabel || undefined,
      "aria-pressed": ariaPressed === null ? undefined : !!ariaPressed,
      "data-selected": selected ? "true" : undefined,
      "data-icon": icon,
      "data-testid": testId,
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

// Like dash-react ≥1.0.76: with onClick a card is a button (role, focus,
// Enter/Space, ariaLabel, disabled); without it, plain content.
function Card2({
  children,
  selected,
  onClick,
  className,
  disabled = false,
  ariaLabel,
  testId,
}) {
  const clickable = onClick
    ? {
        role: "button",
        tabIndex: disabled ? -1 : 0,
        "aria-disabled": disabled || undefined,
        "aria-label": ariaLabel || undefined,
        onClick: disabled ? undefined : onClick,
        onKeyDown: disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") onClick(e);
            },
      }
    : {};
  // Rendered as a <button> (as before) so callers' tests that find a card
  // with closest("button") keep working.
  return React.createElement(
    "button",
    {
      "data-testid": testId || "card2",
      "aria-selected": selected,
      className: className,
      ...clickable,
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

// Like dash-react: `label` (or `ariaLabel`) names the switch.
function Switch({ checked, onChange, disabled, label, ariaLabel }) {
  return React.createElement("input", {
    type: "checkbox",
    role: "switch",
    checked: !!checked,
    disabled: disabled,
    "aria-label": label || ariaLabel || undefined,
    onChange: (e) => onChange && onChange(e.target.checked),
  });
}

// DataList: label/value rows (DataList.Item).
function DataList({ children }) {
  return React.createElement("dl", null, children);
}
DataList.Item = function DataListItem({ label, value }) {
  return React.createElement(
    "div",
    null,
    React.createElement("dt", null, label),
    React.createElement("dd", null, value),
  );
};

// StatusBadge: a pill with a word ({ state, label }).
function StatusBadge({ state = "neutral", label, children }) {
  return React.createElement(
    "span",
    { "data-testid": "status-badge", "data-state": state },
    label || children,
  );
}
// DropdownPanel: rendered only while open; MenuItem2 is a button.
function DropdownPanel({ isOpen, children }) {
  return isOpen ? React.createElement("div", { role: "menu" }, children) : null;
}
function MenuItem2({ onClick, children }) {
  return React.createElement(
    "button",
    { type: "button", role: "menuitem", onClick },
    children,
  );
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

function EmptyState({ icon, title, description, children, testId }) {
  return React.createElement(
    "div",
    { "data-testid": testId || "empty-state", "data-icon": icon },
    React.createElement("span", null, title),
    description ? React.createElement("span", null, description) : null,
    children || null,
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
  children,
}) {
  // dash-react's real props are isOpen / confirmLabel / cancelLabel;
  // confirmText is kept for older callers. isOpen === false hides it.
  if (isOpen === false) return null;
  return React.createElement(
    "div",
    { "data-testid": "confirmation-modal" },
    React.createElement("span", null, title),
    // Like the real one: children win over message.
    children || (message ? React.createElement("span", null, message) : null),
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

// Sidebar stand-in (PanelEditItemHandlers): Content wraps, Item is a button.
function Sidebar({ children }) {
  return React.createElement("nav", null, children);
}
Sidebar.Content = function SidebarContent({ children }) {
  return React.createElement("div", null, children);
};
Sidebar.Item = function SidebarItem({ children, onClick, badge }) {
  return React.createElement(
    "button",
    { type: "button", onClick },
    children,
    badge ? React.createElement("span", null, badge) : null,
  );
};

// dash-react ≥1.0.65 ResizeHandle + useResizableWidth stand-ins: same
// width rules (clamp, remembered under storageKey, ← / → step 16px in the
// handle's direction, double-click reset), keyboard + double-click only.
function useResizableWidth({
  defaultWidth,
  min = 0,
  max = Infinity,
  edge = "left",
  storageKey = null,
}) {
  const read = () => {
    try {
      const raw = storageKey ? window.localStorage.getItem(storageKey) : null;
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch (_e) {
      return null;
    }
  };
  const [stored, setStored] = React.useState(read);
  const hi = Math.max(min, max);
  const clamp = (w) => Math.min(Math.max(w, min), hi);
  const width = clamp(stored == null ? defaultWidth : stored);
  const sign = edge === "left" ? -1 : 1;
  const set = (w) => {
    const next = clamp(w);
    setStored(next);
    if (storageKey) window.localStorage.setItem(storageKey, String(next));
  };
  const reset = () => {
    setStored(null);
    if (storageKey) window.localStorage.removeItem(storageKey);
  };
  return {
    width,
    setWidth: set,
    reset,
    handleProps: {
      value: width,
      min,
      max: hi,
      onResize: (start, dx) => set(start + sign * dx),
      onStep: (dir) => set(width + sign * dir * 16),
      onReset: reset,
    },
  };
}
function ResizeHandle({ value, min, max, onStep, onReset, ariaLabel }) {
  return React.createElement("div", {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": ariaLabel,
    "aria-valuenow": value,
    "aria-valuemin": min,
    "aria-valuemax": max,
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === "ArrowLeft") onStep && onStep(-1);
      if (e.key === "ArrowRight") onStep && onStep(1);
    },
    onDoubleClick: () => onReset && onReset(),
  });
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

// dash-react ActionMenu (consolidation Phase 3P): a ⋯ / ⋮ button (named by
// `label`) that opens a menu of actions; disabled ones can't run, danger and
// badge show as data attributes / text, "separator" strings split the list.
function ActionMenu({ label = "Actions", items = [], dot = false }) {
  const [open, setOpen] = React.useState(false);
  return React.createElement(
    "div",
    null,
    React.createElement(
      "button",
      {
        type: "button",
        "aria-label": label,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "data-dot": dot ? "true" : undefined,
        onClick: (e) => {
          e.stopPropagation();
          setOpen(!open);
        },
      },
      "⋯",
    ),
    open &&
      React.createElement(
        "div",
        { role: "menu", "aria-label": label },
        items.map((item, i) =>
          item === "separator"
            ? React.createElement("hr", { key: "sep-" + i })
            : item
              ? React.createElement(
                  "button",
                  {
                    key: item.key || item.label,
                    type: "button",
                    role: "menuitem",
                    "aria-disabled": item.disabled ? true : undefined,
                    "data-danger": item.danger ? "true" : undefined,
                    onClick: (e) => {
                      e.stopPropagation();
                      if (item.disabled) return;
                      setOpen(false);
                      if (item.onSelect) item.onSelect();
                    },
                  },
                  item.label,
                  item.badge ? " " + item.badge : null,
                )
              : null,
        ),
      ),
  );
}

// dash-react ≥1.0.69 ChoiceMenu: a menu button ("Type: Widget") that opens
// a menu of radio items; disabled options show their hint and can't be picked.
function ChoiceMenu({
  label,
  value,
  options = [],
  onChange,
  showLabel = true,
  footer = null,
}) {
  const [open, setOpen] = React.useState(false);
  const opts = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  const chosen = opts.find((o) => o.value === value);
  const text = chosen
    ? showLabel
      ? label + ": " + chosen.label
      : chosen.label
    : label;
  return React.createElement(
    "div",
    null,
    React.createElement(
      "button",
      {
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen(!open),
      },
      text,
    ),
    open &&
      React.createElement(
        "div",
        { role: "menu", "aria-label": label },
        opts.map((o) =>
          React.createElement(
            "button",
            {
              key: String(o.value),
              type: "button",
              role: "menuitemradio",
              "aria-checked": o.value === value,
              "aria-disabled": o.disabled ? true : undefined,
              onClick: () => {
                if (o.disabled) return;
                if (onChange) onChange(o.value);
                setOpen(false);
              },
            },
            o.label,
            o.disabled && o.hint
              ? " " + o.hint
              : o.description
                ? " " + o.description
                : "",
          ),
        ),
        footer,
      ),
  );
}

function Heading2({ title, children }) {
  return React.createElement(
    "div",
    null,
    children !== undefined ? children : title,
  );
}

// ---- Chat, list rows, panel header (dash-react ≥1.0.73) -----------------
function ChatMessage({
  role = "reply",
  label = null,
  meta = null,
  footer = null,
  streaming = false,
  testId,
  children,
}) {
  if (role === "note") {
    return React.createElement(
      "div",
      { role: "separator", "data-testid": testId },
      children,
    );
  }
  if (role === "you") {
    return React.createElement(
      "div",
      { "data-chat-role": "you", "data-testid": testId },
      children,
    );
  }
  return React.createElement(
    "div",
    {
      "data-chat-role": "reply",
      "data-testid": testId,
      "aria-busy": streaming || undefined,
    },
    label
      ? React.createElement("span", { "data-chat-label": true }, label)
      : null,
    meta ? React.createElement("span", { "data-chat-meta": true }, meta) : null,
    React.createElement("div", null, children),
    footer,
  );
}
function ChatToolCall({
  name,
  source = null,
  status = "done",
  children = null,
}) {
  const [open, setOpen] = React.useState(false);
  const word =
    { running: "Running", done: "Done", error: "Failed" }[status] || status;
  const head = [name, source ? " · " + source : "", " " + word];
  return React.createElement(
    "div",
    { "data-tool-status": status },
    children
      ? React.createElement(
          "button",
          {
            type: "button",
            "aria-expanded": open,
            onClick: () => setOpen((o) => !o),
          },
          ...head,
        )
      : React.createElement("div", null, ...head),
    children && open ? React.createElement("div", null, children) : null,
  );
}
const ChatComposer = React.forwardRef(function ChatComposer(
  {
    value = "",
    onChange = () => {},
    onSend = () => {},
    onStop = null,
    busy = false,
    disabled = false,
    placeholder = "Type a message…",
    ariaLabel = null,
    hint = "Enter to send · Shift+Enter for a new line",
    sendLabel = "Send",
    rows = 2,
    onKeyDown = null,
    above = null,
  },
  ref,
) {
  const canSend = !disabled && !busy && String(value).trim() !== "";
  const send = () => canSend && onSend(value);
  return React.createElement(
    "div",
    null,
    above,
    React.createElement("textarea", {
      ref,
      value,
      rows,
      placeholder,
      "aria-label": ariaLabel || placeholder || "Message",
      disabled,
      onChange: (e) => onChange(e.target.value, e),
      onKeyDown: (e) => {
        if (onKeyDown) onKeyDown(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      },
    }),
    busy && onStop
      ? React.createElement(
          "button",
          { type: "button", onClick: onStop },
          "Stop",
        )
      : React.createElement(
          "button",
          { type: "button", onClick: send, disabled: !canSend },
          sendLabel,
        ),
    hint ? React.createElement("span", null, hint) : null,
  );
});
function ListRow({
  title,
  meta = null,
  icon = null,
  trailing = null,
  selected = false,
  onClick = null,
  ariaLabel = null,
  testId,
}) {
  // A node icon (e.g. a status dot) renders; a string icon name doesn't.
  const iconNode = icon && typeof icon !== "string" ? icon : null;
  const main = onClick
    ? React.createElement(
        "button",
        {
          type: "button",
          onClick,
          "aria-current": selected ? "true" : undefined,
          "aria-label": ariaLabel || undefined,
        },
        iconNode,
        title,
        meta ? React.createElement("span", null, meta) : null,
      )
    : React.createElement(
        "div",
        null,
        iconNode,
        title,
        meta ? React.createElement("span", null, meta) : null,
      );
  return React.createElement("div", { "data-testid": testId }, main, trailing);
}
function PanelHeader({
  title,
  onBack = null,
  backLabel = "Back",
  actions = null,
  testId,
}) {
  return React.createElement(
    "div",
    { "data-testid": testId },
    onBack
      ? React.createElement("button", {
          type: "button",
          "aria-label": backLabel,
          onClick: onBack,
        })
      : null,
    React.createElement("span", null, title),
    actions,
  );
}

module.exports = {
  ChatMessage,
  ChatToolCall,
  ChatComposer,
  ListRow,
  PanelHeader,
  SectionLabel,
  SubHeading3,
  Sidebar,
  ResizeHandle,
  useResizableWidth,
  Toggle,
  ButtonIcon2: ButtonIcon,
  ButtonIcon3: ButtonIcon,
  isHexColor,
  deriveShades,
  TAILWIND_PALETTE,
  ThemeContext,
  Modal,
  Stepper,
  InputText,
  TextArea,
  SegmentedControl,
  CodeEditorVS,
  RadioGroup,
  FilterMenu,
  ChoiceMenu,
  ActionMenu,
  Heading2,
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
  DataList,
  Tag2,
  Tag3,
  SelectInput,
  EmptyState,
  ConfirmationModal,
  StatusBadge,
  DropdownPanel,
  MenuItem2,
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
