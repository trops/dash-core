import { appendAnswerText, ANSWER_BREAK } from "./answerText";

describe("appendAnswerText", () => {
  it("joins streamed pieces of one stretch of text as-is", () => {
    let text = "";
    text = appendAnswerText(text, "Hel");
    text = appendAnswerText(text, "lo there.");
    expect(text).toBe("Hello there.");
  });

  it("breaks between text before and after a tool call", () => {
    const text = appendAnswerText("I'll check what you prefer.", "Done", {
      afterTool: true,
    });
    expect(text).toBe("I'll check what you prefer.\n\nDone");
    expect(ANSWER_BREAK).toBe("\n\n");
  });

  it("adds no break when there is no text before the tool call", () => {
    expect(appendAnswerText("", "Done", { afterTool: true })).toBe("Done");
  });

  it("adds no break when the join already has whitespace", () => {
    expect(appendAnswerText("prefer.\n", "Done", { afterTool: true })).toBe(
      "prefer.\nDone",
    );
    expect(appendAnswerText("prefer.", " Done", { afterTool: true })).toBe(
      "prefer. Done",
    );
  });

  it("tolerates missing values", () => {
    expect(appendAnswerText(undefined, undefined)).toBe("");
    expect(appendAnswerText("a", "", { afterTool: true })).toBe("a");
  });
});
