/**
 * reuseSpec — a widget the user already has, into a cell: which of its
 * package's widgets, its own settings (the Planner's value first), review.
 */
import {
  componentNamed,
  nextReuseStage,
  packageComponentIds,
  readsFromNeeds,
  reuseIndex,
  settingFields,
  settingsLine,
} from "./reuseSpec";

const CELL = { cellNumber: "3.2" };
const clock = (over = {}) => ({
  kind: "widget",
  name: "Digital Clock",
  source: "yours",
  package: "clock",
  settings: { hourFormat: "12", showDate: "true" },
  ...over,
});

describe("reuseIndex", () => {
  test("a cell plan reusing one widget you have", () => {
    expect(reuseIndex({ cell: CELL, pieces: [clock()] })).toBe(0);
    expect(
      reuseIndex({ cell: CELL, pieces: [clock({ source: "registry" })] }),
    ).toBe(0);
    // One the Dash team built for you before (found live: a Calendar).
    expect(
      reuseIndex({
        cell: CELL,
        pieces: [
          clock({ source: "ai-built", package: "@ai-built/hacalendartoday" }),
        ],
      }),
    ).toBe(0);
  });
  test("a new widget, several, bots, no cell or a settings change: not this", () => {
    expect(reuseIndex({ cell: CELL, pieces: [clock({ source: "new" })] })).toBe(
      -1,
    );
    expect(reuseIndex({ cell: CELL, pieces: [clock(), clock()] })).toBe(-1);
    expect(
      reuseIndex({ cell: CELL, pieces: [clock(), { kind: "bot", name: "B" }] }),
    ).toBe(-1);
    expect(reuseIndex({ pieces: [clock()] })).toBe(-1);
    expect(
      reuseIndex({ cell: CELL, pieces: [clock({ source: "settings" })] }),
    ).toBe(-1);
    expect(reuseIndex({ cell: CELL, pieces: [clock({ package: "" })] })).toBe(
      -1,
    );
  });
});

describe("packageComponentIds", () => {
  const ids = [
    "trops.clock.AnalogClockWidget",
    "trops.clock.DigitalClockWidget",
    "trops.clock.FlipClockWidget",
    "ai-built.clockwidget.ClockWidget",
    "trops.weather.WeatherWidget",
    "Bare",
  ];
  test("by its bare or scoped name — only that package's", () => {
    const three = [
      "trops.clock.AnalogClockWidget",
      "trops.clock.DigitalClockWidget",
      "trops.clock.FlipClockWidget",
    ];
    expect(packageComponentIds("clock", ids)).toEqual(three);
    expect(packageComponentIds("@trops/clock", ids)).toEqual(three);
    expect(packageComponentIds("@other/clock", ids)).toEqual([]);
    expect(packageComponentIds("", ids)).toEqual([]);
  });
  test("the Planner's name finds its widget", () => {
    expect(componentNamed(ids, "Digital Clock")).toBe(
      "trops.clock.DigitalClockWidget",
    );
    expect(
      componentNamed(ids, "Words", (id) =>
        id.endsWith("FlipClockWidget") ? "Words" : "",
      ),
    ).toBe("trops.clock.FlipClockWidget");
    expect(componentNamed(ids, "Nope")).toBeNull();
  });
});

describe("settingFields", () => {
  const userConfig = {
    title: { type: "text", defaultValue: "", displayName: "Title" },
    hourFormat: {
      type: "select",
      defaultValue: "12",
      displayName: "Hour Format",
      options: [
        { displayName: "12-hour", value: "12" },
        { displayName: "24-hour", value: "24" },
      ],
    },
    showSeconds: {
      type: "select",
      defaultValue: "true",
      displayName: "Show Seconds",
      options: [
        { displayName: "Yes", value: "true" },
        { displayName: "No", value: "false" },
      ],
    },
  };
  test("each setting's choices, the Planner's suggestion first", () => {
    const f = settingFields(userConfig, { showSeconds: "false" });
    expect(f.map((x) => x.key)).toEqual(["title", "hourFormat", "showSeconds"]);
    const secs = f.find((x) => x.key === "showSeconds");
    expect(secs.kind).toBe("choice");
    expect(secs.options.map((o) => o.label)).toEqual(["No", "Yes"]);
    expect(secs.value).toBe("false");
    expect(f.find((x) => x.key === "title").kind).toBe("text");
  });
  test("what the user chose wins; the line says it plainly", () => {
    const f = settingFields(
      userConfig,
      { hourFormat: 12 },
      { hourFormat: "24", title: "Kitchen" },
    );
    expect(f.find((x) => x.key === "hourFormat").value).toBe("24");
    expect(settingsLine(f)).toBe(
      "Title: Kitchen · Hour Format: 24-hour · Show Seconds: Yes",
    );
    expect(settingsLine([])).toBe("As it comes");
  });
});

test("the steps go Which one → Settings → Review", () => {
  expect(nextReuseStage("which")).toBe("settings");
  expect(nextReuseStage("settings")).toBe("review");
  expect(nextReuseStage("review")).toBe("review");
});

describe("readsFromNeeds — what a widget you have reads from", () => {
  const providers = {
    "Google Calendar": {
      name: "Google Calendar",
      type: "google-calendar",
      providerClass: "mcp",
    },
    "Work Calendar": {
      name: "Work Calendar",
      type: "google-calendar",
      providerClass: "mcp",
    },
    "Home Assistant MCP": {
      name: "Home Assistant MCP",
      type: "home-assistant-mcp",
      providerClass: "mcp",
    },
  };
  const cal = [
    { type: "google-calendar", providerClass: "mcp", required: true },
  ];
  test("only providers of the kind it's built for; several are yours to choose", () => {
    expect(readsFromNeeds(cal, providers)).toEqual([
      {
        type: "google-calendar",
        providerClass: "mcp",
        required: true,
        options: ["Google Calendar", "Work Calendar"],
        selected: null,
      },
    ]);
  });
  test("one is used as it is; a pin holds when it's one of them", () => {
    const one = { "Google Calendar": providers["Google Calendar"] };
    expect(readsFromNeeds(cal, one)[0].selected).toBe("Google Calendar");
    expect(
      readsFromNeeds(cal, providers, { "google-calendar": "Work Calendar" })[0]
        .selected,
    ).toBe("Work Calendar");
    expect(
      readsFromNeeds(cal, providers, {
        "google-calendar": "Home Assistant MCP",
      })[0].selected,
    ).toBeNull();
  });
  test("none of that kind: missing; none needed: nothing", () => {
    expect(readsFromNeeds(cal, {})[0].options).toEqual([]);
    expect(readsFromNeeds([], providers)).toEqual([]);
    expect(
      readsFromNeeds([{ type: "x", providerClass: "api" }], providers),
    ).toEqual([]);
  });
});
