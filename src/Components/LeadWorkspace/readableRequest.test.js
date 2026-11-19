/**
 * readableRequest (DASH-20): what a bot was asked reads as words — a plan
 * sent along as data shows as its summary, never raw JSON.
 */
import { readableRequest } from "./handoffSteps";

const PLAN = {
  summary:
    "Add a clock to the empty cell at row 4, column 2 on the Smart Home dashboard.",
  pieces: [{ kind: "widget", name: "Digital Clock", source: "yours" }],
};

test("the plan sent to the Planner reads as its summary", () => {
  const sent = `The user's request: "add a clock"\n\nThe plan as it stands:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`\n\nSend the whole plan back inside <plan></plan>, as always, and say in a sentence or two what you changed.`;
  const out = readableRequest(sent);
  expect(out).toBe(
    `The user's request: "add a clock"\n\nThe plan so far: “${PLAN.summary}”`,
  );
  expect(out).not.toMatch(/[{}]|json|<plan>/);
});

test("a reply with the plan attached reads the same way", () => {
  const sent = `make it 24-hour\n\n(The plan as it stands. If this changes it, ask the Planner to change it and send it this plan with the change:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`)`;
  expect(readableRequest(sent)).toBe(
    `make it 24-hour\n\nThe plan so far: “${PLAN.summary}”`,
  );
});

test("a plan in an unlabelled code block reads the same way", () => {
  expect(
    readableRequest("Here it is:\n```\n" + JSON.stringify(PLAN) + "\n```"),
  ).toBe(`Here it is:\n“${PLAN.summary}”`);
});

test("data it can't read says so, in words; plain requests stay as they are", () => {
  expect(readableRequest("```json\n{oops\n```")).toBe(
    "(its details, attached)",
  );
  expect(readableRequest("Find my calendar widgets.")).toBe(
    "Find my calendar widgets.",
  );
});
