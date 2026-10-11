/**
 * widgetBuilderRenderer — the host app's AI Widget Builder, shown inside the
 * Create screen (create-entry PRD CRE-005 AC1). The builder lives in the host
 * app (dash-electron), so the host registers a component here at startup —
 * the same pattern as setWidgetPreviewRenderer. With none registered, Create
 * opens the builder the old way (the `dash:open-widget-builder` event).
 *
 * Contract — the registered component receives:
 *   initialPrompt   the user's description (a new widget), or null
 *   resumeDraftId   a draft to continue, or null
 *   onClose()       the builder is done (installed, or the user closed it):
 *                   close Create
 *   onTitle(text)   optional — the widget's name once known, for the header
 * It fills its container (flex column, full height) and finishes any install
 * itself when it unmounts, so Back and Close never lose one.
 */
let _renderer = null;

export function setWidgetBuilderRenderer(Component) {
  _renderer =
    typeof Component === "function" ||
    (Component && typeof Component === "object" && Component.$$typeof)
      ? Component
      : null;
}

export function getWidgetBuilderRenderer() {
  return _renderer;
}
