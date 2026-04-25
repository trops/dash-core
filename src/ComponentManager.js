import { deepCopy } from "@trops/dash-react";
import { ComponentConfigModel } from "./Models";
import { resolveComponentKey } from "./utils/resolveComponentKey";
import { makeScopedComponentId } from "./utils/scopedComponentId";

export { resolveComponentKey };

let _componentMap = {};
let _containerComponent = null;
let _gridContainerComponent = null;

/**
 * Compute the canonical `scope.package.Component` id for a widget
 * config. Throws if the config doesn't carry enough origin metadata
 * to derive an id.
 *
 * Order of precedence:
 *   - `config.id` already scoped (3 dot-separated parts, no leading "@")
 *   - `config.scope` + `config.packageName` + (`config.name` |
 *     `config.component?.displayName` | `config.component?.name`)
 *   - Otherwise throw — the config is missing origin info and would
 *     register under an ambiguous key.
 *
 * The `widgetKey` is consulted ONLY when both above paths fail and
 * the key itself is already a scoped id; this preserves compat with
 * callers that pass a fully-qualified registration key.
 */
function canonicalScopedId(config, widgetKey) {
  const looksScoped = (s) =>
    typeof s === "string" && s.split(".").length === 3 && !s.includes("/");
  if (looksScoped(config?.id)) return config.id;
  if (looksScoped(widgetKey)) return widgetKey;
  if (config?.scope && config?.packageName) {
    const componentName =
      config.name ||
      config.component?.displayName ||
      config.component?.name ||
      null;
    if (componentName) {
      return makeScopedComponentId(
        `${String(config.scope).replace(/^@/, "")}/${config.packageName}`,
        componentName,
      );
    }
  }
  const dump = JSON.stringify({
    id: config?.id,
    scope: config?.scope,
    packageName: config?.packageName,
    name: config?.name,
    widgetKey,
  });
  throw new Error(
    `[ComponentManager] Cannot register widget — missing origin metadata. ` +
      `Need either a scoped \`id\` (scope.package.Component) or ` +
      `\`scope\` + \`packageName\` + \`name\`. Got: ${dump}`,
  );
}

