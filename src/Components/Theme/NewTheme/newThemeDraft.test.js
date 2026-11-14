import {
  STARTS,
  buildNewTheme,
  colorsOf,
  createProblem,
  fromRegistry,
  hexOrNull,
  isGrey,
  keepGreysGrey,
  newThemeKey,
  siteName,
} from "./newThemeDraft";

describe("newThemeDraft", () => {
  test("five ways to start, the registry among them", () => {
    expect(STARTS.map((s) => s.value)).toEqual([
      "preset",
      "color",
      "random",
      "website",
      "registry",
    ]);
  });

  test("colorsOf reads presets, generated themes and registry packages", () => {
    expect(
      colorsOf({
        primary: "orange",
        secondary: "rose",
        tertiary: "amber",
        neutral: "stone",
      }),
    ).toEqual({
      primary: "orange",
      secondary: "rose",
      tertiary: "amber",
      neutral: "stone",
    });
    expect(colorsOf({ colors: { primary: "#0ea5e9" } })).toEqual({
      primary: "#0ea5e9",
      secondary: "#0ea5e9",
      tertiary: "#0ea5e9",
      neutral: "gray",
    });
    expect(colorsOf(null)).toBeNull();
    expect(colorsOf({ name: "no colors" })).toBeNull();
  });

  test("Surprise me keeps greys grey", () => {
    expect(isGrey("slate")).toBe(true);
    expect(isGrey("#6b7280")).toBe(true);
    expect(isGrey("#84cc16")).toBe(false);
    expect(
      keepGreysGrey({ primary: "#10b981", neutral: "#84cc16" }).neutral,
    ).toBe("slate");
    expect(
      keepGreysGrey({ primary: "#10b981", neutral: "#64748b" }).neutral,
    ).toBe("#64748b");
  });

  test("a registry theme brings its colors, name, strength and credit", () => {
    const made = fromRegistry({
      scope: "@maria",
      name: "nordic-dawn",
      displayName: "Nordic Dawn",
      version: "1.2.0",
      strength: "bold",
      colors: {
        primary: "sky",
        secondary: "pink",
        tertiary: "amber",
        neutral: "slate",
      },
    });
    expect(made.name).toBe("Nordic Dawn");
    expect(made.strength).toBe("bold");
    expect(made.colors.primary).toBe("sky");
    expect(made.remixedFrom).toEqual({
      package: "maria/nordic-dawn",
      version: "1.2.0",
    });
    expect(
      fromRegistry({ name: "x", colors: { primary: "red" } }).strength,
    ).toBeNull();
  });

  test("Create theme says what's missing", () => {
    const colors = { primary: "orange" };
    expect(createProblem({ colors: null, name: "Sunset" })).toBe(
      "Pick the colors first.",
    );
    expect(createProblem({ colors, name: "  " })).toBe(
      "Give it a name to create it.",
    );
    expect(createProblem({ colors, name: "Sunset" })).toBeNull();
  });

  test("the saved theme: trimmed name, four colors, a valid strength", () => {
    const t = buildNewTheme({
      key: "theme-1",
      colors: {
        primary: "orange",
        secondary: "rose",
        tertiary: "amber",
        neutral: "stone",
      },
      name: " Sunset ",
      strength: "loud",
    });
    expect(t).toEqual({
      id: "theme-1",
      name: "Sunset",
      primary: "orange",
      secondary: "rose",
      tertiary: "amber",
      neutral: "stone",
      strength: "balanced",
      dark: {},
      light: {},
    });
    const remix = buildNewTheme({
      key: "k",
      colors: { primary: "sky" },
      name: "N",
      strength: "bold",
      remixedFrom: { package: "maria/nordic-dawn", version: null },
    });
    expect(remix.remixedFrom.package).toBe("maria/nordic-dawn");
    expect(remix.strength).toBe("bold");
  });

  test("a pasted color, with or without #", () => {
    expect(hexOrNull("8B5CF6")).toBe("#8b5cf6");
    expect(hexOrNull(" #10b981 ")).toBe("#10b981");
    expect(hexOrNull("blue")).toBeNull();
    expect(hexOrNull("#123")).toBeNull();
  });

  test("a website's name, for the theme name", () => {
    expect(siteName("https://www.example-coffee.com/menu")).toBe(
      "Example Coffee",
    );
    expect(siteName("shop.example.org")).toBe("Shop Example");
    expect(siteName("::")).toBe("");
  });

  test("a new key never clashes", () => {
    expect(newThemeKey({}, 5)).toBe("theme-5");
    expect(newThemeKey({ "theme-5": {} }, 5)).toBe("theme-5-2");
  });
});
