/**
 * answerText.test.js — joining a bot's streamed answer text. Mirrors
 * src/utils/answerText.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { appendAnswerText, ANSWER_BREAK } = require("./answerText");

describe("appendAnswerText", () => {
  it("joins streamed pieces of one stretch of text as-is", () => {
    let text = "";
    text = appendAnswerText(text, "Hel");
    text = appendAnswerText(text, "lo there.");
    assert.equal(text, "Hello there.");
  });

  it("breaks between text before and after a tool call", () => {
    const text = appendAnswerText("I'll check what you prefer.", "Done", {
      afterTool: true,
    });
    assert.equal(text, "I'll check what you prefer.\n\nDone");
    assert.equal(ANSWER_BREAK, "\n\n");
  });

  it("adds no break when there is no text before the tool call", () => {
    assert.equal(appendAnswerText("", "Done", { afterTool: true }), "Done");
  });

  it("adds no break when the join already has whitespace", () => {
    assert.equal(
      appendAnswerText("prefer.\n", "Done", { afterTool: true }),
      "prefer.\nDone",
    );
    assert.equal(
      appendAnswerText("prefer.", " Done", { afterTool: true }),
      "prefer. Done",
    );
  });

  it("tolerates missing values", () => {
    assert.equal(appendAnswerText(undefined, undefined), "");
    assert.equal(appendAnswerText("a", "", { afterTool: true }), "a");
  });
});
