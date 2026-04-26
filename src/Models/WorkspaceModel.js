import { deepCopy } from "@trops/dash-react";
import { LayoutModel } from "./LayoutModel";
import { pruneDeadListenerReferences } from "../utils/listenerResolution";
import { migrateScopedIdsInWorkspace } from "../utils/migrateScopedIdsInWorkspace";
import { cleanForeignWidgetsFromWorkspace } from "../utils/cleanForeignWidgetsFromWorkspace";
import { migrateLayoutItemTypes } from "../utils/migrateLayoutItemTypes";
import { ComponentManager } from "../ComponentManager";

/**
 * Default layout for a brand-new workspace: a single 1x1 grid container
 * with one empty cell. Mirrors DashboardModel._initializeLayout().
 */
function defaultGridLayout() {
  return [
    LayoutModel(
      {
        id: 1,
        order: 1,
        type: "grid",
        component: "LayoutGridContainer",
        hasChildren: 1,
        scrollable: false,
        parent: 0,
        menuId: 1,
        width: "w-full",
        height: "h-full",
        grid: {
          rows: 1,
          cols: 1,
          gap: "gap-2",
          1.1: { component: null, hide: false },
        },
      },
      [],
    ),
  ];
}

/**
 * A Model for a Workspace (Dashboard)
 * The Workspace in this instance is the entire Dashboard Layout inclusive of the workspaces and widgets
 * When the user selects a Dashboard, this is the model that stores that information.
 */
