import {
  nextAbove,
  newerVersion,
  versionLine,
  widgetVersionPlan,
} from "./publishVersions";

describe("which version a widget goes up as (DASH-22)", () => {
  test("next above the higher of the two", () => {
    expect(nextAbove("2.0.0", "3.0.0")).toBe("3.0.1");
    expect(nextAbove("1.0.4", "1.0.3")).toBe("1.0.5");
    expect(nextAbove("1.0.4-local.2", null)).toBe("1.0.5");
    expect(newerVersion("1.0.10", "1.0.9")).toBe(true);
  });

  test("not in the registry: as it is", () => {
    expect(
      widgetVersionPlan({ mine: "1.0.0", latest: null, changed: null }),
    ).toMatchObject({ case: "new", version: "1.0.0" });
  });

  test("no changes since it was published: skipped, the dashboard uses it", () => {
    const p = widgetVersionPlan({
      mine: "1.2.0",
      latest: "1.2.0",
      changed: false,
      basedOn: "1.2.0",
    });
    expect(p).toMatchObject({ case: "unchanged", version: null });
    expect(versionLine(p)).toBe(
      "No changes since 1.2.0 — not published again. The dashboard uses 1.2.0.",
    );
  });

  test("changed here: the next version above everything published", () => {
    const p = widgetVersionPlan({
      mine: "1.0.0",
      latest: "1.0.0",
      changed: true,
      basedOn: "1.0.0",
    });
    expect(p).toMatchObject({ case: "changed", version: "1.0.1" });
  });

  test("changed here, and the registry has a newer one from elsewhere: the user chooses", () => {
    const p = widgetVersionPlan({
      mine: "2.0.0",
      latest: "3.0.0",
      changed: true,
      basedOn: "2.0.0",
    });
    expect(p).toMatchObject({ case: "conflict", version: "3.0.1" });
    expect(versionLine(p, "mine")).toBe(
      "Yours goes up as 3.0.1 — anything that's only in 3.0.0 won't be in it.",
    );
    expect(versionLine(p, "theirs")).toBe(
      "Yours isn't published — the dashboard uses 3.0.0.",
    );
  });

  test("no record of what was published: treated as changed, never below the registry", () => {
    expect(
      widgetVersionPlan({ mine: "1.0.0", latest: "1.0.0", changed: null }),
    ).toMatchObject({ case: "changed", version: "1.0.1" });
    expect(
      widgetVersionPlan({ mine: "2.0.0", latest: "3.0.0", changed: null }),
    ).toMatchObject({ case: "conflict", version: "3.0.1" });
  });

  test("unchanged only when it can be trusted: another account, or a version the registry no longer has, go up", () => {
    expect(
      widgetVersionPlan({
        mine: "1.0.0",
        latest: "1.0.0",
        changed: false,
        basedOn: "1.0.0",
        sameAccount: false,
      }),
    ).toMatchObject({ case: "changed", version: "1.0.1" });
    expect(
      widgetVersionPlan({
        mine: "1.0.5",
        latest: "1.0.3",
        changed: false,
        basedOn: "1.0.5",
      }),
    ).toMatchObject({ case: "changed", version: "1.0.6" });
  });
});
