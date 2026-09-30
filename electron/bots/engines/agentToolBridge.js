/**
 * agentToolBridge.js
 *
 * Bridges a bot's configured MCP tools into the Claude Agent SDK engine
 * (PRD FR-007). The SDK's `tool()` wants a Zod raw shape, while the bot's MCP
 * tools carry JSON-Schema `inputSchema`; this converts one to the other and
 * wraps them in an in-process SDK MCP server whose handlers proxy back to the
 * runner's `ctx.executeTool` (which runs the real MCP call via mcpController).
 *
 * Pure (NFR-006): both the SDK helpers (`createSdkMcpServer`, `tool`) and the
 * `zod` module are injected, so nothing vendor-specific loads here.
 */
"use strict";

const BOT_MCP_SERVER = "bot-mcp";

/**
 * Convert one JSON-Schema property to a Zod validator.
 * @param {object} prop
 * @param {*} z  the zod module
 */
function zodTypeFor(prop, z) {
  const p = prop || {};
  if (
    Array.isArray(p.enum) &&
    p.enum.length &&
    p.enum.every((v) => typeof v === "string")
  ) {
    return z.enum([...p.enum]);
  }
  switch (p.type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(p.items ? zodTypeFor(p.items, z) : z.any());
    case "object":
      return z.object(jsonSchemaToZodShape(p, z));
    default:
      return z.any();
  }
}

/**
 * Convert a JSON-Schema object (`{type:"object", properties, required}`) to a
 * Zod raw shape (`{ [key]: ZodType }`) as SDK `tool()` expects.
 * @param {object} schema
 * @param {*} z  the zod module
 * @returns {object}
 */
function jsonSchemaToZodShape(schema, z) {
  const props = (schema && schema.properties) || {};
  const required = new Set((schema && schema.required) || []);
  const shape = {};
  for (const [key, prop] of Object.entries(props)) {
    let zt = zodTypeFor(prop, z);
    if (!required.has(key)) zt = zt.optional();
    shape[key] = zt;
  }
  return shape;
}

/**
 * Build an in-process SDK MCP server exposing the bot's MCP tools, or null if
 * the bot has none.
 * @param {object} ctx  RunContext (uses ctx.tools + ctx.executeTool)
 * @param {{ createSdkMcpServer: Function, tool: Function }} sdk
 * @param {*} z  the zod module
 * @returns {object|null} McpServerConfig for options.mcpServers, or null
 */
function buildBotMcpServer(ctx, sdk, z) {
  const tools = (ctx && Array.isArray(ctx.tools) ? ctx.tools : []).filter(
    (t) => t && t.name,
  );
  if (!tools.length) return null;

  const sdkTools = tools.map((t) =>
    sdk.tool(
      t.name,
      t.description || "",
      jsonSchemaToZodShape(t.inputSchema, z),
      async (args) => {
        const r = await ctx.executeTool(t.name, args);
        return {
          content: [{ type: "text", text: (r && r.text) || "" }],
          isError: !!(r && r.isError),
        };
      },
    ),
  );

  return sdk.createSdkMcpServer({
    name: BOT_MCP_SERVER,
    version: "1.0.0",
    tools: sdkTools,
  });
}

module.exports = {
  BOT_MCP_SERVER,
  jsonSchemaToZodShape,
  buildBotMcpServer,
};