export const ComponentManager = {
  // _componentMap: {},

  /**
   * registerContainerTypes
   * Register the layout container components used by the framework.
   * This decouples ComponentManager from direct Layout imports.
   *
   * @param {Function} containerComponent - The LayoutContainer (flexbox) component
   * @param {Function} gridContainerComponent - The LayoutGridContainer (grid) component
   */
  registerContainerTypes: function (
    containerComponent,
    gridContainerComponent,
  ) {
    _containerComponent = containerComponent;
    _gridContainerComponent = gridContainerComponent;
  },

  /**
   * init
   * @param {object} configs
   */
  init: function (configs) {
    if (configs) {
      Object.keys(configs).forEach((key) => {
        this.registerWidget(configs[key], key);
      });
    }
  },

  setComponentMap: function (cm) {
    _componentMap = cm;
  },

  componentMap: function () {
    return _componentMap;
  },

  /**
   * Resolve a component reference to its registered config. Strict
   * exact-match lookup against the registry. Layout items are
   * expected to carry the canonical scoped id
   * (`scope.package.Component`); `LayoutModel` migrates legacy bare
   * names to the scoped form on dashboard load.
   *
   * Returns null when the widget isn't registered — the renderer then
   * shows `WidgetNotFound`. There is no fallback.
   *
   * @param {string} component - The scoped widget id
   * @returns {object|null} the live registered config, or null
   */
  resolve: function (component) {
    const m = _componentMap;
    if (!m) return null;
    const key = resolveComponentKey(m, component);
    return key ? m[key] || null : null;
  },

  /**
   * Register a widget config under its canonical scoped id.
   *
   * Every widget that enters the registry MUST have a scope.package
   * .Component id. The id is determined in this order:
   *   1. `config.id` already in scoped form → trust it.
   *   2. `config.scope` + `config.packageName` + `config.name` → derive.
   *   3. Otherwise → throw. Silent fallbacks here are how layouts end
   *      up referencing widgets that were registered under the wrong
   *      key, so we fail loudly at registration instead of producing
   *      a corrupt registry.
   *
   * `widgetKey` is kept for backwards compatibility with callers that
   * pass a string key; it is consulted ONLY as a tiebreak when the
   * config is otherwise complete.
   *
   * @param {Object} widgetConfig the widget configuration script
   * @param {string} [widgetKey] legacy fallback key (informational only)
   * @throws if origin metadata is missing
   */
  registerWidget: function (widgetConfig, widgetKey) {
    const tempComponentMap = this.componentMap();
    const config = widgetConfig.default || widgetConfig;
    const id = canonicalScopedId(config, widgetKey);
    config.id = id;
    tempComponentMap[id] = ComponentConfigModel(config);
    this.setComponentMap(tempComponentMap);
  },

  /**
   * map
   * Get a map of all of the registered components in the application
   * @returns object
   */
  map: function () {
    // copy
    let componentsCopy = deepCopy(this.componentMap());
    if (componentsCopy) {
      // additional INTERNAL components that we need

      // Legacy flexbox container (deprecated, use LayoutGridContainer)
      componentsCopy["Container"] = {
        name: "Container",
        component: _containerComponent,
        canHaveChildren: true,
        userConfig: {},
        workspace: "layout",
        type: "workspace",
        width: "w-full",
      };

      // Grid-first container (primary container type)
      componentsCopy["LayoutGridContainer"] = {
        name: "LayoutGridContainer",
        component: _gridContainerComponent,
        canHaveChildren: true,
        userConfig: {},
        workspace: "layout",
        type: "grid",
        width: "w-full",
        grid: {
          rows: 1,
          cols: 1,
          gap: "gap-2",
          1.1: { component: null, hide: false },
        },
      };

      return componentsCopy;
    }
    return {};
  },
  /**
   * Fetch the React Component from the map of registered components
   * @param {string} component the component/widget in the componentMap
   * @returns {Widget} the Widget in the component map
   */
  getComponent: function (component) {
    try {
      if (component && this.componentMap()) {
        if (ComponentManager.isLayoutContainer(component) === false) {
          const m = this.componentMap();
          // Strict scoped-id lookup. If the layout item didn't carry
          // a scoped id, LayoutModel should have migrated it before
          // we get here.
          const resolvedKey = resolveComponentKey(m, component);
          let cmp = resolvedKey ? m[resolvedKey] : null;

          if (cmp !== null && cmp !== undefined) {
            cmp["componentName"] = resolvedKey;
            return cmp;
          }
        } else {
          // Handle LayoutGridContainer (new grid-first architecture)
          if (component === "LayoutGridContainer") {
            return {
              name: "LayoutGridContainer",
              component: _gridContainerComponent,
              canHaveChildren: true,
              userConfig: {},
              workspace: "layout",
              type: "grid",
              width: "w-full",
              grid: {
                rows: 1,
                cols: 1,
                gap: "gap-2",
                1.1: { component: null, hide: false },
              },
            };
          }

          // Handle legacy Container (flexbox)
          return {
            name: "Container",
            component: _containerComponent,
            canHaveChildren: true,
            userConfig: {},
            workspace: "layout",
            type: "workspace",
            width: "w-full",
          };
        }
      }
    } catch (e) {
      return null;
    }
  },

  getWorkspaceByName: function (workspaceName) {
    try {
      const m = this.componentMap();
      let workspaceComponent = null;
      if (m) {
        Object.keys(m).forEach((componentName) => {
          const cmp = m[componentName];
          if (
            (cmp.workspace === `${workspaceName}-workspace` ||
              cmp.workspace === workspaceName) &&
            cmp["type"] === "workspace"
          ) {
            cmp["component"] = componentName;
            workspaceComponent = cmp;
          }
        });
        return workspaceComponent;
      }
    } catch (e) {
      return null;
    }
  },

  getCompatibleWidgetsForWorkspace: function (workspaceName) {
    try {
      const m = this.componentMap();
      if (m) {
        return Object.keys(m).filter((componentName) => {
          const cmp = m[componentName];
          if (
            (cmp.workspace === `${workspaceName}-workspace` ||
              cmp.workspace === workspaceName) &&
            cmp["type"] === "widget"
          ) {
            cmp["component"] = componentName;
            return componentName;
          }
          return false;
        });
      }
    } catch (e) {
      return null;
    }
  },

  getWorkspaces: function () {
    try {
      const m = this.componentMap();
      if (m) {
        return Object.keys(m).filter((componentName) => {
          const cmp = m[componentName];
          if (cmp["type"] === "workspace") {
            cmp["component"] = componentName;
            return componentName;
          }
          return false;
        });
      }
    } catch (e) {
      return null;
    }
  },

  getWidgets: function () {
    try {
      const m = this.componentMap();
      if (m) {
        console.log("widget names available ", Object.keys(m));
        return Object.keys(m).filter((componentName) => {
          const cmp = m[componentName];
          if (cmp["type"] === "widget") {
            cmp["component"] = componentName;
            return componentName;
          }
          return false;
        });
      }
    } catch (e) {
      return null;
    }
  },

  getContextsForLayout: function (config) {
    try {
      const m = this.componentMap();
      const contexts = [];
      if (m) {
        config.layout.forEach((item) => {
          if ("contexts" in item && item.contexts) {
            item.contexts.forEach((context) => {
              // we want to push the Context component and the user configuration data
              contexts.push({
                provider: m[context],
                props: item,
              });
            });
          }
        });
      }
      return contexts;
    } catch (e) {
      console.log("error getting contexts ", e);
      return null;
    }
  },
  /**
   * Get the context by name, so that we can render all of the contexts around the dashboard widgets selected
   * @param {String} contextName the name of the context to be fetched
   * @returns
   */
  getContextByName: function (contextName) {
    try {
      const m = this.componentMap();
      let contextComponent = null;
      if (m) {
        Object.keys(m).forEach((componentName) => {
          const cmp = m[componentName];
          if (
            cmp.workspace === `${contextName}-context` &&
            cmp["type"] === "context"
          ) {
            cmp["component"] = componentName;
            contextComponent = cmp;
          }
        });
        return contextComponent;
      }
    } catch (e) {
      return null;
    }
  },

  config: function (component, data = {}) {
    try {
      if (component) {
        const requiredFields = {
          type: { value: "text" },
          required: { value: false },
          options: { value: [] },
          defaultValue: { value: "" },
        };

        const components = this.map();
        const resolvedKey = resolveComponentKey(components, component);
        if (resolvedKey && resolvedKey in components) {
          const tempComponent = components[resolvedKey];
          delete tempComponent["component"];
          let c = JSON.parse(JSON.stringify(tempComponent));
          c["component"] = resolvedKey;

          if ("userConfig" in c === false) {
            c["userConfig"] = {};
          }

          let userPrefs = {};
          if ("userConfig" in c) {
            Object.keys(c["userConfig"]).forEach((key) => {
              Object.keys(requiredFields).forEach((k) => {
                if (k in c["userConfig"][key]) {
                  if (k in c["userConfig"][key] === false) {
                    c["userConfig"][key] = requiredFields[k]["value"];
                  }
                }
              });
              userPrefs[key] = ComponentManager.userPrefsForItem(
                "userPrefs" in data ? data : c,
                key,
                c["userConfig"][key],
              );
            });
          }

          c["userPrefs"] = userPrefs;

          // Identity fields (id/package/scope/...) are forwarded so
          // consumers can derive the package label without reading
          // the live registry directly. Without these, callers fall
          // back to `item.workspace` which is a category, not a
          // package, and produce labels like `@DashSamples-workspace`.
          return {
            id: resolvedKey,
            type: c["type"],
            name: c["name"],
            displayName: c["displayName"],
            workspace: c["workspace"],
            canHaveChildren: c["canHaveChildren"],
            userPrefs: c["userPrefs"],
            userConfig: c["userConfig"],
            styles: "styles" in c ? c["styles"] : {},
            events: "events" in c ? c["events"] : [],
            eventHandlers: "eventHandlers" in c ? c["eventHandlers"] : [],
            providers: "providers" in c ? c["providers"] : [],
            notifications: "notifications" in c ? c["notifications"] : [],
            scheduledTasks: "scheduledTasks" in c ? c["scheduledTasks"] : [],
            icon: "icon" in c ? c["icon"] : null,
            scope: c["scope"],
            packageName: c["packageName"],
            package: c["package"],
            author: c["author"],
            version: c["version"],
            _sourcePackage: c["_sourcePackage"],
          };
        }
        return null;
      }
      return null;
    } catch (e) {
      console.log("error getting config for component ", component, e);
      return null;
    }
  },
  /**
   * userConfig
   * We want to make sure all of the keys are available, and if not, set defaults...
   * @param {object} config the current configuration object
   * @returns
   */
  userPrefsForItem: function (item, key, config) {
    try {
      let prefsForItem = {};
      if ("userPrefs" in item) {
        if (key in item["userPrefs"]) {
          prefsForItem = item["userPrefs"][key];
        } else {
          if ("defaultValue" in config) {
            prefsForItem = config["defaultValue"];
          }
        }
      } else {
        // no user preferences in the item yet so we can try and set the defaults.
        prefsForItem = "defaultValue" in config ? config["defaultValue"] : "";
      }
      return prefsForItem;
    } catch (e) {
      return {};
    }
  },
  /**
   * isLayoutContainer
   * Check if the component is a layout container (includes both grid and flexbox containers)
   * @param {string} component the string name of the component to be matched in the component config file
   * @returns boolean
   */
  isLayoutContainer: function (component) {
    return (
      component === "LayoutContainer" ||
      component === "Container" ||
      component === "LayoutGridContainer"
    );
  },

  /**
   * isGridContainer
   * Check if the component is a grid container (new grid-first architecture)
   * @param {string|object} component the component name (string) or component object
   * @returns boolean
   */
  isGridContainer: function (component) {
    // Handle string component names
    if (typeof component === "string") {
      return component === "LayoutGridContainer";
    }

    // Handle component objects
    if (component && typeof component === "object") {
      // Check by component name
      if (component.component === "LayoutGridContainer") {
        return true;
      }

      // Check by type
      if (component.type === "grid") {
        return true;
      }

      // Check if it has a grid property
      if (component.grid !== null && component.grid !== undefined) {
        return true;
      }
    }

    return false;
  },
};
