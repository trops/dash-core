import { editorThemeKey } from "./editorThemeKey";

const themes = { a: {}, b: {}, c: {} };

describe("editorThemeKey — which theme the theme editor opens on", () => {
  it("opens on the requested theme (Themes page › Edit theme)", () => {
    expect(
      editorThemeKey({
        initialThemeKey: "c",
        settings: { theme: "b" },
        themes,
      }),
    ).toBe("c");
  });

  it("otherwise the app theme, else the first theme", () => {
    expect(editorThemeKey({ settings: { theme: "b" }, themes })).toBe("b");
    expect(
      editorThemeKey({
        initialThemeKey: "gone",
        settings: { theme: "x" },
        themes,
      }),
    ).toBe("a");
    expect(editorThemeKey({ settings: null, themes })).toBe("a");
  });

  it("is null without themes", () => {
    expect(editorThemeKey({ themes: null })).toBeNull();
  });
});
