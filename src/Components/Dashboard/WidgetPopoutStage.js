import React, { useState, useEffect, useContext, Profiler } from "react";
import { DashboardWrapper, DashboardThemeProvider } from "../../Context";
import { DashboardContext, WorkspaceContext } from "../../Context";
import { WidgetFactory } from "../../Widget";
import { LayoutModel, WorkspaceModel } from "../../Models";
import { deepCopy } from "@trops/dash-react";
import { renderComponent } from "../../utils/layout";

/**
 * WidgetPopoutStage
 *
 * Renders a single widget from a workspace in a standalone popout window.
 * Used by Electron's widget popout route to display one widget independently.
 */
export const WidgetPopoutStage = ({
  dashApi,
  credentials,
  workspaceId,
  widgetId,
}) => {
  return (
    <Profiler id="widget-popout" onRender={() => {}}>
      <DashboardWrapper
        dashApi={dashApi}
        credentials={credentials}
        backgroundColor="bg-gray-900"
      >
        <WidgetPopoutInner
          dashApi={dashApi}
          credentials={credentials}
          workspaceId={workspaceId}
          widgetId={widgetId}
        />
      </DashboardWrapper>
    </Profiler>
  );
};

const WidgetPopoutInner = ({ dashApi, credentials, workspaceId, widgetId }) => {
  const { pub } = useContext(DashboardContext);
  const [workspace, setWorkspace] = useState(null);
  const [widgetItem, setWidgetItem] = useState(null);
  const [error, setError] = useState(null);

  function loadWorkspaces() {
    if (!dashApi || !credentials) return;

    dashApi.listWorkspaces(
      credentials.appId,
      (e, message) => {
        try {
          const workspaces = deepCopy(message["workspaces"]);
          const workspacesTemp = workspaces.map((ws) => {
            ws["layout"] = ws["layout"].map((layoutOG) =>
              LayoutModel(layoutOG, workspaces, ws["id"]),
            );
            if (ws.pages && Array.isArray(ws.pages)) {
              ws.pages = ws.pages.map((page) => {
                if (page.layout && Array.isArray(page.layout)) {
                  page.layout = page.layout.map((layoutOG) =>
                    LayoutModel(layoutOG, workspaces, ws["id"]),
                  );
                }
                return page;
              });
            }
            if (ws.sidebarLayout && Array.isArray(ws.sidebarLayout)) {
              ws.sidebarLayout = ws.sidebarLayout.map((layoutOG) =>
                LayoutModel(layoutOG, workspaces, ws["id"]),
              );
            }
            return WorkspaceModel(ws);
          });

          const target = workspacesTemp.find((ws) => ws.id === workspaceId);
          if (!target) {
            setError("Workspace not found");
            return;
          }

          setWorkspace(target);

          // Find the widget across all layout locations
          let widget = target.layout.find((item) => item.id === widgetId);

          if (!widget && target.pages && Array.isArray(target.pages)) {
            for (const page of target.pages) {
              if (page.layout && Array.isArray(page.layout)) {
                widget = page.layout.find((item) => item.id === widgetId);
                if (widget) break;
              }
            }
          }

          if (
            !widget &&
            target.sidebarLayout &&
            Array.isArray(target.sidebarLayout)
          ) {
            widget = target.sidebarLayout.find((item) => item.id === widgetId);
          }

          if (!widget) {
            setError("Widget not found in workspace");
            return;
          }

          // Merge provider selections: widget-level (persisted on layout item)
          // takes priority, workspace-level (keyed by uuid) is the fallback
          const widgetWithProviders = {
            ...widget,
            selectedProviders: {
              ...(target.selectedProviders?.[widget.uuid] || {}),
              ...(widget.selectedProviders || {}),
            },
          };

          setWidgetItem(widgetWithProviders);

          // Set popout window title
          const widgetName =
            widget.userPrefs?.title || widget.component || "Widget";
          if (window.mainApi?.widgetPopout?.setTitle) {
            window.mainApi.widgetPopout.setTitle(
              workspaceId,
              widgetId,
              widgetName,
            );
          }
        } catch (err) {
          console.error("[WidgetPopoutStage] Error loading workspaces:", err);
          setError(err.message);
        }
      },
      (e, message) => {
        console.error("[WidgetPopoutStage] Error loading workspaces:", message);
        setError("Failed to load workspace");
      },
    );
  }

  // Initial load
  useEffect(() => {
    loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, widgetId]);

  // Listen for workspace:saved broadcasts to refresh
  useEffect(() => {
    if (!window.mainApi?.on) return;

    const handler = () => {
      loadWorkspaces();
    };
    window.mainApi.on("workspace:saved", handler);
    return () => {
      if (window.mainApi?.removeListener) {
        window.mainApi.removeListener("workspace:saved", handler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center text-gray-400 gap-2">
        <div className="text-lg font-semibold">Widget not available</div>
        <div className="text-sm text-gray-500">{error}</div>
      </div>
    );
  }

  if (!widgetItem || !workspace) {
    return (
      <div className="flex h-full w-full items-center justify-center text-gray-500">
        Loading widget...
      </div>
    );
  }

  return (
    <DashboardThemeProvider themeKey={workspace?.themeKey}>
      <WorkspaceContext.Provider value={{ workspaceData: workspace }}>
        <div className="flex flex-col w-full h-full overflow-auto">
          {renderComponent(
            widgetItem.component,
            widgetItem.id,
            widgetItem,
            null,
          )}
        </div>
      </WorkspaceContext.Provider>
    </DashboardThemeProvider>
  );
};
