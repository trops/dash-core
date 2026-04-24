/**
 * Dynamic Widget Loader
 *
 * Loads React components and configurations from downloaded/local widget paths
 * Works with widgets that follow the Dash widget structure:
 * - widgets/
 *   - WidgetName.js (React component)
 *   - WidgetName.dash.js (configuration)
 *
 * Integrates with ComponentManager for automatic registration
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { findWidgetsDir } = require("./widgetCompiler");

// Scan an ES-module source and return an object stubbing every imported
// name (named, default, namespace) to `undefined`. Used to keep `vm.runInContext`
// from throwing ReferenceError on identifiers referenced inside the
// config literal whose real imports we don't (and can't) resolve from
// here — we only need the config metadata, not the imported values.
function collectImportedNames(source) {
  const stubs = {};
  if (typeof source !== "string") return stubs;

  // import { a, b as c } from "..."
  const namedRe =
    /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{\s*([^}]+)\s*\}\s*from\s*["'][^"']+["']/g;
  let m;
  while ((m = namedRe.exec(source))) {
    for (const part of m[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (name) stubs[name] = undefined;
    }
  }

  // import foo from "..."
  const defaultRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g;
  while ((m = defaultRe.exec(source))) {
    stubs[m[1]] = undefined;
  }

  // import foo, { a, b } from "..." — capture the default name too
  const defaultWithNamedRe =
    /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{[^}]*\}\s*from\s*["'][^"']+["']/g;
  while ((m = defaultWithNamedRe.exec(source))) {
    stubs[m[1]] = undefined;
  }

  // import * as foo from "..."
  const namespaceRe =
    /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g;
  while ((m = namespaceRe.exec(source))) {
    stubs[m[1]] = undefined;
  }

  return stubs;
}

class DynamicWidgetLoader {
  constructor(componentManager = null) {
    this.loadedWidgets = new Map();
    this.moduleCache = new Map();
    this.componentManager = componentManager;
  }

  /**
   * Set ComponentManager instance for automatic widget registration
   * @param {Object} manager - ComponentManager instance from @trops/dash-react
   */
  setComponentManager(manager) {
    this.componentManager = manager;
  }

  /**
   * Load a widget from a local path
   * @param {string} widgetName - Name of the widget (e.g., "MyFirstWidget")
   * @param {string} widgetPath - Path to the widget directory
   * @param {string} componentName - Name of the component file (e.g., "MyFirstWidgetWidget")
   * @param {boolean} autoRegister - Automatically register with ComponentManager (if available)
   * @returns {Promise<Object>} { component, config, registered }
   */
  async loadWidget(widgetName, widgetPath, componentName, autoRegister = true) {
    try {
      const cacheKey = `${widgetName}:${componentName}`;

      if (this.loadedWidgets.has(cacheKey)) {
        console.log(`[DynamicWidgetLoader] Loading ${widgetName} from cache`);
        return this.loadedWidgets.get(cacheKey);
      }

      console.log(
        `[DynamicWidgetLoader] Loading widget: ${widgetName} from ${widgetPath}`,
      );

      const widgetsDir =
        findWidgetsDir(widgetPath) || path.join(widgetPath, "widgets");
      const componentPath = path.join(widgetsDir, `${componentName}.js`);
      const configPath = path.join(widgetsDir, `${componentName}.dash.js`);

      if (!fs.existsSync(componentPath)) {
        throw new Error(`Component file not found: ${componentPath}`);
      }
      if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
      }

      const config = await this.loadConfigFile(configPath);

      const component = {
        path: componentPath,
        name: componentName,
      };

      let registered = false;

      if (autoRegister && this.componentManager) {
        try {
          // Use scoped id as registration key if available,
          // otherwise fall back to componentName
          const registrationKey = config.id || componentName;
          this.componentManager.registerWidget(config, registrationKey);
          registered = true;
          console.log(
            `[DynamicWidgetLoader] ✓ Registered ${registrationKey} with ComponentManager`,
          );
        } catch (regError) {
          console.warn(
            `[DynamicWidgetLoader] Failed to register with ComponentManager:`,
            regError,
          );
        }
      }

      const result = { component, config, registered };
      this.loadedWidgets.set(cacheKey, result);

      return result;
    } catch (error) {
      console.error(
        `[DynamicWidgetLoader] Error loading widget ${widgetName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Load and parse a .dash.js configuration file
   * @param {string} configPath - Path to the .dash.js file
   * @returns {Promise<Object>} Configuration object
   */
  async loadConfigFile(configPath) {
    try {
      const source = fs.readFileSync(configPath, "utf8");

      let exportMatch = source.match(/export\s+default\s+({[\s\S]*});?\s*$/);

      // Handle variable export pattern: const x = {...}; export default x;
      if (!exportMatch) {
        const varExportMatch = source.match(
          /export\s+default\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*;?\s*$/,
        );
        if (varExportMatch) {
          const varName = varExportMatch[1];
          const varDeclMatch = source.match(
            new RegExp(
              `(?:const|let|var)\\s+${varName}\\s*=\\s*({[\\s\\S]*?});\\s*(?:export\\s+default)`,
            ),
          );
          if (varDeclMatch) {
            exportMatch = varDeclMatch;
          }
        }
      }

      if (!exportMatch) {
        throw new Error("Could not find default export in config file");
      }

      // Sanitize component references so vm.runInContext doesn't fail
      // on unresolvable imports — replace component: SomeName with component: "SomeName"
      const exportedObjectStr = exportMatch[1].replace(
        /component\s*:\s*([A-Z][a-zA-Z0-9_$]*)/g,
        'component: "$1"',
      );

      // Stub every named import in the source so references like
      // `providers: [algoliaProvider]` inside the literal don't throw
      // a ReferenceError when we eval it in a bare VM context. We
      // can't follow the real `./foo` imports from here — we only
      // care about the config metadata (events, eventHandlers,
      // userConfig, etc.). Imported values show up as `undefined` in
      // the parsed config; callers that iterate arrays (providers,
      // …) are expected to filter out nullish entries.
      const importStubs = collectImportedNames(source);

      const context = vm.createContext({
        module: { exports: {} },
        ...importStubs,
      });
      vm.runInContext(`module.exports = ${exportedObjectStr}`, context);

      return context.module.exports;
    } catch (error) {
      console.error(`[DynamicWidgetLoader] Error loading config:`, error);
      throw error;
    }
  }

  /**
   * Discover available widgets in a directory
   * @param {string} widgetPath - Path to search for widgets
   * @returns {Array} List of available widget names
   */
  discoverWidgets(widgetPath) {
    try {
      const widgetsDir = findWidgetsDir(widgetPath);
      if (!widgetsDir) {
        return [];
      }

      const files = fs.readdirSync(widgetsDir);
      const widgets = new Set();

      files.forEach((file) => {
        if (file.endsWith(".dash.js")) {
          const componentName = file.replace(".dash.js", "");
          widgets.add(componentName);
        }
      });

      return Array.from(widgets);
    } catch (error) {
      console.error(`[DynamicWidgetLoader] Error discovering widgets:`, error);
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.loadedWidgets.clear();
    this.moduleCache.clear();
  }
}

const dynamicWidgetLoader = new DynamicWidgetLoader();

module.exports = DynamicWidgetLoader;
module.exports.dynamicWidgetLoader = dynamicWidgetLoader;
