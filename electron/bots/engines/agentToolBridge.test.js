/**
 * agentToolBridge.test.js — bridge the bot's MCP tools into the SDK (P1: FR-007).
 * Uses real zod for schema conversion + a fake SDK for server assembly.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const z = require("zod");
const {
  BOT_MCP_SERVER,
  jsonSchemaToZodShape,
  buildBotMcpServer,
} = require("./agentToolBridge");

describe("jsonSchemaToZodShape", () => {
  it("maps JSON-Schema types to zod validators; required vs optional", () => {
    const shape = jsonSchemaToZodShape(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
          on: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["a", "b"] },
        },
        required: ["name"],
      },
      z,
    );
    // Required string parses; missing optional is fine.
    assert.equal(shape.name.safeParse("x").success, true);
    assert.equal(shape.name.safeParse(undefined).success, false);
    assert.equal(shape.count.safeParse(3).success, true);
    assert.equal(shape.count.safeParse(undefined).success, true); // optional
    assert.equal(shape.on.safeParse(true).success, true);
    assert.equal(shape.tags.safeParse(["a", "b"]).success, true);
    assert.equal(shape.mode.safeParse("a").success, true);
    assert.equal(shape.mode.safeParse("z").success, false); // enum enforced
  });

  it("falls back to z.any for unknown/absent types", () => {
    const shape = jsonSchemaToZodShape(
      { type: "object", properties: { x: {} } },
      z,
    );
    assert.equal(shape.x.safeParse({ anything: 1 }).success, true);
  });

  it("handles an empty/missing schema", () => {
    assert.deepEqual(jsonSchemaToZodShape(undefined, z), {});
    assert.deepEqual(jsonSchemaToZodShape({ type: "object" }, z), {});
  });
});

describe("buildBotMcpServer", () => {
  const fakeSdk = () => {
    const made = [];
    return {
      made,
      tool: (name, description, shape, handler) => {
        const def = { name, description, shape, handler };
        made.push(def);
        return def;
      },
      createSdkMcpServer: (opts) => ({ type: "sdk", ...opts }),
    };
  };

  it("returns null when the bot has no tools", () => {
    assert.equal(buildBotMcpServer({ tools: [] }, fakeSdk(), z), null);
    assert.equal(buildBotMcpServer({}, fakeSdk(), z), null);
  });

  it("builds an sdk server whose handlers proxy to ctx.executeTool", async () => {
    const calls = [];
    const ctx = {
      tools: [
        {
          name: "search",
          description: "search things",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
          },
        },
      ],
      executeTool: async (name, args) => {
        calls.push({ name, args });
        return { text: "result!", isError: false };
      },
    };
    const sdk = fakeSdk();
    const server = buildBotMcpServer(ctx, sdk, z);

    assert.equal(server.type, "sdk");
    assert.equal(server.name, BOT_MCP_SERVER);
    assert.equal(sdk.made.length, 1);
    assert.equal(sdk.made[0].name, "search");

    // Invoke the generated handler → proxies to executeTool + shapes result.
    const out = await sdk.made[0].handler({ q: "hi" });
    assert.deepEqual(calls, [{ name: "search", args: { q: "hi" } }]);
    assert.deepEqual(out, {
      content: [{ type: "text", text: "result!" }],
      isError: false,
    });
  });

  it("marks tool errors via isError", async () => {
    const ctx = {
      tools: [{ name: "t", inputSchema: {} }],
      executeTool: async () => ({ text: "boom", isError: true }),
    };
    const sdk = fakeSdk();
    buildBotMcpServer(ctx, sdk, z);
    const out = await sdk.made[0].handler({});
    assert.equal(out.isError, true);
    assert.equal(out.content[0].text, "boom");
  });

  it("returns images to the SDK as MCP image blocks (CAP-001)", async () => {
    const ctx = {
      tools: [{ name: "fetch_image", inputSchema: {} }],
      executeTool: async () => ({
        text: "shoe.jpg",
        images: [{ data: "AAAA", mimeType: "image/jpeg" }],
        isError: false,
      }),
    };
    const sdk = fakeSdk();
    buildBotMcpServer(ctx, sdk, z);
    const out = await sdk.made[0].handler({});
    assert.deepEqual(out.content, [
      { type: "text", text: "shoe.jpg" },
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },
    ]);
  });

  it("an image-only result has no empty text block", async () => {
    const ctx = {
      tools: [{ name: "snap", inputSchema: {} }],
      executeTool: async () => ({
        text: "",
        images: [{ data: "AAAA", mimeType: "image/png" }],
      }),
    };
    const sdk = fakeSdk();
    buildBotMcpServer(ctx, sdk, z);
    const out = await sdk.made[0].handler({});
    assert.deepEqual(out.content, [
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });
});