export const WorkspaceModel = (workspaceItem) => {
  const obj =
    workspaceItem !== null && workspaceItem !== undefined
      ? deepCopy(workspaceItem)
      : {};

  const workspace = {};
  const validWorkspaceProperties = [
    "id",
    "name",
    "type",
    "label",
    "layout",
    "pages",
    "activePageId",
    "sidebarEnabled",
    "sidebarLayout",
    "sidebarWidth",
    "menuId",
    "version",
    "selectedProviders",
    "themeKey",
  ];
  const validWorkspaceTypes = ["layout", "widget", "workspace"];

  function sanitizeType(t) {
    return validWorkspaceTypes.includes(t) === true ? t : "workspace";
  }

  /**
   * sanitize workspace model
   *
   * If this contains any properties that are NOT part of the model
   * we should remove them
   *
   * @param {object} w the workspace model
   * @returns
   */
  function sanitizeWorkspaceObject(w) {
    Object.keys(w).forEach((workspaceKey) => {
      if (validWorkspaceProperties.includes(workspaceKey) === false) {
        // delete w[workspaceKey];
      }
    });
    return w;
  }

  workspace.id = "id" in obj ? obj["id"] : Date.now();
  workspace.name = "name" in obj ? obj["name"] : "New Dashboard";
  workspace.type = "type" in obj ? sanitizeType(obj["type"]) : "workspace";
  workspace.label = "label" in obj ? obj["label"] : "New Dashboard";
  workspace.version = "version" in obj ? obj["version"] : 1;
  // Use the provided layout if it exists and is non-empty; otherwise
  // create a default 1x1 grid so the workspace always has a renderable
  // grid container.
  const rawLayout =
    "layout" in obj && Array.isArray(obj["layout"]) && obj["layout"].length > 0
      ? obj["layout"]
      : defaultGridLayout();

  // Normalize each layout item through LayoutModel so renderers get a
  // fully-shaped object (contexts, listeners, eventHandlers, etc.).
  // Without this, layouts coming from createLayoutFromTemplate (the
  // wizard) are missing fields and the grid container fails to render.
  // Skip items already produced by LayoutModel (idempotent: LayoutModel
  // is safe to call on its own output).
  const wsId = "id" in obj ? obj["id"] : workspace.id;
  // LayoutModel returns null when an item can't be normalized (e.g.
  // throw inside its catch). A null in the layout array crashes
  // downstream forEach/map consumers with `Cannot read properties of
  // null (reading 'type')`. Filter nulls so the renderer never sees
  // them — the original raw item is already lost at that point, so
  // dropping it is the only safe action.
  workspace.layout = rawLayout
    .map((item) => LayoutModel(item, rawLayout, wsId))
    .filter((item) => item != null);
  workspace.pages = "pages" in obj ? obj["pages"] : [];
  workspace.activePageId = "activePageId" in obj ? obj["activePageId"] : null;

  // Always-pages model: every workspace must have at least one page.
  // If the source data is single-page (empty pages array), wrap the
  // layout into pages[0] so renderers always have a page to display.
  // The page is named "Page 1" — when only one page exists, the
  // PageTabBar hides it; when the user adds a second page, both
  // "Page 1" and the new page become visible. Idempotent.
  if (!Array.isArray(workspace.pages) || workspace.pages.length === 0) {
    const page = {
      id: `page-${workspace.id || Date.now()}`,
      name: "Page 1",
      order: 0,
      layout: workspace.layout,
    };
    workspace.pages = [page];
    workspace.activePageId = page.id;
  }
  workspace.sidebarEnabled =
    "sidebarEnabled" in obj ? obj["sidebarEnabled"] : false;
  workspace.sidebarLayout = "sidebarLayout" in obj ? obj["sidebarLayout"] : [];
  workspace.sidebarWidth = "sidebarWidth" in obj ? obj["sidebarWidth"] : 280;
  // workspace.layout =
  //     "layout" in obj
  //         ? sanitizeLayout(obj["layout"], workspace.id)
  //         : [
  //               LayoutModel(
  //                   {
  //                       workspace: "layout",
  //                       type: "workspace",
  //                       dashboardId: workspace.id,
  //                       parent: 0,
  //                       id: 1,
  //                   },
  //                   [],
  //                   workspace.id
  //               ),
  //               LayoutModel(
  //                   {
  //                       id: 2,
  //                       workspace: workspace.name,
  //                       type: "layout",
  //                       dashboardId: workspace.id,
  //                       parent: 1,
  //                   },
  //                   [],
  //                   workspace.id
  //               ),
  //           ];
  workspace.menuId = "menuId" in obj ? obj["menuId"] : 1;
  workspace.selectedProviders =
    "selectedProviders" in obj ? obj["selectedProviders"] : {};
  workspace.themeKey = "themeKey" in obj ? obj["themeKey"] : null;

  // Cross-dashboard contamination cleanup. Some earlier code path
  // (most likely a shared sidebarLayout array reference between two
  // open dashboards) leaked items from other workspaces' trees into
  // this one. Running on every load means the next save writes the
  // cleaned shape; corrupted state is self-healing.
  cleanForeignWidgetsFromWorkspace(workspace);

  // Migrate legacy bare component refs (`PipelineKanban`) and the
  // listener event strings that reference them (`PipelineKanban[5].evt`)
  // to the canonical scoped form (`trops.pipeline.PipelineKanban`).
  // Runs BEFORE pruneDeadListenerReferences — without this, prune
  // sees bare listener strings vs scoped layout items, treats every
  // legacy listener as an orphan, and silently deletes the user's
  // wiring on first load post-v0.1.435.
  migrateScopedIdsInWorkspace(workspace, ComponentManager.componentMap());

  // Pre-v0.1.444 LayoutModel defaulted `item.type` to "layout" — every
  // widget instance persisted without an explicit type was silently
  // typed as a container, breaking any UI that filtered by type.
  // The new default infers from component name; this migration applies
  // the same inference to legacy on-disk data so existing
  // workspaces.json heals on the next save.
  migrateLayoutItemTypes(workspace);

  // Strip any listener bindings whose source widget is no longer in
  // the tree. These "orphan" bindings are dead — they don't match any
  // live publisher and never fire — so they're safe to remove at load
  // time before the renderer wires up subscriptions.
  pruneDeadListenerReferences(workspace);

  return sanitizeWorkspaceObject(workspace);
};
