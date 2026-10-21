/**
 * Whether a failing widget gets "Fix with AI": an installed one (a scoped
 * id, or AI-built) — Create › Change <widget> on it, with the error
 * (consolidation Phase 3); the Dash team fixes it in place, or as a new
 * widget. Built-ins (the dash. scope) ship with Dash; nothing to change.
 */
export function canFixWithAi(widgetName) {
  return (
    typeof widgetName === "string" &&
    !widgetName.startsWith("dash.") &&
    (widgetName.split(".").length >= 3 ||
      /(^|[./])ai-built\b/i.test(widgetName))
  );
}
