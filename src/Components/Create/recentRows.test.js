import { questionThreads } from "./recentRows";

describe("questionThreads", () => {
  it("carries a bot waiting for its test (bot-test-run TST-003)", () => {
    const [t] = questionThreads(
      [
        {
          id: "q1",
          kind: "question",
          title: "Remind me of meetings",
          built: "ready",
          waitingTest: "Meeting Reminder",
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
      ],
      Date.parse("2026-11-18T10:05:00.000Z"),
    );
    expect(t.waitingTest).toBe("Meeting Reminder");
    expect(t.built).toBe("ready");
  });

  it("is null for a conversation with nothing waiting", () => {
    const [t] = questionThreads([
      { id: "q2", kind: "question", title: "Hi", updatedAt: "2026-11-18" },
    ]);
    expect(t.waitingTest).toBeNull();
  });
});
