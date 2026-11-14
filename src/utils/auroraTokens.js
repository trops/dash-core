/**
 * auroraTokens — the Aurora design tokens for a theme, at its strength.
 *
 * Aurora keeps its look (dark/light base, glass panels, glow, spacing, text
 * colours); a theme colours it within limits:
 *   - its accent (the first colourful channel) drives buttons, selected
 *     states, focus rings, links and the background glow, in shades picked
 *     to read at 4.5:1;
 *   - backgrounds, cards, panels, chat and lines take a tint of its primary
 *     colour — how much is the theme's Strength (subtle / balanced / bold).
 *
 * ThemeModel adds these to each variant's cssVars, so the app theme sets
 * them on <html> and a dashboard's theme on its own wrapper — every
 * dash-react component (and widget) inside picks them up. Pure.
 */

export const STRENGTHS = ["subtle", "balanced", "bold"];
export const DEFAULT_STRENGTH = "balanced";

// Share of the theme's colour each surface takes (%), per mode and strength.
const MIX = {
  dark: {
    subtle: { bg: 10, chatShell: 10, chatStage: 5, surface: 6, hair: 6 },
    balanced: { bg: 20, chatShell: 18, chatStage: 9, surface: 13, hair: 12 },
    bold: { bg: 36, chatShell: 30, chatStage: 15, surface: 22, hair: 20 },
  },
  light: {
    subtle: { bg: 12, chatShell: 12, chatStage: 8, surface: 12, hair: 6 },
    balanced: { bg: 24, chatShell: 21, chatStage: 14, surface: 24, hair: 12 },
    bold: { bg: 42, chatShell: 36, chatStage: 24, surface: 39, hair: 20 },
  },
};

// Aurora's own base values (dash-react designSystem.css), mixed toward.
const BASE = {
  dark: {
    bg: "#0a0b10",
    chatShell: "#0d0e13",
    chatStage: "#1a1b22",
    raised: "rgba(23, 25, 34, 0.55)",
    solid: "#16181d",
    hairline: "rgba(255, 255, 255, 0.08)",
    hairlineStrong: "rgba(255, 255, 255, 0.14)",
  },
  light: {
    bg: "#f6f7fb",
    chatShell: "#ececf1",
    chatStage: "#ffffff",
    raised: "rgba(255, 255, 255, 0.7)",
    solid: "#ffffff",
    hairline: "rgba(16, 18, 24, 0.09)",
    hairlineStrong: "rgba(16, 18, 24, 0.16)",
  },
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function rgb(hex) {
  const s = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

function luminance(hex) {
  const c = rgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * A grey-ish colour (low saturation) — not used as the accent. Slate, the
 * bluest grey, measures 0.28; real colours are well above 0.5.
 */
function isNeutral(hex) {
  const c = rgb(hex);
  if (!c) return true;
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === 0) return true;
  return (max - min) / max < 0.3;
}

/**
 * The first shade (in order) that reads at 4.5:1 on every surface in `on`
 * (one colour or a list), else the last.
 */
function readable(pal, order, on) {
  const surfaces = Array.isArray(on) ? on : [on];
  const hit = order.find(
    (s) => pal[s] && surfaces.every((x) => contrast(pal[s], x) >= 4.5),
  );
  return pal[hit || order[order.length - 1]];
}

/** `pct`% of hex `a` mixed into hex `b` (sRGB), as hex — what color-mix shows. */
function mixHex(a, pct, b) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return b;
  const w = pct / 100;
  return (
    "#" +
    x
      .map((v, i) => Math.round(v * w + y[i] * (1 - w)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

const mix = (c, pct, base) => `color-mix(in srgb, ${c} ${pct}%, ${base})`;

/** A channel's shades as hex: { 50: "#…", …, 950: "#…" } (missing → null). */
export function paletteOf(shadeOf, channel) {
  const out = {};
  for (const s of SHADES) out[s] = shadeOf(channel, s) || null;
  return out[500] ? out : null;
}

/**
 * @param {{primary?: object, secondary?: object, tertiary?: object}} pals
 *   each a palette from paletteOf
 * @param {"dark"|"light"} mode
 * @param {string} strength subtle | balanced | bold (anything else: balanced)
 * @returns {Object<string,string>} CSS custom properties, or {} without a
 *   usable primary
 */
export function auroraTokens(pals, mode, strength) {
  const p = pals && pals.primary;
  if (!p) return {};
  const m = mode === "light" ? "light" : "dark";
  const k = MIX[m][STRENGTHS.includes(strength) ? strength : DEFAULT_STRENGTH];
  const base = BASE[m];
  // The accent: the first colourful channel (a grey primary leaves it to
  // secondary), else primary itself.
  const accentPal =
    [pals.primary, pals.secondary, pals.tertiary].find(
      (x) => x && !isNeutral(x[500]),
    ) || p;
  const second =
    [pals.secondary, pals.tertiary, pals.primary].find(
      (x) => x && x !== accentPal,
    ) || accentPal;
  const fill = readable(accentPal, [600, 700, 800, 900], "#ffffff");
  const dark = m === "dark";
  const accent = dark ? accentPal[400] : accentPal[500];
  const accent2 = dark ? second[400] : second[500];
  // Checked on the surfaces people actually see — tinted at this strength.
  const seen = [
    mixHex(dark ? p[900] : p[50], k.surface, base.solid),
    mixHex(dark ? p[950] : p[100], k.bg, base.bg),
    mixHex(dark ? p[900] : p[50], k.chatStage, base.chatStage),
  ];
  const accentText = dark
    ? readable(accentPal, [400, 300, 200, 100, 50], seen)
    : readable(accentPal, [600, 700, 800, 900, 950], seen);
  const glow = dark ? [18, 13, 9] : [14, 10, 7];
  const tokens = {
    "--bg": mix(dark ? p[950] : p[100], k.bg, base.bg),
    "--chat-shell": mix(dark ? p[950] : p[100], k.chatShell, base.chatShell),
    "--chat-stage": mix(dark ? p[900] : p[50], k.chatStage, base.chatStage),
    "--raised": mix(dark ? p[900] : p[50], k.surface, base.raised),
    "--solid": mix(dark ? p[900] : p[50], k.surface, base.solid),
    "--hairline": mix(dark ? p[300] : p[700], k.hair, base.hairline),
    "--hairline-strong": mix(
      dark ? p[300] : p[700],
      k.hair,
      base.hairlineStrong,
    ),
    "--accent": accent,
    "--accent-2": accent2,
    "--accent-soft": mix(accent, dark ? 16 : 14, "transparent"),
    "--accent-grad": `linear-gradient(135deg, ${fill}, ${fill})`,
    "--brand-grad": `linear-gradient(140deg, ${accent}, ${accent2})`,
    "--accent-glow": `0 4px 18px ${mix(accent, dark ? 35 : 30, "transparent")}`,
    "--focus-ring": accentText,
    "--accent-text": accentText,
    "--mesh": [
      `radial-gradient(520px 380px at 2% -12%, ${mix(accent, glow[0], "transparent")}, transparent 62%)`,
      `radial-gradient(560px 400px at 98% 4%, ${mix(accent2, glow[1], "transparent")}, transparent 60%)`,
      `radial-gradient(600px 520px at 60% 115%, ${mix(accent, glow[2], "transparent")}, transparent 60%)`,
    ].join(", "),
  };
  return tokens;
}
