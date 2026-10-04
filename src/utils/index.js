// Utility exports
// UI-focused utilities come from dash-react to avoid duplication.
export * from "@trops/dash-react";

// Dash-specific utilities
export * from "./layout";
export * from "./widgetBundleLoader";
export * from "./widgetPreviewRenderer";
export * from "./widgetOwnership";
export * from "./dragTypes";
export * from "./resolveIcon";
export * from "./validation";
export * from "./mcpUtils";
export * from "./providerUtils";
export * from "./scopedComponentId";
export * from "./themeGenerator";
export * from "./markdownFormParser";
export * from "./humanizeAction";
export * from "./computeDashboardPreflight";
// Markdown → sanitized HTML for any model/tool text shown as HTML (widgets
// use it too).
export * from "./safeMarkdown";
// Note: DynamicWidgetLoader and WidgetRegistry are Electron-only
// export * from "./DynamicWidgetLoader";
// export * from "./WidgetRegistry";
