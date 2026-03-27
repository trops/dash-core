/**
 * jsonSchemaToZod.test.js
 *
 * Tests for the JSON Schema → Zod v3 converter used by the MCP Dash server.
 * Ensures all tool inputSchemas produce valid Zod schemas that:
 *   1. Accept valid input via .parse()
 *   2. Reject invalid input via .safeParse()
 *   3. Expose correct property keys in .shape
 *   4. Match the JSON Schema tools/list output expected by MCP clients
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { jsonSchemaToZod } = require("./jsonSchemaToZod");

const {
  dashboardTools,
  widgetTools,
  themeTools,
  providerTools,
  guideTools,
  layoutTools,
} = require("./toolDefinitions");

// =========================================================================
// Unit Tests: jsonSchemaToZod converter
// =========================================================================
describe("jsonSchemaToZod — converter", () => {
  it("converts empty properties to z.object({})", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {},
      required: [],
    });
    assert.ok(schema);
    assert.ok(schema.parse({}));
    assert.ok(schema.shape);
    assert.equal(Object.keys(schema.shape).length, 0);
  });

  it("converts string properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string", description: "A name" },
      },
      required: ["name"],
    });
    assert.ok(schema.parse({ name: "test" }));
    assert.ok(schema.shape.name);
    // Required field — should reject missing
    const result = schema.safeParse({});
    assert.equal(result.success, false);
  });

  it("converts optional string properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        label: { type: "string", description: "Optional label" },
      },
      required: [],
    });
    // Should accept with and without optional field
    assert.ok(schema.parse({}));
    assert.ok(schema.parse({ label: "hello" }));
  });

  it("converts number properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        count: { type: "number", description: "A count" },
      },
      required: ["count"],
    });
    assert.ok(schema.parse({ count: 5 }));
    const result = schema.safeParse({ count: "five" });
    assert.equal(result.success, false);
  });

  it("converts boolean properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        enabled: { type: "boolean" },
      },
      required: [],
    });
    assert.ok(schema.parse({ enabled: true }));
    assert.ok(schema.parse({}));
  });

  it("converts string enum properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["dashboard", "theme", "widget"],
          description: "Topic",
        },
      },
      required: [],
    });
    assert.ok(schema.parse({ topic: "dashboard" }));
    const result = schema.safeParse({ topic: "invalid" });
    assert.equal(result.success, false);
  });

  it("converts array properties with item schema", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags list",
        },
      },
      required: [],
    });
    assert.ok(schema.parse({ tags: ["a", "b"] }));
    assert.ok(schema.parse({}));
    const result = schema.safeParse({ tags: [1, 2] });
    assert.equal(result.success, false);
  });

  it("converts generic object properties (e.g. config, credentials)", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        config: {
          type: "object",
          description: "Arbitrary config",
        },
      },
      required: ["config"],
    });
    assert.ok(schema.parse({ config: { key: "value" } }));
    assert.ok(schema.parse({ config: {} }));
  });

  it("converts nested object properties with known sub-properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        layout: {
          type: "object",
          description: "Layout config",
          properties: {
            rows: { type: "number", description: "Number of rows" },
            cols: { type: "number", description: "Number of columns" },
            gap: { type: "string", description: "Gap class" },
          },
          required: ["rows", "cols"],
        },
      },
      required: [],
    });
    assert.ok(schema.parse({ layout: { rows: 2, cols: 3 } }));
    assert.ok(schema.parse({ layout: { rows: 1, cols: 1, gap: "gap-4" } }));
    assert.ok(schema.parse({})); // layout is optional
    // Nested required fields
    const result = schema.safeParse({ layout: { rows: 1 } });
    assert.equal(result.success, false);
  });

  it("handles null/undefined schema gracefully", () => {
    assert.ok(jsonSchemaToZod(null).parse({}));
    assert.ok(jsonSchemaToZod(undefined).parse({}));
  });

  it("preserves descriptions on fields", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string", description: "Display name" },
      },
      required: ["name"],
    });
    assert.equal(schema.shape.name.description, "Display name");
  });
});

// =========================================================================
// Catalog Test: All 22 tool schemas convert and have correct properties
// =========================================================================
const allTools = [
  ...dashboardTools,
  ...widgetTools,
  ...themeTools,
  ...providerTools,
  ...guideTools,
  ...layoutTools,
];

describe("jsonSchemaToZod — all tool schemas", () => {
  it(`converts all ${allTools.length} tool schemas without error`, () => {
    for (const tool of allTools) {
      const zodSchema = jsonSchemaToZod(tool.inputSchema);
      assert.ok(zodSchema, `Tool "${tool.name}" failed to convert inputSchema`);
      assert.ok(
        typeof zodSchema.parse === "function",
        `Tool "${tool.name}" schema missing .parse()`,
      );
      assert.ok(
        typeof zodSchema.safeParse === "function",
        `Tool "${tool.name}" schema missing .safeParse()`,
      );
      assert.ok(
        typeof zodSchema.safeParseAsync === "function",
        `Tool "${tool.name}" schema missing .safeParseAsync()`,
      );
    }
  });

  it("every tool schema has matching property keys", () => {
    for (const tool of allTools) {
      const jsonProps = Object.keys(tool.inputSchema.properties || {});
      const zodSchema = jsonSchemaToZod(tool.inputSchema);
      const zodKeys = Object.keys(zodSchema.shape || {});
      assert.deepStrictEqual(
        zodKeys.sort(),
        jsonProps.sort(),
        `Tool "${tool.name}" Zod shape keys don't match JSON Schema properties`,
      );
    }
  });

  it("tools with no params accept empty object", () => {
    const noParamTools = allTools.filter(
      (t) => Object.keys(t.inputSchema.properties || {}).length === 0,
    );
    assert.ok(noParamTools.length > 0, "Should have tools with no params");
    for (const tool of noParamTools) {
      const zodSchema = jsonSchemaToZod(tool.inputSchema);
      assert.ok(
        zodSchema.safeParse({}).success,
        `Tool "${tool.name}" should accept empty object`,
      );
    }
  });

  it("tools with required params reject empty object", () => {
    const requiredParamTools = allTools.filter(
      (t) =>
        Array.isArray(t.inputSchema.required) &&
        t.inputSchema.required.length > 0,
    );
    assert.ok(
      requiredParamTools.length > 0,
      "Should have tools with required params",
    );
    for (const tool of requiredParamTools) {
      const zodSchema = jsonSchemaToZod(tool.inputSchema);
      const result = zodSchema.safeParse({});
      assert.equal(
        result.success,
        false,
        `Tool "${tool.name}" should reject empty object (has required: ${tool.inputSchema.required})`,
      );
    }
  });
});

// =========================================================================
// Regression Tests: specific tool schemas parse expected inputs
// =========================================================================
describe("jsonSchemaToZod — regression tests", () => {
  it("create_dashboard parses name + layout", () => {
    const tool = allTools.find((t) => t.name === "create_dashboard");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({
      name: "Gong Playground",
      layout: { rows: 1, cols: 2, gap: "gap-2", colModes: { 1: "equal" } },
    });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("create_dashboard parses name only (no layout)", () => {
    const tool = allTools.find((t) => t.name === "create_dashboard");
    const schema = jsonSchemaToZod(tool.inputSchema);
    assert.ok(schema.safeParse({ name: "Simple Dashboard" }).success);
  });

  it("create_dashboard rejects missing name", () => {
    const tool = allTools.find((t) => t.name === "create_dashboard");
    const schema = jsonSchemaToZod(tool.inputSchema);
    assert.equal(schema.safeParse({}).success, false);
  });

  it("add_widget parses widgetName + row + col", () => {
    const tool = allTools.find((t) => t.name === "add_widget");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({
      widgetName: "GongCallSearch",
      dashboardId: "123",
      row: 1,
      col: 2,
    });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("add_widget parses widgetName only", () => {
    const tool = allTools.find((t) => t.name === "add_widget");
    const schema = jsonSchemaToZod(tool.inputSchema);
    assert.ok(schema.safeParse({ widgetName: "Clock" }).success);
  });

  it("configure_widget parses widgetId + config", () => {
    const tool = allTools.find((t) => t.name === "configure_widget");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({
      widgetId: "5",
      config: { title: "My Widget", days: 7 },
    });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("add_provider parses full provider with allowedTools array", () => {
    const tool = allTools.find((t) => t.name === "add_provider");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({
      name: "GitHub MCP",
      type: "github",
      credentials: { token: "ghp_test" },
      providerClass: "mcp",
      mcpConfig: { transport: "stdio", command: "npx" },
      allowedTools: ["create_issue", "list_repos"],
    });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("set_layout parses rows + cols", () => {
    const tool = allTools.find((t) => t.name === "set_layout");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({ rows: 2, cols: 3, gap: "gap-4" });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("move_widget parses widgetId + row + col", () => {
    const tool = allTools.find((t) => t.name === "move_widget");
    const schema = jsonSchemaToZod(tool.inputSchema);
    const result = schema.safeParse({
      widgetId: "7",
      row: 1,
      col: 3,
    });
    assert.equal(result.success, true, JSON.stringify(result.error));
  });

  it("get_setup_guide parses topic enum", () => {
    const tool = allTools.find((t) => t.name === "get_setup_guide");
    const schema = jsonSchemaToZod(tool.inputSchema);
    assert.ok(schema.safeParse({ topic: "dashboard" }).success);
    assert.ok(schema.safeParse({}).success); // topic is optional
    assert.equal(schema.safeParse({ topic: "invalid" }).success, false);
  });

  it("update_layout accepts partial updates", () => {
    const tool = allTools.find((t) => t.name === "update_layout");
    const schema = jsonSchemaToZod(tool.inputSchema);
    assert.ok(schema.safeParse({ gap: "gap-4" }).success);
    assert.ok(schema.safeParse({ rows: 3 }).success);
    assert.ok(schema.safeParse({ colModes: { 1: "1/4" } }).success);
  });
});
