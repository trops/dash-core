/**
 * offCommands (DASH-125): the commands that came with a package and are
 * off, as Check setup lists them, and turning them all on at once.
 */
import {
  offCommandOf,
  offCommands,
  offCommandsLine,
  turnOnAll,
} from "./offCommands";

const coder = {
  id: "b-c",
  name: "Coder",
  checks: {
    steps: [
      {
        id: "c1",
        kind: "check",
        name: "Installs",
        held: true,
        check: { kind: "command", command: "npm ci" },
      },
      {
        id: "c2",
        kind: "check",
        name: "Tests pass",
        held: true,
        check: { kind: "command", command: "npm test" },
      },
      { id: "c3", kind: "you", name: "You approve" },
      {
        id: "c4",
        kind: "check",
        name: "Lint",
        check: { kind: "command", command: "npm run lint" },
      },
    ],
    onFail: "back",
  },
};
const prBot = {
  id: "b-pr",
  name: "PR Bot",
  checks: {
    steps: [
      {
        id: "p1",
        kind: "check",
        name: "CI",
        held: true,
        check: { kind: "command", command: "gh pr checks" },
      },
    ],
  },
};

describe("offCommands", () => {
  it("lists each bot's checks that are off, with what they'd run", () => {
    expect(offCommands([coder, prBot, { id: "x", name: "Planner" }])).toEqual([
      {
        botId: "b-c",
        bot: "Coder",
        stepId: "c1",
        step: "Installs",
        command: "npm ci",
      },
      {
        botId: "b-c",
        bot: "Coder",
        stepId: "c2",
        step: "Tests pass",
        command: "npm test",
      },
      {
        botId: "b-pr",
        bot: "PR Bot",
        stepId: "p1",
        step: "CI",
        command: "gh pr checks",
      },
    ]);
    expect(offCommands(null)).toEqual([]);
  });

  it("a repo check, a package, a fallback", () => {
    expect(offCommandOf({ check: { kind: "repo", name: "validate" } })).toBe(
      ".dash/checks/validate",
    );
    expect(offCommandOf({ check: { kind: "package", package: "@a/b" } })).toBe(
      "@a/b",
    );
    expect(
      offCommandOf({
        check: { kind: "repo", fallback: { command: "make test" } },
      }),
    ).toBe("make test");
  });

  it("says them in one line, each bot's name after its commands", () => {
    expect(offCommandsLine(offCommands([coder, prBot]))).toBe(
      "3 commands that came with the package are off: npm ci, npm test (Coder), gh pr checks (PR Bot). Until they're on, those checks wait for your approval.",
    );
    expect(offCommandsLine(offCommands([prBot]))).toBe(
      "1 command that came with the package is off: gh pr checks (PR Bot). Until it's on, that check waits for your approval.",
    );
    expect(offCommandsLine([])).toBe("");
  });

  it("turns them all on, and leaves the rest as it was", () => {
    const on = turnOnAll(coder.checks);
    expect(on.steps.some((s) => s.held)).toBe(false);
    expect(on.steps[1]).toEqual({
      id: "c2",
      kind: "check",
      name: "Tests pass",
      check: { kind: "command", command: "npm test" },
    });
    expect(on.steps[2]).toBe(coder.checks.steps[2]);
    expect(on.onFail).toBe("back");
    expect(turnOnAll(null)).toBe(null);
  });
});
