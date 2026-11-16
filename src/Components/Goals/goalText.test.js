import {
  goalBucket,
  goalCounts,
  goalLine,
  roundLines,
  roundText,
  sourceLink,
  sourceText,
  recordText,
} from "./goalText";

const rec = (o) => ({ botName: "Builder", round: 1, at: 1, ...o });

describe("goalText", () => {
  test("where a goal came from", () => {
    expect(sourceText({ source: { kind: "ticket", label: "DASH-418" } })).toBe(
      "Ticket DASH-418",
    );
    expect(
      sourceText({ source: { kind: "bot" }, conversationId: "plan_1" }),
    ).toBe("Conversation");
    expect(
      sourceText({ source: { kind: "bot" }, createdBy: { botName: "Reader" } }),
    ).toBe("Started by Reader");
    expect(sourceLink({ source: { ref: "https://x.test/DASH-1" } })).toBe(
      "https://x.test/DASH-1",
    );
    expect(sourceLink({ source: { ref: "DASH-1" } })).toBeNull();
  });

  test("a done record in one line", () => {
    expect(recordText(rec({ status: "passed", summary: "PR opened" }))).toBe(
      "Builder: passed — PR opened",
    );
    expect(recordText({ by: "you", status: "one-more-round" })).toBe(
      "You gave it one more round",
    );
  });

  test("the list line says what needs you first", () => {
    const stopped = {
      status: "needs-you",
      tasks: [
        {
          title: "Sort leads",
          status: "needs-you",
          history: [rec({ status: "failed", round: 3, stopped: true })],
        },
      ],
    };
    expect(goalLine(stopped)).toBe("Stopped after 3 rounds: Sort leads");
    expect(
      goalLine({
        status: "ready",
        tasks: [{ title: "Build", status: "ready", history: [] }],
      }),
    ).toBe("Ready for you to mark done: Build");
    expect(
      goalLine({
        status: "working",
        tasks: [
          {
            title: "Build",
            status: "built",
            history: [rec({ status: "passed", summary: "done", at: 5 })],
          },
        ],
      }),
    ).toBe("Builder: passed — done");
    expect(goalLine({ tasks: [] })).toBe("No tasks yet");
  });

  test("rounds", () => {
    expect(
      roundText({
        tasks: [
          { status: "built", round: 2, maxRounds: 3 },
          { status: "done", round: 3, maxRounds: 3 },
        ],
      }),
    ).toBe("Round 2 of 3");
    expect(
      roundLines({
        history: [
          rec({ round: 1, status: "failed", summary: "a" }),
          rec({ round: 2, status: "failed", summary: "b" }),
        ],
      }),
    ).toEqual([
      { round: 1, text: "Builder: failed — a" },
      { round: 2, text: "Builder: failed — b" },
    ]);
  });

  test("filters", () => {
    const goals = [
      { status: "needs-you" },
      { status: "ready" },
      { status: "working" },
      { status: "done" },
      { status: "closed" },
    ];
    expect(goals.map(goalBucket)).toEqual([
      "needs-you",
      "needs-you",
      "working",
      "done",
      "done",
    ]);
    expect(goalCounts(goals)).toEqual({
      all: 5,
      "needs-you": 2,
      working: 1,
      done: 2,
    });
  });
});
