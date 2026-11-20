/**
 * A lead asked from outside the app (an MCP task), as its conversation:
 * what was asked, its hand-offs as steps (the plan kept, to say yes to) and
 * its answer — never an empty conversation.
 */
import { backgroundMessages } from "./handoffSteps";

const PLAN = {
  summary: "Two more bots for the woodworking team",
  pieces: [{ kind: "bot", name: "Lumber Prices", source: "new" }],
};

const bg = (extra) => ({
  from: "claude",
  status: "completed",
  events: [
    {
      type: "tool_call",
      id: "t1",
      name: "mcp__bot-mcp__team_ask_dash_team",
      input: { role: "planner", request: "Plan two more bots" },
    },
    {
      type: "tool_result",
      id: "t1",
      output: `Planner: Here's the plan.\n<plan>${JSON.stringify(PLAN)}</plan>`,
    },
  ],
  answer: "I brought in the Dash team. The plan is ready for your yes.",
  ...extra,
});

describe("an MCP task, as its conversation", () => {
  test("what was asked, by whom; the Dash team's step with its plan; the answer", () => {
    const m = backgroundMessages(
      bg(),
      "Make more bots",
      "Woodworking Projects Lead",
    );
    expect(m[0]).toEqual({ who: "you", text: "Make more bots", via: "claude" });
    expect(m[1]).toMatchObject({
      who: "step",
      bot: "the Planner",
      label: "Brought in the Dash team · asked the Planner",
      status: "done",
      dashTeam: true,
      plan: PLAN,
    });
    expect(m[2]).toEqual({
      who: "lead",
      by: "Woodworking Projects Lead",
      text: "I brought in the Dash team. The plan is ready for your yes.",
    });
  });

  test("still running: the step asks; ended without a result: stopped", () => {
    const running = backgroundMessages(
      bg({ status: "running", events: bg().events.slice(0, 1), answer: "" }),
      "Make more bots",
    );
    expect(running[1].status).toBe("asking");
    expect(running).toHaveLength(2);
    const cut = backgroundMessages(
      bg({
        status: "failed",
        events: bg().events.slice(0, 1),
        answer: "",
        error: "Dash closed",
      }),
      "Make more bots",
      "Lead",
    );
    expect(cut[1].status).toBe("stopped");
    expect(cut[2].text).toBe("I couldn't finish this: Dash closed");
  });
});
