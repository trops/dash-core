/**
 * New theme — the pure parts of the window (theme round "New theme",
 * canvas page "New theme (proposed)"): the ways to start, the four colors
 * and what each is for, what is still missing before Create, and the theme
 * that gets saved.
 */
import { isHexColor } from "@trops/dash-react";
import { STRENGTHS, DEFAULT_STRENGTH } from "../../../utils/auroraTokens";

/** Step 1 — how to start. */
export const STARTS = [
  {
    value: "preset",
    label: "A preset",
    sub: "Ready-made colors",
    icon: "swatchbook",
  },
  {
    value: "color",
    label: "One color",
    sub: "Pick a color; Dash finds the rest",
    icon: "droplet",
  },
  {
    value: "random",
    label: "Surprise me",
    sub: "Random colors you can shuffle",
    icon: "shuffle",
  },
  {
    value: "website",
    label: "A website",
    sub: "Use a site's colors",
    icon: "globe",
  },
  {
    value: "registry",
    label: "The registry",
    sub: "Themes others made",
    icon: "download",
  },
];

/** Step 2 title per start. */
export const COLORS_TITLE = {
  preset: "Pick a preset",
  color: "Pick a color",
  random: "Your colors",
  website: "Colors from a website",
  registry: "Pick a theme",
};

/** One color: how the other colors go with it (harmony, in plain words). */
export const GO_WITH = [
  { value: "analogous", label: "Close to it" },
  { value: "complementary", label: "Contrasting" },
  { value: "triadic", label: "Three-way" },
];

/** The four colors every way ends in, named for what they do. */
export const COLOR_ROLES = [
  { key: "primary", name: "Main", use: "Buttons, links" },
  { key: "secondary", name: "Second", use: "Tags, charts" },
  { key: "tertiary", name: "Highlight", use: "Badges, accents" },
  { key: "neutral", name: "Greys", use: "Text, lines" },
];

/** Colors to start from (One color). */
export const BASE_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

/** Names read out for the colors above. */
export const BASE_COLOR_NAMES = {
  "#ef4444": "red",
  "#f97316": "orange",
  "#f59e0b": "amber",
  "#eab308": "yellow",
  "#84cc16": "lime",
  "#22c55e": "green",
  "#10b981": "emerald",
  "#14b8a6": "teal",
  "#06b6d4": "cyan",
  "#0ea5e9": "sky",
  "#3b82f6": "blue",
  "#6366f1": "indigo",
  "#8b5cf6": "violet",
  "#a855f7": "purple",
  "#d946ef": "fuchsia",
  "#ec4899": "pink",
  "#6b7280": "grey",
  "#64748b": "slate grey",
  "#71717a": "zinc grey",
  "#737373": "neutral grey",
  "#78716c": "stone grey",
};

/** Greys for the Greys color. */
export const GREY_COLORS = [
  "#6b7280",
  "#64748b",
  "#71717a",
  "#737373",
  "#78716c",
];

/** "#8b5cf6", "8B5CF6" → "#8b5cf6"; anything else → null. */
export function hexOrNull(text) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(text || "").trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** "https://www.example-coffee.com/menu" → "Example Coffee". */
export function siteName(address) {
  let host = "";
  try {
    host = new URL(/^\w+:\/\//.test(address) ? address : `https://${address}`)
      .hostname;
  } catch (err) {
    return "";
  }
  const parts = host.replace(/^www\./, "").split(".");
  const core = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
  return core
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const STRENGTH_HELP = {
  subtle: "A hint of color. Closest to plain dark and light.",
  balanced:
    "Backgrounds and cards take some color. Most themes look best here.",
  bold: "The most color. Cards still stand apart and text stays readable.",
};

const GREY_NAMES = ["gray", "slate", "zinc", "neutral", "stone"];

function saturationOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** Is this channel value a grey (a grey family, or a near-grey hex)? */
export function isGrey(value) {
  if (typeof value !== "string") return false;
  if (GREY_NAMES.includes(value)) return true;
  return isHexColor(value) && saturationOf(value) < 0.3;
}

/** Surprise me: greys stay grey — a colourful "neutral" becomes slate. */
export function keepGreysGrey(colors) {
  if (!colors || isGrey(colors.neutral)) return colors;
  return { ...colors, neutral: "slate" };
}

/** The four channels of any theme-like object (preset, generated, package). */
export function colorsOf(source) {
  if (!source) return null;
  const c = source.colors && source.colors.primary ? source.colors : source;
  if (!c.primary) return null;
  return {
    primary: c.primary,
    secondary: c.secondary || c.primary,
    tertiary: c.tertiary || c.secondary || c.primary,
    neutral: c.neutral || "gray",
  };
}

/** A registry search result as a start: its colors, name, strength, credit. */
export function fromRegistry(pkg) {
  if (!pkg) return null;
  const scope = (pkg.scope || "").replace(/^@/, "");
  return {
    colors: colorsOf(pkg),
    name: pkg.displayName || pkg.name || "",
    strength: STRENGTHS.includes(pkg.strength) ? pkg.strength : null,
    remixedFrom: pkg.name
      ? {
          package: scope ? `${scope}/${pkg.name}` : pkg.name,
          version: pkg.version || null,
        }
      : null,
  };
}

/** Why Create theme is off, or null when it can be made. */
export function createProblem({ colors, name }) {
  if (!colorsOf(colors)) {
    return "Pick the colors first.";
  }
  if (!name || !name.trim()) return "Give it a name to create it.";
  return null;
}

/** The theme that gets saved. */
export function buildNewTheme({
  key,
  colors,
  name,
  strength,
  remixedFrom = null,
}) {
  const c = colorsOf(colors);
  return {
    id: key,
    name: name.trim(),
    ...c,
    strength: STRENGTHS.includes(strength) ? strength : DEFAULT_STRENGTH,
    ...(remixedFrom ? { remixedFrom } : {}),
    dark: {},
    light: {},
  };
}

/** A key no other theme has. */
export function newThemeKey(themes = {}, now = Date.now()) {
  let key = `theme-${now}`;
  let i = 2;
  while (themes && themes[key]) key = `theme-${now}-${i++}`;
  return key;
}
