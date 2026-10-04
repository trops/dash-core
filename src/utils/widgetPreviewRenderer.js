/**
 * widgetPreviewRenderer — the host app's live widget preview (app-navigation
 * PRD NAV-011). dash-core can't render widget bundles in isolation itself (the
 * iframe sandbox lives in the host app), so the host registers a component
 * here at startup — the same pattern as setHostModules. The Widgets page shows
 * a live preview only when one is registered.
 *
 * Contract — the registered component receives:
 *   bundleSource      the widget package's CJS bundle (string)
 *   componentName     the widget to mount from it
 *   widgetData        { providers, selectedProviders, userPrefs, uuidString }
 *   declaredProviders provider types the widget may use (others are withheld)
 *   props             the widget's props (userConfig defaults)
 *   onMounted()       the widget rendered
 *   onError({ message, stack? })  the widget failed (inside the sandbox)
 */
let _renderer = null;

export function setWidgetPreviewRenderer(Component) {
  _renderer =
    typeof Component === "function" ||
    (Component && typeof Component === "object" && Component.$$typeof)
      ? Component
      : null;
}

export function getWidgetPreviewRenderer() {
  return _renderer;
}
