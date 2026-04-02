// Main application stage component (renamed from Dashboard to DashboardStage)
export { DashboardStage } from "./DashboardStage";
// Backward compatibility: re-export DashboardStage as Dashboard
export { DashboardStage as Dashboard } from "./DashboardStage";

export { WelcomePrompt, WELCOME_STORAGE_KEY } from "./WelcomePrompt";
export * from "./DashboardFooter";
export * from "./DashboardHeader";
export * from "./DashboardMonitor";
export * from "./PinnedSidebar";
export * from "./WidgetPopoutStage";
// Re-export from canonical location for backward compatibility
export { DashboardPublisher } from "../../DashboardPublisher";
