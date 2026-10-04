import { themeRows, filterThemes, duplicateTheme, paint } from "./themeSummary";

const themes = {
  "theme-a": { name: "Aurora", primary: "indigo" },
  "theme-b": { name: "Bravo", primary: "sky" },
  "theme-c": { name: "Coral", primary: "rose" },
  "theme-d": { primary: "gray" },
};
const workspaces = [
  { id: 1, name: "Kitchen Sink", themeKey: "theme-b" },
  { id: 2, name: "Mail", themeKey: "theme-b" },
  { id: 3, name: "Plain" },
];

describe("themeRows (app-navigation NAV-009 AC1)", () => {
  const rows = themeRows(themes, { appThemeKey: "theme-c", workspaces });

  it("lists the app theme first, then A-Z by name (key when unnamed)", () => {
    expect(rows.map((r) => r.key)).toEqual([
      "theme-c",
      "theme-a",
      "theme-b",
      "theme-d",
    ]);
    expect(rows[3].name).toBe("theme-d");
  });

  it("marks the app theme and the dashboards using each theme", () => {
    expect(rows[0].isApp).toBe(true);
    expect(rows[1].isApp).toBe(false);
    expect(rows[2].usedBy).toEqual([
      { workspaceId: 1, workspaceName: "Kitchen Sink" },
      { workspaceId: 2, workspaceName: "Mail" },
    ]);
    expect(rows[1].usedBy).toEqual([]);
  });

  it("is empty without themes", () => {
    expect(themeRows(null, {})).toEqual([]);
  });
});

describe("filterThemes (NAV-009 AC1)", () => {
  const rows = themeRows(themes, { appThemeKey: "theme-c", workspaces });
  const keys = (out) => out.map((r) => r.key);

  it("searches names", () => {
    expect(keys(filterThemes(rows, { query: "BRA" }))).toEqual(["theme-b"]);
  });

  it("in use = the app theme or used by a dashboard", () => {
    expect(keys(filterThemes(rows, { chip: "inUse" }))).toEqual([
      "theme-c",
      "theme-b",
    ]);
    expect(keys(filterThemes(rows, { chip: "notUsed" }))).toEqual([
      "theme-a",
      "theme-d",
    ]);
  });
});

describe("duplicateTheme (NAV-009 AC3)", () => {
  it("copies the raw theme under a new key and name, without registry metadata", () => {
    const raw = {
      id: "theme-b",
      name: "Bravo",
      primary: "sky",
      dark: { "bg-primary-dark": "bg-sky-900" },
      _registryMeta: { package: "@trops/bravo" },
    };
    const { key, theme } = duplicateTheme(raw, "theme-b", 1234);
    expect(key).toBe("theme-1234");
    expect(theme).toEqual({
      id: "theme-1234",
      name: "Bravo (Copy)",
      primary: "sky",
      dark: { "bg-primary-dark": "bg-sky-900" },
    });
    // A real copy — editing it leaves the original alone.
    theme.dark["bg-primary-dark"] = "x";
    expect(raw.dark["bg-primary-dark"]).toBe("bg-sky-900");
  });

  it("names an unnamed theme after its key", () => {
    expect(duplicateTheme({}, "theme-d", 1).theme.name).toBe("theme-d (Copy)");
  });
});

describe("paint", () => {
  it("returns the token's colour as an inline style value", () => {
    const variant = { cssValue: { "bg-primary-dark": "#312e81" } };
    expect(paint(variant, "bg-primary-dark")).toBe("#312e81");
    expect(paint(variant, "bg-primary-light")).toBeUndefined();
    expect(paint(undefined, "bg-primary-dark")).toBeUndefined();
  });
});
