/**
 * themeGenerator.js
 *
 * Utility for generating themes via presets, random generation,
 * and color-harmony-based generation from a user-selected base color.
 */
// All color math is inlined here (no @trops/dash-react import). This
// file is reachable from Electron's main process via
// `electron/controller/paletteToThemeMapper.js`. Importing dash-react
// from a main-process reachable file pulls dash-react's renderer
// bundle into the main bundle — that bundle has top-level browser
// API access (`window.ResizeObserver` in CodeEditorVS) which throws
// when required under Node. Keeping this module pure-JS / no-deps
// breaks the chain.

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function isHexColor(value) {
  return typeof value === "string" && HEX_RE.test(value.trim());
}
function normalizeHex(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s.startsWith("#")) s = `#${s}`;
  if (!HEX_RE.test(s)) return null;
  if (s.length === 4) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  else if (s.length === 5) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  else if (s.length === 9) s = s.slice(0, 7);
  return s;
}
function hexToRgb(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  const v = parseInt(n.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}
function rgbToHex({ r, g, b }) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const h = (x) => c(x).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgbToHsl({ r, g, b }) {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R:
        h = (G - B) / d + (G < B ? 6 : 0);
        break;
      case G:
        h = (B - R) / d + 2;
        break;
      default:
        h = (R - G) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp, gp, bp;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

// Color harmony helpers — pure JS, no DOM/window access.
function rotateHex(hex, deltaH) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);
  const newH = (((h + deltaH) % 360) + 360) % 360;
  return rgbToHex(hslToRgb({ h: newH, s, l }));
}
function complementHex(hex) {
  return rotateHex(hex, 180);
}
function analogousHexes(hex) {
  const a = rotateHex(hex, -30);
  const b = rotateHex(hex, 30);
  return a && b ? [a, b] : null;
}
function triadicHexes(hex) {
  const a = rotateHex(hex, 120);
  const b = rotateHex(hex, 240);
  return a && b ? [a, b] : null;
}
function splitComplementaryHexes(hex) {
  const a = rotateHex(hex, 150);
  const b = rotateHex(hex, 210);
  return a && b ? [a, b] : null;
}
function tetradicHexes(hex) {
  const a = rotateHex(hex, 90);
  const b = rotateHex(hex, 180);
  const c = rotateHex(hex, 270);
  return a && b && c ? [a, b, c] : null;
}
function monochromaticHexes(hex, count = 3) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(rgb);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const l = 0.15 + t * 0.7;
    const sAdj = s * (1 - 0.3 * Math.abs(t - 0.5) * 2);
    out.push(rgbToHex(hslToRgb({ h, s: sAdj, l })));
  }
  return out;
}
function adjustHsl(hex, dH = 0, dS = 0, dL = 0) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const h = (((hsl.h + dH) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, hsl.s + dS));
  const l = Math.max(0, Math.min(1, hsl.l + dL));
  return rgbToHex(hslToRgb({ h, s, l }));
}

// Color wheel mapping for Tailwind palettes (approximate hue angles)
const COLOR_WHEEL = {
  red: 0,
  orange: 30,
  amber: 45,
  yellow: 60,
  lime: 90,
  green: 120,
  emerald: 150,
  teal: 180,
  cyan: 195,
  sky: 210,
  blue: 240,
  indigo: 260,
  violet: 275,
  purple: 285,
  fuchsia: 300,
  pink: 330,
  rose: 350,
};

const NEUTRAL_COLORS = ["gray", "slate", "zinc", "neutral", "stone"];

const CHROMATIC_COLORS = Object.keys(COLOR_WHEEL);

/**
 * Find the nearest Tailwind color name for a given hue angle.
 */
