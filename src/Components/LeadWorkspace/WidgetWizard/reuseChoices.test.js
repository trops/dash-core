/**
 * A widget the user already has: what they chose holds only for that widget
 * (pre-release review) — a new plan for another package, or switching
 * between theirs and a new one, starts over; a pick from another package is
 * never applied.
 */
import { carryChoices } from "../useWorkspacePlan";
import { applyChoices } from "./widgetSpec";

const CELL = { cellNumber: "3.2" };
const planOf = (piece) => ({
  summary: "x",
  cell: CELL,
  pieces: [{ kind: "widget", name: "Clock", ...piece }],
});
const yours = planOf({ source: "yours", package: "clock" });
const carried = {
  wizardStage: "settings",
  choicesFor: "clock:yours",
  choices: {
    component: "trops.clock.FlipClockWidget",
    provider: { x: "X" },
    settings: { hourFormat: "24" },
  },
};

test("the same widget of theirs: the choices hold", () => {
  expect(carryChoices(carried, yours, yours).choices).toEqual(carried.choices);
});

test("Build a new one instead (same name, new): starts over", () => {
  const next = planOf({ source: "new" });
  expect(carryChoices(carried, yours, next)).toEqual({
    wizardStage: null,
    choices: {},
    choicesFor: null,
  });
});

test("the Planner picked another package: its pick, settings and connection go", () => {
  const next = planOf({ source: "yours", package: "worldclock" });
  const c = carryChoices(carried, yours, next).choices;
  expect(c.component).toBeUndefined();
  expect(c.settings).toBeUndefined();
  expect(c.provider).toBeUndefined();
});

test("a pick from another package is never applied", () => {
  const plan = planOf({ source: "yours", package: "worldclock" });
  const out = applyChoices(plan, 0, {
    component: "trops.clock.FlipClockWidget",
  });
  expect(out.pieces[0].component).toBeUndefined();
  const same = applyChoices(yours, 0, {
    component: "trops.clock.FlipClockWidget",
  });
  expect(same.pieces[0].component).toBe("trops.clock.FlipClockWidget");
});
