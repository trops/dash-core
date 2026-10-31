/**
 * The plan's next step (plan → build): what the card offers in each state,
 * the requests the app sends the Planner itself, a typed plain "yes", and
 * answers that made nothing.
 */
import {
  answerRequest,
  choicesIndex,
  decideRequest,
  fixRequest,
  isPlainYes,
  nextNeedsYou,
  planNext,
  startOverRequest,
  withPlanContext,
} from "./workspacePlan";
import { didNothing, withResult } from "./handoffSteps";

const THEME = {
  kind: "theme",
  name: "Halloween",
  source: "new",
  colors: { primary: "#f97316" },
};
const READY = { summary: "Halloween", pieces: [THEME] };
const ASKS = {
  ...READY,
  questions: [{ question: "Where?", options: ["Just save it"] }],
};
const you = (text) => ({ who: "you", text });
const step = (plan, extra = {}) => ({
  who: "step",
  id: "1:t1",
  bot: "the Planner",
  status: "done",
  answer: "ok",
  ...(plan ? { plan } : {}),
  ...extra,
});

describe("planNext", () => {
  const lead = { who: "role", text: "Here it is." };
  test("questions, ready, gaps, empty", () => {
    expect(
      planNext({ messages: [you("x"), step(ASKS), lead], plan: ASKS }),
    ).toBe("question");
    expect(
      planNext({ messages: [you("x"), step(READY), lead], plan: READY }),
    ).toBe("ready");
    expect(
      planNext({
        messages: [you("x"), step(READY), lead],
        plan: READY,
        check: { errors: ["no pieces"] },
      }),
    ).toBe("gaps");
    expect(
      planNext({
        messages: [you("x"), step({ pieces: [] }), lead],
        plan: { pieces: [] },
      }),
    ).toBe("empty");
  });

  test("while someone answers: waiting for the Planner, or the lead answering", () => {
    const asking = step(null, {
      id: "2:planner",
      direct: true,
      status: "asking",
    });
    expect(
      planNext({
        messages: [you("x"), step(ASKS), you("y"), asking],
        plan: ASKS,
      }),
    ).toBe("waiting");
    expect(
      planNext({
        messages: [you("x"), step(READY), lead, you("what?")],
        plan: READY,
      }),
    ).toBe("answering");
  });

  test("the app asked the Planner and no plan came: nothing (never silence)", () => {
    const none = step(null, { id: "2:planner", direct: true });
    expect(
      planNext({
        messages: [you("x"), step(ASKS), you("y"), none],
        plan: ASKS,
      }),
    ).toBe("nothing");
    // Even with no plan at all.
    expect(planNext({ messages: [you("x"), none], plan: null })).toBe(
      "nothing",
    );
    expect(planNext({ messages: [you("x")], plan: null })).toBeNull();
  });

  test("building, and sent to the old Create window", () => {
    expect(
      planNext({ messages: [you("x"), step(READY)], plan: READY, build: {} }),
    ).toBe("build");
    expect(
      planNext({
        messages: [you("x"), step(READY), lead],
        plan: READY,
        sent: true,
      }),
    ).toBe("sent");
  });

  test("what waits on you marks the card", () => {
    for (const n of ["question", "ready", "nothing", "gaps", "empty"])
      expect(nextNeedsYou(n)).toBe(true);
    for (const n of ["waiting", "answering", "build", "sent", null])
      expect(nextNeedsYou(n)).toBe(false);
  });
});

describe("the choices after the app's own hand-off", () => {
  test("go under the Planner's step, since no lead answers after it", () => {
    const direct = step(READY, { id: "2:planner", direct: true });
    const list = [you("x"), step(ASKS), you("y"), direct];
    expect(choicesIndex(list)).toBe(3);
    // Still answering: none yet.
    expect(
      choicesIndex([
        you("x"),
        { ...direct, status: "asking", plan: undefined },
      ]),
    ).toBe(-1);
  });
});

describe("what the Planner is sent", () => {
  test("an answer: the answer, the plan, and to send the plan back", () => {
    const r = answerRequest("Where? — Just save it", ASKS, {
      asked: "Make me a Halloween theme",
      edits: ["removed Weather"],
    });
    expect(r).toMatch(/^\(I changed the plan: removed Weather/);
    expect(r).toContain('"Where? — Just save it"');
    expect(r).toContain('The user\'s request: "Make me a Halloween theme"');
    expect(r).toContain(JSON.stringify(ASKS));
    expect(r).toContain("<plan></plan>");
    expect(r).toMatch(/leave out every question it answers/);
  });

  test("Decide for me: no questions left", () => {
    const r = decideRequest(ASKS, { asked: "Make me a theme" });
    expect(r).toMatch(/decide for them/);
    expect(r).toMatch(/Leave no questions/);
    expect(r).toContain(JSON.stringify(ASKS));
  });

  test("the gaps, one per line; start over from the first words", () => {
    expect(fixRequest(["a", "b"], READY)).toContain("- a\n- b");
    expect(startOverRequest("Make me a theme")).toMatch(
      /from the start.*"Make me a theme"/,
    );
  });

  test("a typed reply while the plan asks says it answers the Planner", () => {
    expect(withPlanContext("just save it", ASKS)).toMatch(
      /This answers the Planner's questions — send it to the Planner/,
    );
    expect(withPlanContext("make it purple", READY)).toMatch(
      /If this changes it, ask the Planner/,
    );
  });
});

describe("a typed plain yes", () => {
  test.each([
    "yes",
    "Yes!",
    "yes build it",
    "Yes, build it.",
    "yes please",
    "ok build it",
    "yes — build it",
    "go ahead",
    "build it",
    "make it please",
    "Yeah, do it",
  ])("%s builds", (t) => expect(isPlainYes(t)).toBe(true));
  test.each([
    "yes but make it purple",
    "no",
    "what colors?",
    "yes, and add a clock",
    // A bare ok answers the lead; it isn't a go-ahead to build.
    "ok",
    "sure",
    "",
    "build it with a calendar",
  ])("%s doesn't", (t) => expect(isPlainYes(t)).toBe(false));
});

describe("an answer that made nothing", () => {
  test.each([
    "I haven't created anything, and nothing has failed.",
    "I can't build or save a theme from here.",
    "Sorry, I couldn't make that.",
    "I didn't change anything.",
    "I wasn't able to make the theme from here.",
    "Unable to create a theme with my tools.",
    "I can not save themes.",
  ])("%s", (t) => expect(didNothing(t)).toBe(true));
  test.each([
    "Built the Lights panel.",
    "I can see 3 widgets.",
    "",
    // Something was made after all: still an output.
    "I haven't changed the layout, but I added a Weather widget.",
    "Couldn't make it blue, so I made it teal and saved it.",
  ])("%s is an answer", (t) => expect(didNothing(t)).toBe(false));

  test("the step is marked, and stays in the chat", () => {
    const asked = {
      who: "step",
      id: "1:c",
      bot: "the Builder",
      status: "asking",
    };
    const [s] = withResult([asked], {
      type: "tool_result",
      id: "1:c",
      output: "I haven't created anything. I can't save themes from here.",
    });
    expect(s.nothing).toBe(true);
    expect(s.answer).toMatch(/haven't created/);
  });
});
