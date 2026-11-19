import {
  shapeTag,
  shapeRows,
  tookText,
  ranText,
  activityText,
  answerToShow,
  itemsText,
  testedNote,
} from "./testResultText";

const SHAPE = {
  kind: "json",
  top: "object",
  fields: [
    { path: "deals", kind: "list", count: 3 },
    { path: "deals[].title", kind: "text", note: "in every deal" },
    { path: "deals[].price", kind: "number", note: "24.99 to 39.5" },
    { path: "deals[].tags[].name", kind: "text" },
  ],
};

describe("testResultText", () => {
  it("names the answer's shape", () => {
    expect(shapeTag(SHAPE)).toBe("JSON");
    expect(shapeTag({ kind: "text", lines: 3, chars: 212 })).toBe(
      "Text · 3 lines · 212 characters",
    );
    expect(shapeTag({ kind: "text", lines: 1, chars: 1 })).toBe(
      "Text · 1 line · 1 character",
    );
    expect(shapeTag({ kind: "empty" })).toBe("No answer");
    expect(shapeTag(null)).toBe("No answer");
  });

  it("lists the fields by name, depth, kind and note", () => {
    expect(shapeRows(SHAPE)).toEqual([
      {
        key: "deals",
        name: "deals",
        depth: 0,
        kind: "list",
        note: "a list of 3",
      },
      {
        key: "deals[].title",
        name: "title",
        depth: 1,
        kind: "text",
        note: "in every deal",
      },
      {
        key: "deals[].price",
        name: "price",
        depth: 1,
        kind: "number",
        note: "24.99 to 39.5",
      },
      {
        key: "deals[].tags[].name",
        name: "name",
        depth: 2,
        kind: "text",
        note: null,
      },
    ]);
    expect(shapeRows({ kind: "text" })).toEqual([]);
  });

  it("says how long it took and what it used", () => {
    expect(tookText("2026-11-18T10:00:00Z", "2026-11-18T10:00:14Z")).toBe(
      "14s",
    );
    expect(tookText("2026-11-18T10:00:00Z", "2026-11-18T10:01:05Z")).toBe(
      "1m 5s",
    );
    expect(tookText(null, null)).toBeNull();
    expect(
      ranText({
        startedAt: "2026-11-18T10:00:00Z",
        endedAt: "2026-11-18T10:00:14Z",
        toolCalls: [{}],
      }),
    ).toBe("14s · 1 tool call");
    expect(ranText({ toolCalls: [] })).toBe("no tools");
  });

  it("says what a running test is doing", () => {
    expect(
      activityText({ type: "tool_call", name: "mcp__bot-mcp__send_email" }),
    ).toMatch(/^Using /);
    expect(activityText({ type: "text", text: "x" })).toBe(
      "Writing its answer",
    );
    expect(activityText({ type: "retrying", message: "Overloaded" })).toBe(
      "Overloaded",
    );
    expect(activityText({ type: "done" })).toBeNull();
  });

  it("shows JSON pretty, or as written", () => {
    const answer = 'Deals:\n```json\n{"a":1}\n```';
    const shape = { kind: "json" };
    expect(answerToShow(answer, shape)).toBe('{\n  "a": 1\n}');
    expect(answerToShow(answer, shape, { raw: true })).toBe(answer);
    expect(answerToShow('{"a":1}', shape)).toBe('{\n  "a": 1\n}');
    expect(answerToShow("plain", { kind: "text" })).toBe("plain");
  });

  it("says what a test did and where its sample goes", () => {
    expect(itemsText(1)).toBe("1 item");
    expect(itemsText(3)).toBe("3 items");
    expect(testedNote({ name: "Deal Finder", sampleKept: true })).toMatch(
      /kept as Deal Finder's sample/,
    );
    expect(testedNote({ name: "", isCreating: true })).toMatch(
      /kept as its sample when you create it/,
    );
    expect(testedNote({ name: "X" })).toMatch(
      /kept as its sample when you save it/,
    );
  });
});
