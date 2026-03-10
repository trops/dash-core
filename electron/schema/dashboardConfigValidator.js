/**
 * dashboardConfigValidator.js
 *
 * Validates dashboard configuration objects against the dashboard-config schema.
 * Runs in the Electron main process (CJS).
 *
 * Uses a lightweight validation approach based on the JSON Schema definition
 * without requiring a full JSON Schema validator library.
 */

const schema = require("./dashboard-config.schema.json");

const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * Validate a dashboard configuration object.
 *
 * @param {Object} config - The dashboard config to validate
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
function validateDashboardConfig(config) {
  const errors = [];

  if (config === null || config === undefined || typeof config !== "object") {
    return { valid: false, errors: ["Config must be a non-null object"] };
  }

  // Required fields
  for (const field of schema.required) {
    if (!(field in config)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // If required fields are missing, return early — further checks would be noisy
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // schemaVersion
  if (typeof config.schemaVersion !== "string") {
    errors.push(`"schemaVersion" must be a string`);
  } else if (!/^\d+\.\d+\.\d+$/.test(config.schemaVersion)) {
    errors.push(
      `"schemaVersion" must be a semver string (e.g., "1.0.0"), got "${config.schemaVersion}"`,
    );
  }

  // name
  if (typeof config.name !== "string" || config.name.length === 0) {
    errors.push(`"name" must be a non-empty string`);
  } else if (config.name.length > 100) {
    errors.push(`"name" must be 100 characters or fewer`);
  }

  // description (optional)
  if ("description" in config && typeof config.description !== "string") {
    errors.push(`"description" must be a string`);
  }

  // author (optional)
  if ("author" in config) {
    if (
      typeof config.author !== "object" ||
      config.author === null ||
      Array.isArray(config.author)
    ) {
      errors.push(`"author" must be an object with at least a "name" field`);
    } else if (!config.author.name || typeof config.author.name !== "string") {
      errors.push(`"author.name" must be a non-empty string`);
    }
  }

  // shareable (optional)
  if ("shareable" in config && typeof config.shareable !== "boolean") {
    errors.push(`"shareable" must be a boolean`);
  }

  // tags (optional)
  if ("tags" in config) {
    if (!Array.isArray(config.tags)) {
      errors.push(`"tags" must be an array of strings`);
    } else {
      for (let i = 0; i < config.tags.length; i++) {
        if (typeof config.tags[i] !== "string") {
          errors.push(`"tags[${i}]" must be a string`);
        }
      }
    }
  }

  // workspace
  if (typeof config.workspace !== "object" || config.workspace === null) {
    errors.push(`"workspace" must be an object`);
  } else {
    if (!Array.isArray(config.workspace.layout)) {
      errors.push(`"workspace.layout" must be an array`);
    } else if (config.workspace.layout.length === 0) {
      errors.push(`"workspace.layout" must contain at least one layout item`);
    }
  }

  // widgets
  if (!Array.isArray(config.widgets)) {
    errors.push(`"widgets" must be an array`);
  } else {
    for (let i = 0; i < config.widgets.length; i++) {
      const w = config.widgets[i];
      if (typeof w !== "object" || w === null) {
        errors.push(`"widgets[${i}]" must be an object`);
        continue;
      }
      if (!w.id || typeof w.id !== "string") {
        errors.push(`"widgets[${i}].id" must be a non-empty string`);
      }
      if (!w.package || typeof w.package !== "string") {
        errors.push(`"widgets[${i}].package" must be a non-empty string`);
      }
      if ("version" in w && typeof w.version !== "string") {
        errors.push(`"widgets[${i}].version" must be a string`);
      }
      if ("required" in w && typeof w.required !== "boolean") {
        errors.push(`"widgets[${i}].required" must be a boolean`);
      }
      if ("author" in w && typeof w.author !== "string") {
        errors.push(`"widgets[${i}].author" must be a string`);
      }
    }
  }

  // providers (optional)
  if ("providers" in config) {
    if (!Array.isArray(config.providers)) {
      errors.push(`"providers" must be an array`);
    } else {
      const validClasses = ["credential", "mcp", "api"];
      for (let i = 0; i < config.providers.length; i++) {
        const p = config.providers[i];
        if (typeof p !== "object" || p === null) {
          errors.push(`"providers[${i}]" must be an object`);
          continue;
        }
        if (!p.type || typeof p.type !== "string") {
          errors.push(`"providers[${i}].type" must be a non-empty string`);
        }
        if (!validClasses.includes(p.providerClass)) {
          errors.push(
            `"providers[${i}].providerClass" must be "credential", "mcp", or "api", got "${p.providerClass}"`,
          );
        }
        if ("usedBy" in p && !Array.isArray(p.usedBy)) {
          errors.push(`"providers[${i}].usedBy" must be an array`);
        }
      }
    }
  }

  // appOrigin (optional)
  if ("appOrigin" in config) {
    if (typeof config.appOrigin !== "string") {
      errors.push(`"appOrigin" must be a string`);
    } else if (config.appOrigin.length > 200) {
      errors.push(`"appOrigin" must be 200 characters or fewer`);
    }
  }

  // eventWiring (optional)
  if ("eventWiring" in config) {
    if (!Array.isArray(config.eventWiring)) {
      errors.push(`"eventWiring" must be an array`);
    } else {
      for (let i = 0; i < config.eventWiring.length; i++) {
        const ew = config.eventWiring[i];
        if (typeof ew !== "object" || ew === null) {
          errors.push(`"eventWiring[${i}]" must be an object`);
          continue;
        }
        // source
        if (
          typeof ew.source !== "object" ||
          ew.source === null ||
          !ew.source.widget ||
          !ew.source.event
        ) {
          errors.push(
            `"eventWiring[${i}].source" must have "widget" and "event" strings`,
          );
        }
        // target
        if (
          typeof ew.target !== "object" ||
          ew.target === null ||
          !ew.target.widget ||
          !ew.target.handler
        ) {
          errors.push(
            `"eventWiring[${i}].target" must have "widget" and "handler" strings`,
          );
        }
      }
    }
  }

  // Reject unknown top-level fields
  const allowedFields = Object.keys(schema.properties);
  for (const key of Object.keys(config)) {
    if (!allowedFields.includes(key)) {
      errors.push(`Unknown field: "${key}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply defaults to a dashboard config (fills in optional fields with defaults).
 *
 * @param {Object} config - A valid dashboard config
 * @returns {Object} Config with defaults applied (does not mutate original)
 */
function applyDefaults(config) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    description: "",
    shareable: true,
    tags: [],
    icon: "grip",
    screenshots: [],
    providers: [],
    eventWiring: [],
    ...config,
    workspace: {
      type: "workspace",
      version: 1,
      menuId: 1,
      ...config.workspace,
    },
  };
}

module.exports = {
  validateDashboardConfig,
  applyDefaults,
  CURRENT_SCHEMA_VERSION,
};