function nearestColor(hue) {
  const normalized = ((hue % 360) + 360) % 360;
  let best = CHROMATIC_COLORS[0];
  let bestDist = 360;

  for (const [name, h] of Object.entries(COLOR_WHEEL)) {
    const dist = Math.min(
      Math.abs(normalized - h),
      360 - Math.abs(normalized - h),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

/**
 * Pick a random element from an array.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a fun theme name based on color families.
 */
export function generateThemeName(primary, secondary) {
  const adjectives = {
    red: "Crimson",
    orange: "Sunset",
    amber: "Golden",
    yellow: "Sunlit",
    lime: "Vivid",
    green: "Forest",
    emerald: "Jade",
    teal: "Lagoon",
    cyan: "Arctic",
    sky: "Horizon",
    blue: "Ocean",
    indigo: "Midnight",
    violet: "Twilight",
    purple: "Royal",
    fuchsia: "Neon",
    pink: "Blossom",
    rose: "Rosy",
    gray: "Steel",
    slate: "Shadow",
    zinc: "Iron",
    neutral: "Stone",
    stone: "Earth",
  };

  const nouns = {
    red: "Ember",
    orange: "Blaze",
    amber: "Glow",
    yellow: "Ray",
    lime: "Spark",
    green: "Canopy",
    emerald: "Grove",
    teal: "Reef",
    cyan: "Frost",
    sky: "Breeze",
    blue: "Depth",
    indigo: "Night",
    violet: "Dusk",
    purple: "Amethyst",
    fuchsia: "Flash",
    pink: "Petal",
    rose: "Dawn",
    gray: "Mist",
    slate: "Cloud",
    zinc: "Storm",
    neutral: "Haven",
    stone: "Ridge",
  };

  const adj = adjectives[primary] || "Custom";
  const noun = nouns[secondary] || "Theme";

  return `${adj} ${noun}`;
}

/**
 * Build a raw theme object from color selections.
 */
function buildRawTheme(name, primary, secondary, tertiary, neutral) {
  return {
    id: `theme-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name,
    primary,
    secondary,
    tertiary,
    neutral,
    dark: {},
    light: {},
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────

export function getThemePresets() {
  return [
    buildRawTheme("Ocean Depth", "blue", "cyan", "teal", "slate"),
    buildRawTheme("Sunset Ember", "orange", "rose", "amber", "stone"),
    buildRawTheme("Forest Canopy", "green", "emerald", "lime", "gray"),
    buildRawTheme("Arctic Night", "slate", "sky", "indigo", "zinc"),
    buildRawTheme("Royal Amethyst", "purple", "violet", "fuchsia", "gray"),
    buildRawTheme("Warm Earth", "stone", "amber", "orange", "neutral"),
    buildRawTheme("Cyber Pulse", "cyan", "blue", "violet", "slate"),
    buildRawTheme("Rose Garden", "rose", "pink", "fuchsia", "gray"),
    buildRawTheme("Golden Hour", "amber", "yellow", "orange", "stone"),
    buildRawTheme("Midnight Sky", "indigo", "blue", "violet", "slate"),
    buildRawTheme("Spring Meadow", "emerald", "lime", "green", "gray"),
    buildRawTheme("Coral Reef", "red", "orange", "pink", "zinc"),
    buildRawTheme("Nordic Ice", "sky", "cyan", "blue", "slate"),
    buildRawTheme("Twilight Bloom", "violet", "purple", "pink", "gray"),
    buildRawTheme("Desert Sand", "amber", "orange", "stone", "neutral"),
  ];
}

/**
 * Brand presets — curated hex palettes mirroring well-known
 * products. Surfaced in the theme picker so users can pick
 * familiar brand identities in one click. Hex values flow
 * through the arbitrary-color-themes pipeline (PRD US-006).
 *
 * Each preset spans all four channels (primary, secondary,
 * tertiary, neutral). When applied, every theme token resolves
 * to a brand-equivalent shade via the cssVars map.
 */
export function getBrandPresets() {
  return [
    buildRawTheme("Slack Brand", "#4A154B", "#36C5F0", "#ECB22E", "#BCBEC0"),
    buildRawTheme("Notion Brand", "#2F3437", "#9B6A8C", "#D4845A", "#C1B5A7"),
    buildRawTheme("GitHub Brand", "#0D1117", "#58A6FF", "#F0883E", "#21262D"),
    buildRawTheme("Stripe Brand", "#635BFF", "#00D4FF", "#FFD600", "#525F7F"),
    buildRawTheme("Linear Brand", "#5E6AD2", "#B07FD0", "#E2A8F5", "#1F2026"),
    buildRawTheme("Discord Brand", "#5865F2", "#57F287", "#FEE75C", "#36393F"),
    buildRawTheme("Vercel Brand", "#000000", "#0070F3", "#FF0080", "#888888"),
    buildRawTheme("Figma Brand", "#F24E1E", "#A259FF", "#1ABCFE", "#2C2C2C"),
  ];
}

// ─── Random Generation ───────────────────────────────────────────────────

export function generateRandomTheme() {
  const primary = pick(CHROMATIC_COLORS);
  const primaryHue = COLOR_WHEEL[primary];

  // Complementary for secondary
  const secondaryHue = (primaryHue + 180) % 360;
  const secondary = nearestColor(secondaryHue);

  // Analogous for tertiary
  const offset = pick([30, -30, 60, -60]);
  const tertiaryHue = (primaryHue + offset) % 360;
  const tertiary = nearestColor(tertiaryHue);

  const neutral = pick(NEUTRAL_COLORS);
  const name = generateThemeName(primary, secondary);

  return buildRawTheme(name, primary, secondary, tertiary, neutral);
}

// ─── Color Harmony Generation ────────────────────────────────────────────

/**
 * Generate a theme using color harmony rules from a base color.
 * Accepts either a Tailwind color name OR a hex string. Hex bases
 * run through dash-react's harmony math and emit hex channels for
 * every output; named bases use the legacy COLOR_WHEEL mapping.
 *
 * @param {string} baseColor - Tailwind color name (e.g. "blue") OR hex
 * @param {"complementary"|"analogous"|"triadic"|"split-complementary"|"tetradic"|"monochromatic"} strategy
 * @param {{ dH?: number, dS?: number, dL?: number }} [hslNudge] - optional
 *   HSL offsets applied to every generated channel after the harmony
 *   math. dH in degrees; dS/dL as fractions in [-1..1].
 */
export function generateHarmonyTheme(
  baseColor,
  strategy = "complementary",
  hslNudge = null,
) {
  if (typeof baseColor === "string" && isHexColor(baseColor)) {
    return generateHexHarmonyTheme(baseColor, strategy, hslNudge);
  }

  const baseHue = COLOR_WHEEL[baseColor];
  if (baseHue === undefined) {
    return generateRandomTheme();
  }

  let secondaryHue, tertiaryHue;

  switch (strategy) {
    case "complementary":
      secondaryHue = (baseHue + 180) % 360;
      tertiaryHue = (baseHue + 30) % 360;
      break;
    case "analogous":
      secondaryHue = (baseHue + 30) % 360;
      tertiaryHue = (baseHue + 60) % 360;
      break;
    case "triadic":
      secondaryHue = (baseHue + 120) % 360;
      tertiaryHue = (baseHue + 240) % 360;
      break;
    case "split-complementary":
      secondaryHue = (baseHue + 150) % 360;
      tertiaryHue = (baseHue + 210) % 360;
      break;
    default:
      secondaryHue = (baseHue + 180) % 360;
      tertiaryHue = (baseHue + 30) % 360;
  }

  const primary = baseColor;
  const secondary = nearestColor(secondaryHue);
  const tertiary = nearestColor(tertiaryHue);
  const neutral = pick(NEUTRAL_COLORS);
  const name = generateThemeName(primary, secondary);

  return buildRawTheme(name, primary, secondary, tertiary, neutral);
}

/**
 * Hex-mode harmony generation. Always emits hex channels; supports
 * all the named harmony strategies plus Monochromatic and Tetradic.
 * The neutral channel is derived from the base by desaturating
 * almost fully, keeping the same hue family for a cohesive feel.
 */
function generateHexHarmonyTheme(baseHex, strategy, hslNudge) {
  const base = normalizeHex(baseHex);
  if (!base) return generateRandomTheme();

  let primary = base;
  let secondary;
  let tertiary;
  let neutral;

  switch (strategy) {
    case "complementary": {
      secondary = complementHex(base);
      const ana = analogousHexes(base);
      tertiary = ana ? ana[1] : base;
      break;
    }
    case "analogous": {
      const ana = analogousHexes(base);
      if (ana) {
        secondary = ana[0];
        tertiary = ana[1];
      }
      break;
    }
    case "triadic": {
      const tri = triadicHexes(base);
      if (tri) {
        secondary = tri[0];
        tertiary = tri[1];
      }
      break;
    }
    case "split-complementary": {
      const split = splitComplementaryHexes(base);
      if (split) {
        secondary = split[0];
        tertiary = split[1];
      }
      break;
    }
    case "tetradic": {
      const tet = tetradicHexes(base);
      if (tet) {
        secondary = tet[0];
        tertiary = tet[1];
        neutral = tet[2];
      }
      break;
    }
    case "monochromatic": {
      const mono = monochromaticHexes(base, 3);
      if (mono) {
        primary = mono[1];
        secondary = mono[0];
        tertiary = mono[2];
      }
      break;
    }
    default: {
      secondary = complementHex(base);
      const ana = analogousHexes(base);
      tertiary = ana ? ana[1] : base;
    }
  }

  // Neutral defaults to a near-grey of the same hue (desaturated).
  if (!neutral) {
    neutral = adjustHsl(base, 0, -0.85, 0);
  }

  // Apply optional HSL nudge uniformly to all channels.
  if (hslNudge) {
    const { dH = 0, dS = 0, dL = 0 } = hslNudge;
    primary = adjustHsl(primary, dH, dS, dL) || primary;
    secondary = adjustHsl(secondary, dH, dS, dL) || secondary;
    tertiary = adjustHsl(tertiary, dH, dS, dL) || tertiary;
    neutral = adjustHsl(neutral, dH, dS, dL) || neutral;
  }

  const name = generateThemeName(primary, secondary);
  return buildRawTheme(name, primary, secondary, tertiary, neutral);
}

/**
 * Generate a theme from four independently chosen channel values.
 * Each channel may be a Tailwind name or a hex string.
 */
export function generateCustomTheme(
  primary,
  secondary,
  tertiary,
  neutral = null,
) {
  const resolvedNeutral = neutral || pick(NEUTRAL_COLORS);
  const name = generateThemeName(primary, secondary);
  return buildRawTheme(name, primary, secondary, tertiary, resolvedNeutral);
}

/**
 * All available chromatic colors for the "From Color" picker.
 */
export const AVAILABLE_COLORS = CHROMATIC_COLORS;

/**
 * Available harmony strategies for the "From Color" picker.
 */
export const HARMONY_STRATEGIES = [
  { value: "complementary", label: "Complementary" },
  { value: "analogous", label: "Analogous" },
  { value: "triadic", label: "Triadic" },
  { value: "split-complementary", label: "Split Complementary" },
  { value: "tetradic", label: "Tetradic" },
  { value: "monochromatic", label: "Monochromatic" },
  { value: "custom", label: "Custom" },
];
