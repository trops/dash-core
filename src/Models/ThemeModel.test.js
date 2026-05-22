/**
 * ThemeModel — hex-color branch pins.
 *
 * Backs `arbitrary-color-themes` PRD FR-002. Named-color path stays
 * byte-identical to today (US-003 backwards-compat); hex channels
 * emit `bg-[var(--{type}-{shade})]`-style tokens plus a `cssVars`
 * map on each variant that ThemePreviewProvider injects into :root.
 */
import { ThemeModel } from "./ThemeModel";

describe("ThemeModel — named colors (backwards compat)", () => {
  test("named primary emits classic bg-{name}-{shade} tokens", () => {
    const theme = ThemeModel({
      primary: "blue",
      secondary: "indigo",
      tertiary: "rose",
      neutral: "gray",
    });
    expect(theme.dark["bg-primary-medium"]).toBe("bg-blue-700");
    expect(theme.dark["bg-secondary-medium"]).toBe("bg-indigo-700");
    expect(theme.light["bg-primary-medium"]).toBe("bg-blue-300");
    expect(theme.dark["bg-primary-darkest"]).toBe("bg-blue-950");
    expect(theme.light["bg-primary-darkest"]).toBe("bg-blue-50");
  });

  test("named-color themes emit no cssVars (fast path)", () => {
    const theme = ThemeModel({ primary: "blue" });
    expect(theme.dark.cssVars).toBeUndefined();
    expect(theme.light.cssVars).toBeUndefined();
  });

  test("hover variants resolve to the next shade level", () => {
    const theme = ThemeModel({ primary: "blue" });
    // base medium = 700, hover next = 800
    expect(theme.dark["hover-bg-primary-medium"]).toBe("hover:bg-blue-800");
  });

  test("text tokens are inverted (light text on dark bg)", () => {
    const theme = ThemeModel({ primary: "blue" });
    // base medium = 700, invert(700) = 200
    expect(theme.dark["text-primary-medium"]).toBe("text-blue-200");
  });

  test("gradient tokens use medium → medium → dark shades", () => {
    const theme = ThemeModel({ primary: "blue" });
    expect(theme.dark["bg-primary-gradient-right"]).toBe(
      "bg-gradient-to-r from-blue-700 via-blue-700 to-blue-800",
    );
  });
});

describe("ThemeModel — hex colors", () => {
  test("hex primary emits bg-[var(--primary-{shade})] tokens", () => {
    const theme = ThemeModel({
      primary: "#4a154b",
      secondary: "indigo",
      tertiary: "rose",
      neutral: "gray",
    });
    expect(theme.dark["bg-primary-medium"]).toBe("bg-[var(--primary-700)]");
    expect(theme.light["bg-primary-medium"]).toBe("bg-[var(--primary-300)]");
  });

  test("hex primary populates cssVars on both variants", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    expect(theme.dark.cssVars).toBeDefined();
    expect(theme.light.cssVars).toBeDefined();
    // All 11 shades must be present
    for (const shade of [
      "50",
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
      "950",
    ]) {
      expect(theme.dark.cssVars[`--primary-${shade}`]).toMatch(
        /^#[0-9a-f]{6}$/,
      );
    }
    // Dark and light variants share the same cssVars (same shade map)
    expect(theme.dark.cssVars).toEqual(theme.light.cssVars);
  });

  test("non-hex channels in a mixed theme stay on the named path", () => {
    const theme = ThemeModel({
      primary: "#4a154b", // hex
      secondary: "indigo", // named
    });
    // Hex primary
    expect(theme.dark["bg-primary-medium"]).toBe("bg-[var(--primary-700)]");
    // Named secondary
    expect(theme.dark["bg-secondary-medium"]).toBe("bg-indigo-700");
    // cssVars only includes primary
    const cssVarKeys = Object.keys(theme.dark.cssVars);
    expect(cssVarKeys.some((k) => k.startsWith("--primary-"))).toBe(true);
    expect(cssVarKeys.some((k) => k.startsWith("--secondary-"))).toBe(false);
  });

  test("hex hover variants emit hover:bg-[var(...)] form", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    // base medium = 700, hover next = 800
    expect(theme.dark["hover-bg-primary-medium"]).toBe(
      "hover:bg-[var(--primary-800)]",
    );
  });

  test("hex text tokens emit text-[var(...)] form with inverted shade", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    // base medium = 700, invert(700) = 200
    expect(theme.dark["text-primary-medium"]).toBe("text-[var(--primary-200)]");
  });

  test("hex darkest token uses 950", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    expect(theme.dark["bg-primary-darkest"]).toBe("bg-[var(--primary-950)]");
    expect(theme.light["bg-primary-darkest"]).toBe("bg-[var(--primary-50)]");
  });

  test("hex gradient tokens use arbitrary-value stops", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    expect(theme.dark["bg-primary-gradient-right"]).toBe(
      "bg-gradient-to-r from-[var(--primary-700)] via-[var(--primary-700)] to-[var(--primary-800)]",
    );
  });
});

