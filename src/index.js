/**
 * @trops/dash-core
 *
 * Core framework for Dash dashboard applications.
 * Platform-agnostic renderer layer — no Electron dependencies.
 */

// --- Core ---
export { DashboardPublisher } from "./DashboardPublisher";
export { ComponentManager } from "./ComponentManager";
export { default as ErrorBoundary } from "./ErrorBoundary";

// --- Context ---
export * from "./Context";

// --- Models ---
export * from "./Models";

// --- Hooks ---
export * from "./hooks";

// --- API Layer ---
export * from "./Api";

// --- Widget ---
export * from "./Widget";

// --- Components ---
export * from "./Components/Dashboard";
export * from "./Components/Layout";
export * from "./Components/Navigation";
export * from "./Components/Settings";
export * from "./Components/Theme";
export * from "./Components/Provider";
export * from "./Components/Menu";
export * from "./Components/Workspace";

// --- Utils ---
export * from "./utils";

// --- Auto-register container types ---
// When dash-core is imported, register Layout components with ComponentManager
// so consumers don't need to wire this themselves.
import { ComponentManager } from "./ComponentManager";
import { LayoutContainer } from "./Components/Layout";
import { LayoutGridContainer } from "./Components/Layout";
ComponentManager.registerContainerTypes(LayoutContainer, LayoutGridContainer);
