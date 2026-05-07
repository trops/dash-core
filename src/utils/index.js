// Utility exports
// UI-focused utilities come from dash-react to avoid duplication.
export * from "@trops/dash-react";

// Dash-specific utilities
export * from "./layout";
export * from "./widgetBundleLoader";
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
// Note: DynamicWidgetLoader and WidgetRegistry are Electron-only
// export * from "./DynamicWidgetLoader";
// export * from "./WidgetRegistry";
