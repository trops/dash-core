import { untitledDashboardName } from "./untitledDashboardName";

/** New blank dashboards don't share a name (QA 2026-10-24). */
describe("untitledDashboardName", () => {
  test("the first is plain", () => {
    expect(untitledDashboardName([])).toBe("Untitled dashboard");
    expect(untitledDashboardName([{ name: "Inbox" }])).toBe(
      "Untitled dashboard",
    );
  });

  test("then numbered from 2", () => {
    expect(untitledDashboardName([{ name: "Untitled dashboard" }])).toBe(
      "Untitled dashboard 2",
    );
    expect(
      untitledDashboardName([
        { name: "Untitled dashboard" },
        { name: "Untitled dashboard 2" },
      ]),
    ).toBe("Untitled dashboard 3");
  });

  test("a gap is filled", () => {
    expect(
      untitledDashboardName([
        { name: "Untitled dashboard" },
        { name: "Untitled dashboard 3" },
      ]),
    ).toBe("Untitled dashboard 2");
  });

  test("case and spaces don't matter; missing names are ignored", () => {
    expect(
      untitledDashboardName([{ name: " untitled Dashboard " }, {}, null]),
    ).toBe("Untitled dashboard 2");
  });
});
