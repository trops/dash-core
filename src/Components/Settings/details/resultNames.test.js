import { resultNameFor } from "./resultNames";

describe("resultNameFor (team-dashboards TD-001)", () => {
  it("turns a label into a camelCase result name", () => {
    expect(resultNameFor("Important emails")).toBe("importantEmails");
    expect(resultNameFor("  Daily digest — v2! ")).toBe("dailyDigestV2");
    expect(resultNameFor("PRs")).toBe("prs");
  });

  it("starts with a letter and stays within 40 characters", () => {
    expect(resultNameFor("3 hot leads")).toBe("result3HotLeads");
    expect(resultNameFor("x".repeat(60))).toHaveLength(40);
    expect(resultNameFor("")).toBe("result");
    expect(resultNameFor("!!!")).toBe("result");
  });

  it("numbers a name already taken", () => {
    expect(resultNameFor("Emails", ["emails"])).toBe("emails2");
    expect(resultNameFor("Emails", ["emails", "emails2"])).toBe("emails3");
    expect(resultNameFor("x".repeat(60), ["x".repeat(40)])).toBe(
      "x".repeat(39) + "2",
    );
  });

  it("always yields a valid result name", () => {
    const valid = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
    for (const label of ["Ünïcode mail", "a", "9", "Ω", "inbox (VIP)"]) {
      expect(resultNameFor(label)).toMatch(valid);
    }
  });
});
