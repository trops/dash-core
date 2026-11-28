import { paramsFrom } from "./HelperCheckEditor";
import {
  FACTORY_HELPERS,
  newCheck,
  stepSub,
  autoKindOf,
  BUILT_IN_CHOICES,
} from "../Bots/checksView";

describe("a helper check in the checks window (DASH-160)", () => {
  it("starts as the Coder's plan check, reading the handed plan", () => {
    const step = newCheck("helper");
    expect(step.check).toEqual({
      kind: "helper",
      use: "git.changesMatchPlan",
      with: { planKeys: "files, tests" },
      handoffFrom: "handed",
    });
    expect(autoKindOf(step)).toBe("builtin");
    expect(BUILT_IN_CHOICES.some((b) => b.value === "helper")).toBe(true);
    expect(stepSub(step)).toBe(
      "Built in · Only the planned files changed · on the plan it was handed · no AI",
    );
  });

  it("offers dash-check's ten factory helpers and two plan helpers", () => {
    expect(FACTORY_HELPERS).toHaveLength(12);
    expect(FACTORY_HELPERS.map((h) => h.value)).toContain(
      "git.validateLeavesTreeClean",
    );
  });

  it("reads its params from JSON, or says what's wrong", () => {
    expect(paramsFrom('{ "maxLines": 900 }')).toEqual({
      with: { maxLines: 900 },
    });
    expect(paramsFrom("")).toEqual({ with: undefined });
    expect(paramsFrom("{}")).toEqual({ with: undefined });
    expect(paramsFrom("[1]").error).toMatch(/JSON object/);
    expect(paramsFrom("{ nope").error).toMatch(/JSON object/);
  });
});
