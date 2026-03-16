/**
 * paletteToThemeMapper.js
 *
 * Maps an extracted color palette (from themeFromUrlController) to Dash's
 * 4-role theme model (primary, secondary, tertiary, neutral) and generates
 * a complete theme object compatible with ThemeModel.
 */

const { TAILWIND_COLORS } = require("../../src/utils/colorUtils");
const { generateThemeName } = require("../../src/utils/themeGenerator");

const VALID_HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ─── Color conversion helpers ───────────────────────────────────────────────
// These mirror the helpers in themeFromUrlController but are kept local
// to avoid coupling the two modules.

/** Parse hex string "#rrggbb" or "#rgb" → { r, g, b } (0-255). */
function parseHex(hex) {
  if (!hex || typeof hex !== "string") return null;
  const s = hex.trim().toLowerCase();
  const m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else {
    h = h.slice(0, 6);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** { r, g, b } (0-255) → { h, s, l } (h: 0-360, s/l: 0-100) */
function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** { r, g, b } (0-255) → { L, a, b } in CIELAB space */
function rgbToLab({ r, g, b }) {
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175;
  let z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

/** CIE76 deltaE between two Lab colors */
function deltaE(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1.L - lab2.L, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2),
  );
}

/** Minimum angular hue distance (0-180) */
function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

// ─── Pre-compute Tailwind Lab values ────────────────────────────────────────

const NEUTRAL_FAMILIES = ["slate", "gray", "zinc", "neutral", "stone"];

const TAILWIND_LAB_CACHE = {};
for (const [name, hex] of Object.entries(TAILWIND_COLORS)) {
  const rgb = parseHex(hex);
  TAILWIND_LAB_CACHE[name] = {
    hex,
    rgb,
    lab: rgbToLab(rgb),
    hsl: rgbToHsl(rgb),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Match a hex color to the nearest Tailwind color family using CIELAB deltaE.
 *
 * @param {string} hex - Hex color string (e.g. "#3B82F6")
 * @returns {{ family: string, deltaE: number }}
 */
function matchTailwindFamily(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return { family: "gray", deltaE: Infinity };
  const lab = rgbToLab(rgb);

  let bestFamily = "gray";
  let bestDelta = Infinity;

  for (const [name, cached] of Object.entries(TAILWIND_LAB_CACHE)) {
    const d = deltaE(lab, cached.lab);
    if (d < bestDelta) {
      bestDelta = d;
      bestFamily = name;
    }
  }

  return { family: bestFamily, deltaE: Math.round(bestDelta * 100) / 100 };
}

/**
 * Assign roles (primary, secondary, tertiary, neutral) to extracted palette colors.
 *
 * Algorithm:
 * 1. Sort by confidence * saturation (descending)
 * 2. Primary = most prominent chromatic color
 * 3. Secondary = max minimum hue distance from primary
 * 4. Tertiary = max minimum hue distance from primary + secondary
 * 5. Neutral = least saturated, or generated from primary if not available
 *
 * @param {Array<{hex, rgb?, hsl?, confidence, sources?, isNeutral?}>} palette
 * @returns {{ primary: string, secondary: string, tertiary: string, neutral: string }}
 *          Each value is a hex string.
 */
function assignRoles(palette) {
  if (!palette || palette.length === 0) {
    return {
      primary: "#6b7280",
      secondary: "#3b82f6",
      tertiary: "#6366f1",
      neutral: "#64748b",
    };
  }

  // Validate and filter palette entries — each must have hex and confidence
  const validPalette = palette.filter((c) => {
    if (!c || typeof c !== "object") {
      console.warn("[paletteToThemeMapper] Skipping non-object palette entry");
      return false;
    }
    if (!c.hex || typeof c.hex !== "string") {
      console.warn(
        "[paletteToThemeMapper] Skipping palette entry with missing hex",
      );
      return false;
    }
    if (c.confidence == null || typeof c.confidence !== "number") {
      console.warn(
        `[paletteToThemeMapper] Skipping palette entry "${c.hex}" with missing confidence`,
      );
      return false;
    }
    return true;
  });

  if (validPalette.length === 0) {
    return {
      primary: "#6b7280",
      secondary: "#3b82f6",
      tertiary: "#6366f1",
      neutral: "#64748b",
    };
  }

  // Ensure all entries have hsl
  const colors = validPalette.map((c) => {
    const rgb = c.rgb || parseHex(c.hex);
    const hsl = c.hsl || (rgb ? rgbToHsl(rgb) : { h: 0, s: 0, l: 50 });
    return { ...c, rgb, hsl };
  });

  // Separate chromatic from neutral candidates
  const chromatic = colors.filter(
    (c) => !c.isNeutral && c.hsl.s > 10 && c.hsl.l > 5 && c.hsl.l < 95,
  );
  const neutralCandidates = colors.filter(
    (c) => c.isNeutral || c.hsl.s <= 10 || c.hsl.l <= 5 || c.hsl.l >= 95,
  );

  // Sort chromatic by confidence * saturation
  chromatic.sort(
    (a, b) => b.confidence * (b.hsl.s / 100) - a.confidence * (a.hsl.s / 100),
  );

  // Assign primary
  const primary = chromatic.length > 0 ? chromatic[0] : colors[0];
  const assigned = [primary];

  // Assign secondary: max minimum hue distance from primary
  const remaining = chromatic.filter((c) => c !== primary);
  let secondary;
  if (remaining.length > 0) {
    secondary = remaining.reduce((best, c) => {
      const dist = hueDistance(c.hsl.h, primary.hsl.h);
      const bestDist = hueDistance(best.hsl.h, primary.hsl.h);
      return dist > bestDist ? c : best;
    }, remaining[0]);
  } else {
    // Generate analogous from primary
    secondary = {
      ...primary,
      hsl: { ...primary.hsl, h: (primary.hsl.h + 180) % 360 },
    };
  }
  assigned.push(secondary);

  // Assign tertiary: max minimum hue distance from both assigned
  const remaining2 = remaining.filter((c) => c !== secondary);
  let tertiary;
  if (remaining2.length > 0) {
    tertiary = remaining2.reduce((best, c) => {
      const minDist = Math.min(
        ...assigned.map((a) => hueDistance(c.hsl.h, a.hsl.h)),
      );
      const bestMinDist = Math.min(
        ...assigned.map((a) => hueDistance(best.hsl.h, a.hsl.h)),
      );
      return minDist > bestMinDist ? c : best;
    }, remaining2[0]);
  } else {
    // Generate from primary at +60 degrees
    tertiary = {
      ...primary,
      hsl: { ...primary.hsl, h: (primary.hsl.h + 60) % 360 },
    };
  }

  // Assign neutral: from neutral candidates, or lowest saturation chromatic, or generate
  let neutral;
  if (neutralCandidates.length > 0) {
    neutral = neutralCandidates[0];
  } else {
    // Use the least saturated remaining color
    const allRemaining = colors.filter(
      (c) => c !== primary && c !== secondary && c !== tertiary,
    );
    if (allRemaining.length > 0) {
      neutral = allRemaining.reduce((best, c) =>
        c.hsl.s < best.hsl.s ? c : best,
      );
    } else {
      neutral = { hex: "#64748b", hsl: { h: 215, s: 16, l: 47 } };
    }
  }

  return {
    primary: primary.hex,
    secondary: secondary.hex,
    tertiary: tertiary.hex,
    neutral: neutral.hex,
  };
}

/**
 * Generate a complete theme object from an extracted palette.
 *
 * Takes the raw palette from themeFromUrlController.extractColorsFromUrl(),
 * assigns color roles, maps to Tailwind families, and returns a raw theme
 * object ready for ThemeModel processing.
 *
 * @param {Array<{hex, rgb?, hsl?, confidence, sources?, isNeutral?}>} palette
 * @param {Object} [overrides] - Optional role overrides { primary?, secondary?, tertiary?, neutral? } as hex strings
 * @returns {{ theme: Object, roleAssignments: Object, familyMatches: Object }}
 */
function generateThemeFromPalette(palette, overrides = {}) {
  // Step 1: Assign roles
  const roles = assignRoles(palette);

  // Apply any user overrides (validate hex format)
  for (const role of ["primary", "secondary", "tertiary", "neutral"]) {
    if (overrides[role]) {
      if (VALID_HEX_RE.test(overrides[role])) {
        roles[role] = overrides[role];
      } else {
        console.warn(
          `[paletteToThemeMapper] Skipping invalid override for ${role}: "${overrides[role]}"`,
        );
      }
    }
  }

  // Step 2: Match each role to nearest Tailwind family
  const primaryMatch = matchTailwindFamily(roles.primary);
  const secondaryMatch = matchTailwindFamily(roles.secondary);
  const tertiaryMatch = matchTailwindFamily(roles.tertiary);
  const neutralMatch = matchTailwindFamily(roles.neutral);

  // For neutral, prefer a neutral family if the match is chromatic and close enough
  let neutralFamily = neutralMatch.family;
  if (!NEUTRAL_FAMILIES.includes(neutralFamily)) {
    // Check if there's a neutral family within reasonable distance
    const neutralRgb = parseHex(roles.neutral);
    if (neutralRgb) {
      const neutralHsl = rgbToHsl(neutralRgb);
      if (neutralHsl.s < 20) {
        // Low saturation — force to nearest neutral family
        const neutralLab = rgbToLab(neutralRgb);
        let bestNeutral = "slate";
        let bestDelta = Infinity;
        for (const nf of NEUTRAL_FAMILIES) {
          const d = deltaE(neutralLab, TAILWIND_LAB_CACHE[nf].lab);
          if (d < bestDelta) {
            bestDelta = d;
            bestNeutral = nf;
          }
        }
        neutralFamily = bestNeutral;
      }
    }
  }

  // Step 3: Generate theme name from families
  const themeName = generateThemeName(
    primaryMatch.family,
    secondaryMatch.family,
  );

  // Step 4: Build raw theme object (compatible with ThemeModel)
  const theme = {
    id: `theme-url-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: themeName,
    primary: primaryMatch.family,
    secondary: secondaryMatch.family,
    tertiary: tertiaryMatch.family,
    neutral: neutralFamily,
    dark: {},
    light: {},
  };

  const familyMatches = {
    primary: {
      hex: roles.primary,
      family: primaryMatch.family,
      deltaE: primaryMatch.deltaE,
    },
    secondary: {
      hex: roles.secondary,
      family: secondaryMatch.family,
      deltaE: secondaryMatch.deltaE,
    },
    tertiary: {
      hex: roles.tertiary,
      family: tertiaryMatch.family,
      deltaE: tertiaryMatch.deltaE,
    },
    neutral: {
      hex: roles.neutral,
      family: neutralFamily,
      deltaE: neutralMatch.deltaE,
    },
  };

  return {
    theme,
    roleAssignments: roles,
    familyMatches,
  };
}

const paletteToThemeMapper = {
  assignRoles,
  matchTailwindFamily,
  generateThemeFromPalette,
};

module.exports = paletteToThemeMapper;
