import { widgetSource, matchesSource } from "./widgetSource";

/**
 * Where a widget in the Add panel comes from (create-entry CRE-010 AC2):
 * Built in (ships with Dash), Mine (my @ai-built/ scope or my registry
 * username's scope), or Installed (someone else's package).
 */
describe("widgetSource", () => {
  test("Dash's own widgets are built in", () => {
    expect(widgetSource({ key: "dash.bots.BotResults", widget: {} })).toBe(
      "builtin",
    );
  });

  test("@ai-built widgets are mine, by package or by key", () => {
    expect(
      widgetSource({
        key: "x",
        widget: { package: "@ai-built/importantemails" },
      }),
    ).toBe("mine");
    expect(
      widgetSource({
        key: "ai-built.importantemails.ImportantEmails",
        widget: {},
      }),
    ).toBe("mine");
  });

  test("my registry username's scope is mine (case and @ ignored)", () => {
    expect(
      widgetSource({ key: "trops.algolia.Search", widget: {} }, "Trops"),
    ).toBe("mine");
    expect(
      widgetSource(
        { key: "x", widget: { package: "@trops/algolia" } },
        "@trops",
      ),
    ).toBe("mine");
  });

  test("anyone else's package is installed", () => {
    expect(widgetSource({ key: "acme.jira.Board", widget: {} }, "trops")).toBe(
      "installed",
    );
    expect(widgetSource({ key: "trops.algolia.Search", widget: {} })).toBe(
      "installed",
    );
    expect(widgetSource({ key: "Clock", widget: {} }, "trops")).toBe(
      "installed",
    );
  });
});

describe("matchesSource", () => {
  const mine = { key: "ai-built.a.A", widget: {} };
  const builtin = { key: "dash.bots.BotResults", widget: {} };
  const other = { key: "acme.b.B", widget: {} };

  test("all matches everything", () => {
    for (const w of [mine, builtin, other]) {
      expect(matchesSource(w, "all")).toBe(true);
    }
  });

  test("each filter matches only its source", () => {
    expect(matchesSource(mine, "mine")).toBe(true);
    expect(matchesSource(other, "mine")).toBe(false);
    expect(matchesSource(builtin, "builtin")).toBe(true);
    expect(matchesSource(mine, "builtin")).toBe(false);
    expect(matchesSource(other, "installed")).toBe(true);
    expect(matchesSource(builtin, "installed")).toBe(false);
  });
});
