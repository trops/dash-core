/**
 * Create screen (create-entry PRD CRE-001/005/008): what each Type offers and
 * what Send does. Kept apart from the modal so it can be tested on its own.
 */

export const CREATE_TYPES = [
  {
    value: "widget",
    label: "Widget",
    description: "One widget, built with AI",
  },
  {
    value: "bot",
    label: "Bot",
    description: "A bot that works for you on a schedule or on events",
  },
  {
    value: "dashboard",
    label: "Dashboard",
    disabled: true,
    hint: "Making whole dashboards with AI comes later — start one without AI below",
  },
  {
    value: "theme",
    label: "Theme",
    disabled: true,
    hint: "Making themes with AI comes later — use New theme below",
  },
];

const PICKABLE = new Set(
  CREATE_TYPES.filter((t) => !t.disabled).map((t) => t.value),
);

/** A type the screen can open on; anything else falls back to Widget. */
export function normalizeCreateType(type) {
  return PICKABLE.has(type) ? type : "widget";
}

export const PROMPT_PLACEHOLDER = {
  widget: "Describe the widget — what it shows and where the data comes from",
  bot: "Describe what the bot should do — this becomes its instructions",
};

/**
 * Start without AI. Dashboard and theme actions are always offered; each
 * type adds its own.
 */
export const NO_AI_COMMON = [
  {
    key: "blank-dashboard",
    label: "Blank dashboard",
    icon: "table-cells-large",
  },
  {
    key: "import-dashboard",
    label: "Import dashboard from file",
    icon: "file-import",
  },
  {
    key: "browse-dashboards",
    label: "Browse dashboards in the registry",
    icon: "magnifying-glass",
  },
  { key: "new-theme", label: "New theme", icon: "palette" },
];

export const NO_AI_BY_TYPE = {
  widget: [
    {
      key: "browse-widgets",
      label: "Browse widgets in the registry",
      icon: "magnifying-glass",
    },
    {
      key: "widget-zip",
      label: "Install a widget from file",
      icon: "file-zipper",
    },
    {
      key: "widget-folder",
      label: "Load a widget from a folder",
      icon: "folder-open",
    },
  ],
  bot: [{ key: "blank-bot", label: "Fill in the bot form", icon: "robot" }],
};

export function noAiOptions(type) {
  return [...(NO_AI_BY_TYPE[type] || []), ...NO_AI_COMMON];
}

/** Whether Send can run: a prompt, and an AI for types that need one. */
export function canSend({ type, prompt, aiBackend }) {
  if (!String(prompt || "").trim()) return false;
  if (type === "widget") return !!aiBackend;
  return type === "bot";
}

/**
 * What Send does for a type.
 *   widget → open the Widget Builder with the prompt as the first message
 *   bot    → the bot form, the prompt as its instructions (no AI needed to
 *            create it; the bot uses its own AI when it runs)
 */
export function routeCreate({ type, prompt, workspaceId = null }) {
  const text = String(prompt || "").trim();
  if (type === "widget") {
    return { kind: "widget-builder", detail: { prompt: text } };
  }
  if (type === "bot") {
    return {
      kind: "bot-form",
      bot: { instructions: text },
      workspaceId,
    };
  }
  return null;
}
