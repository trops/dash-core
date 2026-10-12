/**
 * Create screen (create-entry PRD CRE-001/005/008): what each Type offers and
 * what Send does. Kept apart from the modal so it can be tested on its own.
 */

export const CREATE_TYPES = [
  {
    value: "auto",
    label: "Auto",
    description: "Describe anything — Dash works out what to make",
  },
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
    description: "Plan a whole dashboard with your Dash team",
  },
  {
    value: "theme",
    label: "Theme",
    description: "Colors for the app, made from a description",
  },
];

/**
 * The types on offer. Dashboard opens the Dash team's Planner (phase 4); on
 * for everyone since building, fixing and removing a build shipped (4d-3).
 */
export function createTypes() {
  return CREATE_TYPES;
}

/** A type the screen can open on; anything else falls back to Auto. */
export function normalizeCreateType(type) {
  const pickable = createTypes()
    .filter((t) => !t.disabled)
    .map((t) => t.value);
  return pickable.includes(type) ? type : "auto";
}

export const PROMPT_PLACEHOLDER = {
  auto: "Describe what you want — a widget, a bot, a whole dashboard or a theme",
  theme: "Describe the look — colors, mood, or a brand",
  widget: "Describe the widget — what it shows and where the data comes from",
  bot: "Describe what the bot should do — this becomes its instructions",
  dashboard: "Describe the dashboard — what it's for and what it should show",
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

/** How many recent widget drafts the start screen offers to continue. */
export const RECENT_DRAFTS = 3;

/** "just now" · "5m ago" · "3h ago" · "2d ago" for a draft's updatedAt. */
export function draftAge(updatedAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(updatedAt || 0));
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Whether Send can run: a prompt, and an AI for types that need one. */
export function canSend({ type, prompt, aiBackend }) {
  if (!String(prompt || "").trim()) return false;
  if (type === "widget" || type === "theme") return !!aiBackend;
  // The Planner runs on its own model source (Bots page › Dash team); Auto
  // falls back to a keyword guess without an AI.
  return type === "bot" || type === "dashboard" || type === "auto";
}

/**
 * What Send does for a type.
 *   widget → open the Widget Builder with the prompt as the first message
 *   bot    → the bot form, the prompt as its instructions (no AI needed to
 *            create it; the bot uses its own AI when it runs)
 *   dashboard → the Planner, the prompt as the first message (phase 4)
 *   auto   → work out which of the above (or theme) first (phase 5c)
 *   theme  → the AI makes a theme; it opens unsaved in the theme editor
 */
export function routeCreate({ type, prompt, workspaceId = null }) {
  const text = String(prompt || "").trim();
  if (type === "widget") {
    return { kind: "widget-builder", detail: { prompt: text } };
  }
  if (type === "dashboard") {
    return { kind: "dashboard-plan", detail: { prompt: text } };
  }
  if (type === "bot") {
    return {
      kind: "bot-form",
      bot: { instructions: text },
      workspaceId,
    };
  }
  if (type === "auto") return { kind: "auto", detail: { prompt: text } };
  if (type === "theme") return { kind: "theme", detail: { prompt: text } };
  return null;
}
