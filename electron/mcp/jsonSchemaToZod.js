/**
 * jsonSchemaToZod.js
 *
 * Converts JSON Schema objects to Zod v3 schemas.
 * Used by the MCP Dash server to satisfy the MCP SDK's requirement
 * for Zod schemas in tool input validation (safeParseAsync).
 */
const z = require("zod");

/**
 * Convert a JSON Schema property definition to a Zod v3 schema.
 * Handles: string (+ enum), number, boolean, object (recursive), array.
 */
function jsonSchemaPropertyToZod(prop) {
  if (!prop || typeof prop !== "object") return z.any();

  let schema;

  switch (prop.type) {
    case "string":
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        schema = z.enum(prop.enum);
      } else {
        schema = z.string();
      }
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(
        prop.items ? jsonSchemaPropertyToZod(prop.items) : z.any(),
      );
      break;
    case "object":
      if (prop.properties && Object.keys(prop.properties).length > 0) {
        schema = jsonSchemaToZod(prop);
      } else {
        // Generic object with no known properties (e.g. config, credentials)
        schema = z.object({}).passthrough();
      }
      break;
    default:
      schema = z.any();
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Convert a top-level JSON Schema inputSchema to a Zod v3 object schema.
 * The MCP SDK requires Zod schemas for input validation (safeParseAsync).
 */
function jsonSchemaToZod(schema) {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }

  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const shape = {};

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema = jsonSchemaPropertyToZod(prop);
    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

module.exports = { jsonSchemaToZod, jsonSchemaPropertyToZod };
