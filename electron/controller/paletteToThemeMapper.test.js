const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const paletteToThemeMapper = require("./paletteToThemeMapper");

const { assignRoles, matchTailwindFamily, generateThemeFromPalette } =
  paletteToThemeMapper;

describe("paletteToThemeMapper", () => {
  describe("matchTailwindFamily", () => {
    it("matches exact Tailwind blue", () => {
      const result = matchTailwindFamily("#3b82f6");
      assert.equal(result.family, "blue");
      assert.ok(result.deltaE < 1);
    });

    it("matches exact Tailwind red", () => {
      const result = matchTailwindFamily("#ef4444");
      assert.equal(result.family, "red");
      assert.ok(result.deltaE < 1);
    });

    it("matches exact Tailwind emerald", () => {
      const result = matchTailwindFamily("#10b981");
      assert.equal(result.family, "emerald");
      assert.ok(result.deltaE < 1);
    });

    it("matches near-blue to blue family", () => {
      const result = matchTailwindFamily("#4488ff");
      assert.equal(result.family, "blue");
      assert.ok(result.deltaE < 15);
    });

    it("matches near-purple to purple or violet", () => {
      const result = matchTailwindFamily("#9333ea");
      assert.ok(
        ["purple", "violet"].includes(result.family),
        `Expected purple or violet, got ${result.family}`,
      );
    });

    it("falls back to gray for invalid hex", () => {
      const result = matchTailwindFamily("not-a-color");
      assert.equal(result.family, "gray");
      assert.equal(result.deltaE, Infinity);
    });

    it("handles null input", () => {
      const result = matchTailwindFamily(null);
      assert.equal(result.family, "gray");
    });
  });

  describe("assignRoles", () => {
    it("returns defaults for empty palette", () => {
      const roles = assignRoles([]);
      assert.ok(roles.primary);
      assert.ok(roles.secondary);
      assert.ok(roles.tertiary);
      assert.ok(roles.neutral);
    });

    it("returns defaults for null palette", () => {
      const roles = assignRoles(null);
      assert.ok(roles.primary);
      assert.ok(roles.secondary);
      assert.ok(roles.tertiary);
      assert.ok(roles.neutral);
    });

    it("assigns primary as most prominent color", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.5 },
        { hex: "#10b981", confidence: 0.3 },
      ];
      const roles = assignRoles(palette);
      assert.equal(roles.primary, "#3b82f6");
    });

    it("assigns secondary with max hue distance from primary", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 }, // blue ~220°
        { hex: "#3a80f4", confidence: 0.8 }, // also blue ~220°
        { hex: "#ef4444", confidence: 0.6 }, // red ~0°
      ];
      const roles = assignRoles(palette);
      assert.equal(roles.primary, "#3b82f6");
      // Red should be secondary (max hue distance from blue)
      assert.equal(roles.secondary, "#ef4444");
    });

    it("assigns tertiary maximizing distance from both primary and secondary", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 }, // blue
        { hex: "#ef4444", confidence: 0.6 }, // red
        { hex: "#10b981", confidence: 0.4 }, // emerald/green
        { hex: "#6366f1", confidence: 0.3 }, // indigo (close to blue)
      ];
      const roles = assignRoles(palette);
      assert.equal(roles.primary, "#3b82f6");
      // Green should be tertiary (far from both blue and red)
      assert.equal(roles.tertiary, "#10b981");
    });

    it("handles single-color palette by generating analogous", () => {
      const palette = [{ hex: "#3b82f6", confidence: 1.0 }];
      const roles = assignRoles(palette);
      assert.equal(roles.primary, "#3b82f6");
      // Secondary and tertiary are generated, but should exist
      assert.ok(roles.secondary);
      assert.ok(roles.tertiary);
    });

    it("handles two-color palette", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.5 },
      ];
      const roles = assignRoles(palette);
      assert.equal(roles.primary, "#3b82f6");
      assert.equal(roles.secondary, "#ef4444");
      assert.ok(roles.tertiary);
    });

    it("assigns neutral from low-saturation colors", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
        { hex: "#10b981", confidence: 0.4 },
        { hex: "#6b7280", confidence: 0.3, isNeutral: true },
      ];
      const roles = assignRoles(palette);
      assert.equal(roles.neutral, "#6b7280");
    });

    it("uses fallback neutral when no neutral candidates", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
        { hex: "#10b981", confidence: 0.4 },
      ];
      const roles = assignRoles(palette);
      // Should have a neutral (either from palette or default)
      assert.ok(roles.neutral);
    });

    it("handles six-color palette", () => {
      const palette = [
        { hex: "#ef4444", confidence: 1.0 },
        { hex: "#f97316", confidence: 0.9 },
        { hex: "#eab308", confidence: 0.8 },
        { hex: "#22c55e", confidence: 0.7 },
        { hex: "#3b82f6", confidence: 0.6 },
        { hex: "#64748b", confidence: 0.3, isNeutral: true },
      ];
      const roles = assignRoles(palette);
      assert.ok(roles.primary);
      assert.ok(roles.secondary);
      assert.ok(roles.tertiary);
      assert.ok(roles.neutral);
      // All roles should be different
      const unique = new Set([roles.primary, roles.secondary, roles.tertiary]);
      assert.equal(
        unique.size,
        3,
        "Primary, secondary, tertiary must be distinct",
      );
    });
  });

  describe("generateThemeFromPalette", () => {
    it("generates a complete theme object from palette", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
        { hex: "#10b981", confidence: 0.4 },
        { hex: "#64748b", confidence: 0.3, isNeutral: true },
      ];
      const result = generateThemeFromPalette(palette);

      // Check structure
      assert.ok(result.theme, "Should return theme object");
      assert.ok(result.roleAssignments, "Should return roleAssignments");
      assert.ok(result.familyMatches, "Should return familyMatches");
    });

    it("theme object has required fields for ThemeModel", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
      ];
      const result = generateThemeFromPalette(palette);

      assert.ok(result.theme.id, "Theme must have an id");
      assert.ok(result.theme.name, "Theme must have a name");
      assert.ok(result.theme.primary, "Theme must have primary family");
      assert.ok(result.theme.secondary, "Theme must have secondary family");
      assert.ok(result.theme.tertiary, "Theme must have tertiary family");
      assert.ok(result.theme.neutral, "Theme must have neutral family");
      assert.ok("dark" in result.theme, "Theme must have dark object");
      assert.ok("light" in result.theme, "Theme must have light object");
    });

    it("maps colors to valid Tailwind families", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 }, // blue
        { hex: "#ef4444", confidence: 0.6 }, // red
        { hex: "#10b981", confidence: 0.4 }, // emerald
      ];
      const result = generateThemeFromPalette(palette);

      assert.equal(result.theme.primary, "blue");
      assert.equal(result.theme.secondary, "red");
      assert.equal(result.theme.tertiary, "emerald");
    });

    it("familyMatches include hex, family, and deltaE", () => {
      const palette = [{ hex: "#3b82f6", confidence: 1.0 }];
      const result = generateThemeFromPalette(palette);

      const pm = result.familyMatches.primary;
      assert.ok(pm.hex, "familyMatch must have hex");
      assert.ok(pm.family, "familyMatch must have family");
      assert.ok(typeof pm.deltaE === "number", "familyMatch must have deltaE");
    });

    it("applies role overrides", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
      ];
      const result = generateThemeFromPalette(palette, {
        primary: "#a855f7", // purple
      });

      assert.equal(result.roleAssignments.primary, "#a855f7");
      assert.equal(result.theme.primary, "purple");
    });

    it("forces low-saturation neutral to neutral Tailwind family", () => {
      const palette = [
        { hex: "#3b82f6", confidence: 1.0 },
        { hex: "#ef4444", confidence: 0.6 },
        { hex: "#10b981", confidence: 0.4 },
        { hex: "#6b7280", confidence: 0.3, isNeutral: true },
      ];
      const result = generateThemeFromPalette(palette);
      const neutralFamilies = ["slate", "gray", "zinc", "neutral", "stone"];
      assert.ok(
        neutralFamilies.includes(result.theme.neutral),
        `Neutral family should be one of ${neutralFamilies.join(", ")}, got ${result.theme.neutral}`,
      );
    });

    it("handles empty palette with defaults", () => {
      const result = generateThemeFromPalette([]);
      assert.ok(result.theme);
      assert.ok(result.theme.primary);
      assert.ok(result.theme.secondary);
    });

    it("integration: palette → theme → all tokens populated", () => {
      const palette = [
        { hex: "#6366f1", confidence: 1.0 },
        { hex: "#f59e0b", confidence: 0.8 },
        { hex: "#ec4899", confidence: 0.6 },
        { hex: "#64748b", confidence: 0.3, isNeutral: true },
      ];
      const result = generateThemeFromPalette(palette);

      // Theme should have valid Tailwind family names
      const validFamilies = [
        "slate",
        "gray",
        "zinc",
        "neutral",
        "stone",
        "red",
        "orange",
        "amber",
        "yellow",
        "lime",
        "green",
        "emerald",
        "teal",
        "cyan",
        "sky",
        "blue",
        "indigo",
        "violet",
        "purple",
        "fuchsia",
        "pink",
        "rose",
      ];
      assert.ok(
        validFamilies.includes(result.theme.primary),
        `Primary '${result.theme.primary}' must be a valid Tailwind family`,
      );
      assert.ok(
        validFamilies.includes(result.theme.secondary),
        `Secondary '${result.theme.secondary}' must be a valid Tailwind family`,
      );
      assert.ok(
        validFamilies.includes(result.theme.tertiary),
        `Tertiary '${result.theme.tertiary}' must be a valid Tailwind family`,
      );
      assert.ok(
        validFamilies.includes(result.theme.neutral),
        `Neutral '${result.theme.neutral}' must be a valid Tailwind family`,
      );

      // Role assignments should be hex strings
      assert.match(result.roleAssignments.primary, /^#[0-9a-f]{6}$/);
      assert.match(result.roleAssignments.secondary, /^#[0-9a-f]{6}$/);
      assert.match(result.roleAssignments.tertiary, /^#[0-9a-f]{6}$/);
      assert.match(result.roleAssignments.neutral, /^#[0-9a-f]{6}$/);
    });
  });
});
