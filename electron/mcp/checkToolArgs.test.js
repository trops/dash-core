/**
 * checkToolArgs — a call checked against the tool's schema before it goes.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkToolArgs } = require("./checkToolArgs");

const tools = [
  {
    name: "ha_call_service",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        service: { type: "string" },
        entity_id: { type: "string" },
        return_response: { type: "boolean" },
        mode: { enum: ["single", "all"] },
      },
      required: ["domain", "service"],
    },
  },
  { name: "list_allowed_directories" },
];

describe("checkToolArgs", () => {
  it("a call that fits", () => {
    assert.equal(
      checkToolArgs(tools, "ha_call_service", {
        domain: "todo",
        service: "get_items",
        entity_id: "todo.shopping_list",
        return_response: true,
      }),
      null,
    );
    assert.equal(checkToolArgs(tools, "list_allowed_directories", {}), null);
  });
  it("a tool the server doesn't have", () => {
    assert.match(
      checkToolArgs(tools, "read_file", {}),
      /no tool named read_file\. Its tools: ha_call_service, list_allowed_directories/,
    );
  });
  it("a required input left out (or empty)", () => {
    assert.equal(
      checkToolArgs(tools, "ha_call_service", { domain: "todo", service: "" }),
      "ha_call_service needs service — it was left out.",
    );
  });
  it("a value of the wrong kind, or not one of the choices", () => {
    assert.match(
      checkToolArgs(tools, "ha_call_service", {
        domain: "todo",
        service: "get_items",
        return_response: "yes",
      }),
      /return_response should be boolean — got string/,
    );
    assert.match(
      checkToolArgs(tools, "ha_call_service", {
        domain: "todo",
        service: "x",
        mode: "some",
      }),
      /mode must be one of "single", "all"/,
    );
  });
  it("a live call (not strict) is only stopped for a missing tool or input", () => {
    const live = { strict: false };
    assert.equal(
      checkToolArgs(
        tools,
        "ha_call_service",
        { domain: "todo", service: "x", return_response: "yes" },
        live,
      ),
      null,
    );
    assert.match(
      checkToolArgs(tools, "ha_call_service", { domain: "todo" }, live),
      /needs service/,
    );
  });
  it("a live call may send an empty value on purpose", () => {
    assert.equal(
      checkToolArgs(
        tools,
        "ha_call_service",
        { domain: "todo", service: "" },
        {
          strict: false,
        },
      ),
      null,
    );
  });
  it("nothing known about the server's tools: nothing to say", () => {
    assert.equal(checkToolArgs([], "anything", {}), null);
  });
});
