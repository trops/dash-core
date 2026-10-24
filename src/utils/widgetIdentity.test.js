/**
 * pickWidgetDisplayName — a component's identifier reads as words, as
 * Create names it (QA 2026-10-22: the Fix card said "QaThrowerTwo").
 */
import {
  widgetPackageLabel,
  pickWidgetDisplayName,
  humanizeIdentifier,
} from "./widgetIdentity";

describe("pickWidgetDisplayName", () => {
  const item = { component: "ai-built.qathrowertwo.QaThrowerTwo" };

  test("the bare component name reads as words", () => {
    expect(pickWidgetDisplayName(item)).toBe("Qa Thrower Two");
  });

  test("a config name that is just the identifier reads as words", () => {
    expect(pickWidgetDisplayName(item, { name: "QaThrowerTwo" })).toBe(
      "Qa Thrower Two",
    );
  });

  test("a real config name, displayName or title is kept as written", () => {
    expect(pickWidgetDisplayName(item, { name: "QA Thrower" })).toBe(
      "QA Thrower",
    );
    expect(pickWidgetDisplayName(item, { displayName: "Thrower" })).toBe(
      "Thrower",
    );
    expect(
      pickWidgetDisplayName({ ...item, userPrefs: { title: "Mine" } }),
    ).toBe("Mine");
  });
});

describe("humanizeIdentifier", () => {
  test.each([
    ["QaThrowerTwo", "Qa Thrower Two"],
    ["ComposedWidget3", "Composed Widget 3"],
    ["MCPServer", "MCP Server"],
    ["qa_thrower", "qa thrower"],
  ])("%s → %s", (input, out) => {
    expect(humanizeIdentifier(input)).toBe(out);
  });
});

describe("widget names and packages for people (QA 2026-10-23)", () => {
  test("the widget's own default title beats a code-name displayName", () => {
    expect(
      pickWidgetDisplayName(
        { component: "trops.dash-samples.NotepadWidget" },
        {
          displayName: "NotepadWidget",
          userConfig: { title: { defaultValue: "Notepad" } },
        },
      ),
    ).toBe("Notepad");
  });
  test("package label: @scope/package, nothing for drafts or bare names", () => {
    expect(widgetPackageLabel("trops.dash-samples.NotepadWidget")).toBe(
      "@trops/dash-samples",
    );
    expect(widgetPackageLabel("ai-built.draft-abc123.Thing")).toBeNull();
    expect(widgetPackageLabel("Clock")).toBeNull();
  });
});