describe("ThemeModel — cssValue accessor", () => {
  test("named theme emits hex CSS values per token", () => {
    const theme = ThemeModel({ primary: "blue" });
    // bg-primary-medium → bg-blue-700 → #1d4ed8
    expect(theme.dark.cssValue["bg-primary-medium"]).toBe("#1d4ed8");
    // text-primary-medium → text-blue-200 (invert(700) = 200)
    expect(theme.dark.cssValue["text-primary-medium"]).toBe("#bfdbfe");
    // border-primary-medium → border-blue-700
    expect(theme.dark.cssValue["border-primary-medium"]).toBe("#1d4ed8");
    // light variant uses different shade (300 for bg-medium)
    expect(theme.light.cssValue["bg-primary-medium"]).toBe("#93c5fd");
  });

  test("hex theme emits var(...) CSS values per token", () => {
    const theme = ThemeModel({ primary: "#4a154b" });
    expect(theme.dark.cssValue["bg-primary-medium"]).toBe("var(--primary-700)");
    expect(theme.dark.cssValue["text-primary-medium"]).toBe(
      "var(--primary-200)",
    );
    expect(theme.dark.cssValue["border-primary-medium"]).toBe(
      "var(--primary-700)",
    );
    expect(theme.light.cssValue["bg-primary-medium"]).toBe(
      "var(--primary-300)",
    );
  });

  test("hover variants resolve to the next shade in cssValue too", () => {
    const theme = ThemeModel({ primary: "blue" });
    // hover-bg-primary-medium → hover:bg-blue-800 → #1e40af
    expect(theme.dark.cssValue["hover-bg-primary-medium"]).toBe("#1e40af");
  });

  test("darkest token has cssValue too", () => {
    const theme = ThemeModel({ primary: "blue" });
    expect(theme.dark.cssValue["bg-primary-darkest"]).toBe("#172554");
    expect(theme.light.cssValue["bg-primary-darkest"]).toBe("#eff6ff");
  });

  test("transparent tokens resolve to 'transparent'", () => {
    const theme = ThemeModel({ primary: "blue" });
    expect(theme.dark.cssValue["bg-none"]).toBe("transparent");
    expect(theme.dark.cssValue["border-none"]).toBe("transparent");
    expect(theme.dark.cssValue["hover-bg-none"]).toBe("transparent");
  });

  test("mixed theme: cssValue per channel routes through its own path", () => {
    const theme = ThemeModel({
      primary: "#4a154b", // hex
      secondary: "indigo", // named
    });
    expect(theme.dark.cssValue["bg-primary-medium"]).toBe("var(--primary-700)");
    expect(theme.dark.cssValue["bg-secondary-medium"]).toBe("#4338ca");
  });
});
