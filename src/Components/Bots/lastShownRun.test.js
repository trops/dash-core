import { lastShownRun } from "./useTeamBots";

// A bot with checks (bot-checks PRD): its views show the last work that
// passed, and say when newer work is being checked.
describe("lastShownRun", () => {
  const plain = {
    status: "completed",
    output: "Old",
    endedAt: "2026-11-17T09:00:00Z",
  };

  it("is the last run when it has no checks or passed them", () => {
    expect(lastShownRun([plain])).toBe(plain);
    const passed = { ...plain, output: "New", checks: { state: "passed" } };
    expect(lastShownRun([plain, passed])).toBe(passed);
    expect(lastShownRun([])).toBe(null);
  });

  it("shows the last passed work while newer work is checked", () => {
    const held = {
      status: "completed",
      output: "Unchecked",
      endedAt: "2026-11-17T10:00:00Z",
      checks: { goalId: "goal_a", state: "checking" },
    };
    const run = lastShownRun([plain, held]);
    expect(run.output).toBe("Old");
    expect(run.shownAt).toBe("2026-11-17T09:00:00Z");
    expect(run.checking).toBe(true);
    expect(run.status).toBe("completed");
  });

  it("shows nothing new when the newer work didn't pass", () => {
    const stopped = {
      status: "completed",
      output: "Rejected",
      checks: { state: "stopped" },
    };
    const run = lastShownRun([stopped]);
    expect(run.output).toBe(null);
    expect(run.checking).toBe(false);
  });
});
