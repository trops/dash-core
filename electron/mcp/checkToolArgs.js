/**
 * checkToolArgs.js
 *
 * A call checked against the tool's own input schema before it goes out:
 * a tool the server doesn't have, a required input left out, or a value of
 * the wrong kind is said plainly ("read_text_file needs path") instead
 * of whatever the server makes of it. Pure; used by mcpController.callTool
 * and the widget checks.
 */
"use strict";

const KIND = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => !!v && typeof v === "object" && !Array.isArray(v),
};

const listed = (names, max = 12) =>
  names.length > max
    ? `${names.slice(0, max).join(", ")}, …`
    : names.join(", ");

/**
 * @param {object[]} tools  the server's tools ({ name, inputSchema })
 * @param {string} toolName
 * @param {object} args
 * @param {{ strict?: boolean }} [opts] strict (the build's check) also holds
 *   values to their kind and choices; a live call is only stopped for a
 *   tool that isn't there or a required input left out — servers often
 *   accept "5" for 5.
 * @returns {string|null} what's wrong, or null when the call fits
 */
function checkToolArgs(tools, toolName, args, { strict = true } = {}) {
  if (!Array.isArray(tools) || !tools.length) return null; // not known yet
  const tool = tools.find((t) => t && t.name === toolName);
  if (!tool) {
    return `It has no tool named ${toolName}. Its tools: ${listed(
      tools.map((t) => t && t.name).filter(Boolean),
    )}.`;
  }
  const schema = tool.inputSchema || tool.input_schema;
  if (!schema || typeof schema !== "object") return null;
  const given = args && typeof args === "object" ? args : {};
  const props = schema.properties || {};
  const missing = (
    Array.isArray(schema.required) ? schema.required : []
  ).filter(
    // Left out: not given. The build's check also counts an empty value; a
    // live call may send "" on purpose (a search for everything).
    (k) =>
      given[k] === undefined ||
      given[k] === null ||
      (strict && given[k] === ""),
  );
  if (missing.length) {
    return `${toolName} needs ${missing.join(", ")} — ${
      missing.length === 1 ? "it was" : "they were"
    } left out.`;
  }
  if (!strict) return null;
  for (const [k, v] of Object.entries(given)) {
    const p = props[k];
    if (!p || v === undefined || v === null) continue;
    if (Array.isArray(p.enum) && !p.enum.includes(v)) {
      return `${toolName}: ${k} must be one of ${listed(
        p.enum.map((e) => JSON.stringify(e)),
      )} — got ${JSON.stringify(v)}.`;
    }
    const types = Array.isArray(p.type) ? p.type : p.type ? [p.type] : [];
    const known = types.filter((t) => KIND[t]);
    if (known.length && !known.some((t) => KIND[t](v))) {
      return `${toolName}: ${k} should be ${known.join(" or ")} — got ${
        Array.isArray(v) ? "a list" : typeof v
      }.`;
    }
  }
  return null;
}

module.exports = { checkToolArgs };
