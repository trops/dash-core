/**
 * The plan in a workspace conversation (lead-workspace release 3a): it rides
 * on the Planner's hand-off step; the latest one is the conversation's plan.
 */
import { withResult } from "./handoffSteps";
import {
  canBuild,
  choicesIndex,
  createMessages,
  stillAnswering,
  latestPlanStep,
  planLine,
  planName,
  planStatus,
  withPlanContext,
} from "./workspacePlan";

const PLAN = {
  summary: "A home dashboard with the weather and your lights",
  pieces: [
    {
      kind: "widget",
      name: "Weather",
      source: "registry",
      package: "@trops/weather",
    },
    { kind: "widget", name: "Lights panel", source: "new" },
    { kind: "layout", name: "Home", source: "new" },
  ],
};
const step = (id, plan) => ({
  who: "step",
  id,
  bot: "the Planner",
  status: "done",
  ...(plan ? { plan } : {}),
});

test("a Planner's answer with a plan: kept on the step, words shown without it", () => {
  const msgs = [
    { who: "step", id: "1:t1", bot: "the Planner", status: "asking" },
  ];
  const out = withResult(msgs, {
    type: "tool_result",
    id: "1:t1",
    output: `<dash_data>\nPlanner: Here's a plan.\n<plan>${JSON.stringify(PLAN)}</plan>\n</dash_data>`,
  });
  expect(out[0].plan).toEqual(PLAN);
  expect(out[0].answer).toBe("Here's a plan.");
  expect(out[0].result).toBe("Here's a plan.");
  // Only the plan: its summary stands in for the words.
  const bare = withResult(msgs, {
    type: "tool_result",
    id: "1:t1",
    output: `Planner: <plan>${JSON.stringify(PLAN)}</plan>`,
  });
  expect(bare[0].answer).toBe(PLAN.summary);
  // No plan, or a failure: an answer as before.
  const plain = withResult(msgs, {
    type: "tool_result",
    id: "1:t1",
    output: "Scout: Big Clock is yours.",
  });
  expect(plain[0].plan).toBeUndefined();
  expect(plain[0].answer).toBe("Big Clock is yours.");
});

test("the latest plan is the conversation's", () => {
  const first = step("1:t1", PLAN);
  const second = step("2:t1", { ...PLAN, summary: "Changed" });
  expect(latestPlanStep([first, { who: "role" }, second])).toBe(second);
  expect(latestPlanStep([{ who: "you" }, step("1:t2")])).toBeNull();
});

test("its name and line", () => {
  expect(planName(PLAN)).toBe("Home");
  expect(
    planName({ dashboard: { id: "7", name: "Kitchen Sink" }, pieces: [] }),
  ).toBe("Kitchen Sink");
  expect(
    planName({
      summary: "A brief",
      pieces: [{ kind: "widget", name: "Brief" }],
    }),
  ).toBe("Brief");
  expect(planLine(PLAN)).toMatch(/^Plan · /);
});

test("where it stands", () => {
  expect(
    planStatus({
      plan: { ...PLAN, questions: [{ question: "Which rooms?" }] },
    }),
  ).toBe("The Planner has a question");
  expect(planStatus({ plan: PLAN, check: { errors: ["x"] } })).toBe(
    "Needs fixing",
  );
  expect(planStatus({ plan: PLAN, check: { errors: [] }, open: 2 })).toBe(
    "Waiting for your go-ahead · 2 before it builds",
  );
  expect(planStatus({ plan: PLAN, check: { errors: [] }, open: 0 })).toBe(
    "Waiting for your go-ahead",
  );
});

test("the choices go under the lead's answer to the latest plan, while it ends the conversation", () => {
  const you = { who: "you", text: "Plan me a home dashboard" };
  const reply = { who: "role", text: "Here's the plan. Build it?" };
  expect(choicesIndex([you, step("1:t1", PLAN), reply])).toBe(2);
  // Not yet answered by the lead, or the user has replied since: none.
  expect(choicesIndex([you, step("1:t1", PLAN)])).toBe(-1);
  expect(
    choicesIndex([you, step("1:t1", PLAN), reply, { who: "you", text: "x" }]),
  ).toBe(-1);
  expect(choicesIndex([you, reply])).toBe(-1);
});

test("a reply takes the plan as it stands, and the changes made to it", () => {
  const text = withPlanContext("Make it blue", PLAN, ["removed Weather"]);
  expect(text).toMatch(
    /^\(I changed the plan: removed Weather\. Keep these changes\.\)\n\nMake it blue\n\n/,
  );
  expect(text).toContain(JSON.stringify(PLAN));
  expect(withPlanContext("Hello", null)).toBe("Hello");
});

test("choices only under the answer to the same question as the plan", () => {
  const you = { who: "you", text: "Plan it" };
  const reply = { who: "role", text: "Build it?" };
  const other = { who: "role", text: "Your bots ran twice." };
  // An unrelated question since: its answer gets no Yes, build it.
  expect(choicesIndex([you, step("1:t1", PLAN), reply, you, other])).toBe(-1);
});

test("still answering: the user's question is the last word, or a hand-off is out", () => {
  expect(stillAnswering([{ who: "you", text: "x" }])).toBe(true);
  expect(
    stillAnswering([{ who: "you" }, { who: "step", status: "asking" }]),
  ).toBe(true);
  expect(
    stillAnswering([{ who: "you" }, step("1:t1", PLAN), { who: "role" }]),
  ).toBe(false);
  expect(stillAnswering([])).toBe(false);
});

test("a plan can be built with pieces, no questions, nothing broken", () => {
  expect(canBuild({ plan: PLAN, check: { errors: [] } })).toBe(true);
  expect(canBuild({ plan: { ...PLAN, questions: [{ question: "?" }] } })).toBe(
    false,
  );
  expect(canBuild({ plan: PLAN, check: { errors: ["x"] } })).toBe(false);
  expect(canBuild({ plan: { summary: "x", pieces: [] } })).toBe(false);
  expect(canBuild({ plan: null })).toBe(false);
});

test("Create gets the user's words and who it was planned with", () => {
  expect(
    createMessages(
      [
        { who: "you", text: "Plan it" },
        step("1:t1", PLAN),
        { who: "role", text: "Build it?" },
        { who: "you", text: " " },
      ],
      "Dash Lead",
    ),
  ).toEqual([
    { who: "you", text: "Plan it" },
    { who: "note", text: "Planned with Dash Lead." },
  ]);
});
