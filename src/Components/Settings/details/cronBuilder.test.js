import {
  buildCron,
  parseCron,
  TIME_OPTIONS,
  DAYS_OF_MONTH,
} from "./cronBuilder";

describe("buildCron", () => {
  it("off → empty string (no schedule)", () => {
    expect(buildCron({ frequency: "off" })).toBe("");
    expect(buildCron({})).toBe("");
  });

  it("hourly → top of every hour", () => {
    expect(buildCron({ frequency: "hourly", time: "07:30" })).toBe("0 * * * *");
  });

  it("daily at a time", () => {
    expect(buildCron({ frequency: "daily", time: "07:00" })).toBe("0 7 * * *");
    expect(buildCron({ frequency: "daily", time: "13:45" })).toBe(
      "45 13 * * *",
    );
  });

  it("weekday (Mon–Fri)", () => {
    expect(buildCron({ frequency: "weekday", time: "09:00" })).toBe(
      "0 9 * * 1-5",
    );
  });

  it("weekly on a chosen day", () => {
    expect(
      buildCron({ frequency: "weekly", time: "08:15", dayOfWeek: "3" }),
    ).toBe("15 8 * * 3");
  });

  it("monthly on a chosen date", () => {
    expect(
      buildCron({ frequency: "monthly", time: "06:00", dayOfMonth: "15" }),
    ).toBe("0 6 15 * *");
  });
});

describe("parseCron", () => {
  it("empty → off", () => {
    expect(parseCron("")).toEqual({ frequency: "off" });
    expect(parseCron(null)).toEqual({ frequency: "off" });
  });

  it("recognizes hourly", () => {
    expect(parseCron("0 * * * *")).toEqual({ frequency: "hourly" });
  });

  it("recognizes daily / weekday / weekly / monthly", () => {
    expect(parseCron("0 7 * * *")).toEqual({
      frequency: "daily",
      time: "07:00",
    });
    expect(parseCron("0 9 * * 1-5")).toEqual({
      frequency: "weekday",
      time: "09:00",
    });
    expect(parseCron("15 8 * * 3")).toEqual({
      frequency: "weekly",
      time: "08:15",
      dayOfWeek: "3",
    });
    expect(parseCron("0 6 15 * *")).toEqual({
      frequency: "monthly",
      time: "06:00",
      dayOfMonth: "15",
    });
  });

  it("unrecognized expressions fall back to custom", () => {
    expect(parseCron("*/5 * * * *")).toEqual({ frequency: "custom" });
    expect(parseCron("0 0 1 1 *")).toEqual({ frequency: "custom" }); // month pinned
    expect(parseCron("not a cron")).toEqual({ frequency: "custom" });
  });

  it("round-trips everything buildCron produces", () => {
    const cases = [
      { frequency: "hourly" },
      { frequency: "daily", time: "07:00" },
      { frequency: "weekday", time: "09:30" },
      { frequency: "weekly", time: "08:15", dayOfWeek: "3" },
      { frequency: "monthly", time: "06:00", dayOfMonth: "15" },
    ];
    for (const c of cases) {
      expect(parseCron(buildCron(c))).toMatchObject(c);
    }
  });
});

describe("option constants", () => {
  it("time options cover the day in half-hour steps with 12h labels", () => {
    expect(TIME_OPTIONS).toHaveLength(48);
    expect(TIME_OPTIONS[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(TIME_OPTIONS).toContainEqual({ value: "13:30", label: "1:30 PM" });
  });

  it("day-of-month is limited to 1–28", () => {
    expect(DAYS_OF_MONTH).toHaveLength(28);
    expect(DAYS_OF_MONTH[0]).toEqual({ value: "1", label: "1st" });
    expect(DAYS_OF_MONTH[1]).toEqual({ value: "2", label: "2nd" });
  });
});
