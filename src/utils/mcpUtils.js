/**
 * Shared MCP utility functions.
 *
 * Extracted from McpServerPicker so ProviderDetail (and any future consumer)
 * can reuse the same field-derivation logic.
 */

/**
 * Derive required form fields from an mcpConfig, using credentialSchema
 * as optional enrichment for display names, instructions, and secret flags.
 *
 * For streamable_http: extracts {{placeholder}} fields from url and headerTemplate.
 * For stdio: extracts credential field names from envMapping values.
 *
 * @param {object} mcpConfig - The MCP server configuration
 * @param {object} credentialSchema - Optional metadata for field labels/instructions
 * @returns {Array<{ key, displayName, required, secret, instructions, type }>}
 */
export function deriveFormFields(mcpConfig, credentialSchema = {}) {
  const fieldKeys = new Set();

  if (mcpConfig.transport === "streamable_http") {
    // Extract {{field}} placeholders from url
    if (mcpConfig.url) {
      const urlMatches = mcpConfig.url.match(/\{\{(\w+)\}\}/g) || [];
      urlMatches.forEach((m) => fieldKeys.add(m.slice(2, -2)));
    }
    // Extract {{field}} placeholders from headerTemplate values
    if (mcpConfig.headerTemplate) {
      Object.values(mcpConfig.headerTemplate).forEach((template) => {
        const matches = template.match(/\{\{(\w+)\}\}/g) || [];
        matches.forEach((m) => fieldKeys.add(m.slice(2, -2)));
      });
    }
  } else {
    // stdio: extract credential field names from envMapping values
    if (mcpConfig.envMapping) {
      Object.values(mcpConfig.envMapping).forEach((credField) => {
        fieldKeys.add(credField);
      });
    }
  }

  // Also include any fields defined in credentialSchema that aren't already derived
  if (credentialSchema) {
    Object.keys(credentialSchema).forEach((key) => fieldKeys.add(key));
  }

  // Build the field list with metadata from credentialSchema or auto-generated defaults
  return Array.from(fieldKeys).map((key) => {
    const schemaMeta = credentialSchema[key];

    if (schemaMeta) {
      return {
        key,
        displayName: schemaMeta.displayName || formatFieldName(key),
        required: schemaMeta.required !== false,
        secret: schemaMeta.secret || false,
        instructions: schemaMeta.instructions || null,
        type: schemaMeta.type || "text",
      };
    }

    // Auto-generate defaults from the field name
    return {
      key,
      displayName: formatFieldName(key),
      required: true,
      secret: isLikelySecret(key),
      instructions: null,
      type: "text",
    };
  });
}

/**
 * Convert a camelCase field name to a human-readable title.
 * e.g., "apiKey" → "API Key", "url" → "URL", "botToken" → "Bot Token"
 */
export function formatFieldName(name) {
  const acronyms = { url: "URL", api: "API", id: "ID", mcp: "MCP" };

  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
    .split(" ")
    .map((word) => acronyms[word.toLowerCase()] || word)
    .join(" ");
}

/**
 * Heuristic: does this field name likely contain a secret value?
 */
export function isLikelySecret(name) {
  const lower = name.toLowerCase();
  return /key|token|secret|password|credential|auth/.test(lower);
}

/**
 * Build an mcpConfig by overlaying advanced-section rows onto a catalog base config.
 *
 * For stdio: replaces `envMapping` with the rows from the advanced section.
 * For streamable_http: replaces `headerTemplate` with the rows from the advanced section.
 *
 * @param {object} baseMcpConfig - The catalog's original mcpConfig
 * @param {Array<{ envVar: string, credField: string }>} envMappingRows - Current env var rows
 * @param {Array<{ headerName: string, headerValue: string }>} headerRows - Current header rows
 * @returns {object} A new mcpConfig with overridden envMapping or headerTemplate
 */
export function buildMcpConfigFromOverrides(
  baseMcpConfig,
  envMappingRows,
  headerRows,
) {
  if (baseMcpConfig.transport === "streamable_http") {
    const headerTemplate = {};
    headerRows.forEach((row) => {
      const name = row.headerName.trim();
      const value = row.headerValue.trim();
      if (name && value) {
        headerTemplate[name] = value;
      }
    });
    const config = { ...baseMcpConfig };
    if (Object.keys(headerTemplate).length > 0) {
      config.headerTemplate = headerTemplate;
    } else {
      delete config.headerTemplate;
    }
    return config;
  }

  // stdio
  const envMapping = {};
  envMappingRows.forEach((row) => {
    const env = row.envVar.trim();
    const cred = row.credField.trim();
    if (env && cred) {
      envMapping[env] = cred;
    }
  });
  return { ...baseMcpConfig, envMapping };
}

/**
 * Convert an envMapping object into row state for the advanced config UI.
 *
 * @param {object} envMapping - e.g. { SLACK_BOT_TOKEN: "botToken" }
 * @param {Function} nextRowId - Function that returns a unique row ID
 * @returns {Array<{ id: string, envVar: string, credField: string }>}
 */
export function envMappingToRows(envMapping, nextRowId) {
  if (!envMapping) return [];
  return Object.entries(envMapping).map(([envVar, credField]) => ({
    id: nextRowId(),
    envVar,
    credField,
  }));
}

/**
 * Convert a headerTemplate object into row state for the advanced config UI.
 *
 * @param {object} headerTemplate - e.g. { "Authorization": "Bearer {{apiKey}}" }
 * @param {Function} nextRowId - Function that returns a unique row ID
 * @returns {Array<{ id: string, headerName: string, headerValue: string }>}
 */
export function headerTemplateToRows(headerTemplate, nextRowId) {
  if (!headerTemplate) return [];
  return Object.entries(headerTemplate).map(([headerName, headerValue]) => ({
    id: nextRowId(),
    headerName,
    headerValue,
  }));
}
