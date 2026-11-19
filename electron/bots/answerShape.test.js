/**
 * answerShape.test.js — the shape of what a bot returned (bot-test-run PRD).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAnswer,
  answerShape,
  resultsShape,
  fieldRows,
  MAX_ROWS,
} = require("./answerShape");

const DEALS = {
  deals: [
    { title: "Cast-iron skillet", price: 24.99, link: "https://s.example/a" },
    { title: "Chef's knife", price: 39.5, link: "https://s.example/b" },
    { title: "Pour-over kettle", price: 31, link: "https://s.example/c" },
  ],
};

describe("parseAnswer", () => {
  it("reads an answer that is all JSON", () => {
    assert.deepEqual(parseAnswer(JSON.stringify(DEALS)), {
      found: true,
      value: DEALS,
    });
  });

  it("reads the one ```json block in an answer", () => {
    const text = `Here are today's deals:\n\n\`\`\`json\n${JSON.stringify(
      DEALS,
    )}\n\`\`\`\nEnjoy.`;
    assert.deepEqual(parseAnswer(text), {
      found: true,
      value: DEALS,
      fenced: true,
    });
  });

  it("isn't JSON when there are two blocks, or a bare value", () => {
    assert.equal(
      parseAnswer("```json\n{}\n```\n```json\n[]\n```").found,
      false,
    );
    assert.equal(parseAnswer("42").found, false);
    assert.equal(parseAnswer('"text"').found, false);
    assert.equal(parseAnswer("Three deals today").found, false);
    assert.equal(parseAnswer("").found, false);
  });
});

describe("answerShape", () => {
  it("lists a JSON answer's fields, kinds and notes", () => {
    const shape = answerShape(JSON.stringify(DEALS, null, 2));
    assert.equal(shape.kind, "json");
    assert.equal(shape.top, "object");
    assert.deepEqual(shape.fields, [
      { path: "deals", kind: "list", count: 3 },
      { path: "deals[].title", kind: "text", note: "in every deal" },
      { path: "deals[].price", kind: "number", note: "24.99 to 39.5" },
      { path: "deals[].link", kind: "link", note: "in every deal" },
    ]);
  });

  it("says when a field is only in some items", () => {
    const shape = answerShape(
      JSON.stringify({ items: [{ a: 1, b: "x" }, { a: 2 }] }),
    );
    assert.deepEqual(
      shape.fields.find((f) => f.path === "items[].b"),
      { path: "items[].b", kind: "text", note: "in 1 of 2" },
    );
  });

  it("walks nested objects and a top-level list", () => {
    assert.deepEqual(fieldRows({ meta: { source: "web", count: 2 } }), [
      { path: "meta", kind: "object" },
      { path: "meta.source", kind: "text" },
      { path: "meta.count", kind: "number" },
    ]);
    assert.deepEqual(fieldRows([{ id: 1 }, { id: 2 }]), [
      { path: "[]", kind: "list", count: 2 },
      { path: "[].id", kind: "number", note: "1 to 2" },
    ]);
  });

  it("names mixed kinds and empty values", () => {
    assert.deepEqual(
      fieldRows({ v: [{ x: 1 }, { x: "a" }] }).find((f) => f.path === "v[].x"),
      { path: "v[].x", kind: "mixed", note: "in every item" },
    );
    assert.deepEqual(fieldRows({ gone: null }), [
      { path: "gone", kind: "empty" },
    ]);
  });

  it("keeps to MAX_ROWS rows", () => {
    const wide = {};
    for (let i = 0; i < MAX_ROWS + 10; i++) wide[`f${i}`] = i;
    assert.equal(fieldRows(wide).length, MAX_ROWS);
  });

  it("describes plain text by its lines and length", () => {
    assert.deepEqual(answerShape("Skillet $24.99\nKnife $39.50\n"), {
      kind: "text",
      lines: 2,
      chars: 27,
    });
    assert.deepEqual(answerShape("   "), { kind: "empty" });
    assert.deepEqual(answerShape(null), { kind: "empty" });
  });
});

describe("resultsShape", () => {
  it("gives each result's count and its items' fields", () => {
    assert.deepEqual(
      resultsShape([
        {
          name: "deals",
          label: "Deals",
          items: [
            { title: "a", link: "x" },
            { title: "b", subtitle: "c" },
          ],
          summary: "2 deals",
        },
        { name: "empty", items: [] },
      ]),
      [
        {
          name: "deals",
          label: "Deals",
          count: 2,
          fields: ["title", "link", "subtitle"],
          summary: "2 deals",
        },
        { name: "empty", label: "empty", count: 0, fields: [] },
      ],
    );
    assert.deepEqual(resultsShape(null), []);
  });
});
