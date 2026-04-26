/**
 * widgetBundleLoader.js
 *
 * Evaluates Rollup-compiled CJS widget bundles in the renderer process
 * using new Function() with a require shim that maps package names
 * to the host app's real module instances.
 */

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as dashReact from "@trops/dash-react";
import * as jsxRuntime from "react/jsx-runtime";
import PropTypes from "prop-types";

// Host-injected module references (e.g., "@trops/dash-core").
// Set by the host app via setHostModules() after all modules are fully loaded,
// avoiding the self-referential import that breaks under webpack scope hoisting.
let _hostModules = {};

/**
 * Allow the host app to inject module references for the require shim.
 * Called from Dash.js after importing dash-core, so the full namespace is available.
 *
 * @param {object} modules - Map of package names to module namespaces
 */
export function setHostModules(modules) {
  _hostModules = modules;
}

// Base modules that can be statically imported without circular issues.
const BASE_MODULE_MAP = {
  react: React,
  "react-dom": ReactDOM,
  "@trops/dash-react": dashReact,
  "react/jsx-runtime": jsxRuntime,
  "prop-types": PropTypes,
};

/**
 * Evaluate a CJS bundle source string and return its module.exports.
 *
 * @param {string} source - The CJS bundle source code
 * @param {string} widgetName - Widget name (for error messages)
 * @returns {object} The module.exports from the evaluated bundle
 */
export function evaluateBundle(source, widgetName) {
  // Merge base modules with host-provided modules (e.g., "@trops/dash-core")
  // at call time so _hostModules is populated by the time widgets load.
  const moduleMap = { ...BASE_MODULE_MAP, ..._hostModules };

  const module = { exports: {} };
  const exports = module.exports;

  const require = (name) => {
    if (moduleMap[name]) {
      const mod = moduleMap[name];
      // CJS interop: `import * as X` creates an ES module namespace where
      // named exports may live under `.default` (e.g. @trops/dash-react).
      // CJS bundles expect `require("pkg").Widget` to work, so merge
      // `.default` properties onto the returned object.
      if (mod.default && typeof mod.default === "object") {
        return { ...mod.default, ...mod, default: mod.default };
      }
      return mod;
    }
    throw new Error(
      `[widgetBundleLoader] Widget "${widgetName}" requires unknown module: "${name}"`,
    );
  };

  // Provide a process shim so bundles that reference process.env.NODE_ENV
  // (common in React libraries) don't throw ReferenceError in the sandbox.
  const process = { env: { NODE_ENV: "production" } };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("module", "exports", "require", "process", source);
    fn(module, exports, require, process);
  } catch (error) {
    console.error(
      `[widgetBundleLoader] Error evaluating bundle for "${widgetName}":`,
      error,
    );
    throw error;
  }

  return module.exports;
}

/**
 * Extract widget/workspace configs from evaluated bundle exports.
 *
 * Rollup-compiled widget bundles export named keys where each value
 * is either a dash config object (with a `component` function and
 * a `type` of "widget" or "workspace") or a frozen wrapper around
 * a `default` export that is such a config.
 *
 * Note: provider-array dedup is handled centrally in
 * `Models/ComponentConfigModel` so every widget that gets registered
 * via `ComponentManager.registerWidget` is normalized in one place.
 * Don't duplicate the logic here.
 *
 * @param {object} bundleExports - The module.exports from evaluateBundle
 * @returns {Array<{key: string, config: object}>} Extracted configs
 */
export function extractWidgetConfigs(bundleExports) {
  const configs = [];

  for (const key of Object.keys(bundleExports)) {
    let entry = bundleExports[key];

    // Skip non-objects and the __esModule flag
    if (!entry || typeof entry !== "object" || key === "__esModule") {
      continue;
    }

    // Unwrap { default: { component, type, ... } } wrappers
    if (entry.default && typeof entry.default === "object") {
      entry = entry.default;
    }

    // Must have a component function and a recognized type
    if (
      typeof entry.component === "function" &&
      (entry.type === "widget" || entry.type === "workspace")
    ) {
      // Use the canonical widget ID from config if available,
      // otherwise fall back to the CJS export key
      configs.push({ key: entry.id || key, config: entry });
    }
  }

  return configs;
}

/**
 * Load a widget bundle: evaluate CJS source and extract configs.
 *
 * @param {string} source - CJS bundle source code
 * @param {string} widgetName - Widget name
 * @returns {{ exports: object, configs: Array<{key: string, config: object}> }}
 */
export function loadWidgetBundle(source, widgetName) {
  const exports = evaluateBundle(source, widgetName);
  const configs = extractWidgetConfigs(exports);
  return { exports, configs };
}
