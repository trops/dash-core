/**
 * themeFromPrompt.js — Type: Theme (create-entry PRD CRE-001 AC3, phase 5c):
 * a theme from a description. The AI picks a name and four colors; Dash
 * builds the theme the same way the theme editor's own generators do, and
 * the editor opens with it — nothing is saved until the user saves.
 */
import { aiOnce, firstJson } from "../../utils/aiOnce";
import { generateCustomTheme } from "../../utils/themeGenerator";

export const THEME_SYSTEM = `You design color themes for Dash, a desktop dashboard app with a dark and a light mode. From the user's description, answer with JSON only:
{"name": "<2-3 word theme name>", "primary": "#rrggbb", "secondary": "#rrggbb", "tertiary": "#rrggbb", "neutral": "#rrggbb"}
- primary: the main accent (buttons, highlights).
- secondary and tertiary: supporting accents that go with it.
- neutral: a low-saturation gray-ish color for backgrounds and borders.
Pick colors that read well on both dark and light backgrounds.`;

const HEX = /^#[0-9a-f]{6}$/i;
const CHANNELS = ["primary", "secondary", "tertiary", "neutral"];

/** A raw theme from the AI's answer, or null when it isn't usable. */
export function parseThemeAnswer(text) {
  const j = firstJson(text);
  if (!j) return null;
  const colors = {};
  for (const c of CHANNELS) {
    const v = String(j[c] || "").trim();
    if (!HEX.test(v)) return null;
    colors[c] = v.toLowerCase();
  }
  const theme = generateCustomTheme(
    colors.primary,
    colors.secondary,
    colors.tertiary,
    colors.neutral,
  );
  const name = String(j.name || "")
    .trim()
    .slice(0, 40);
  if (name) theme.name = name;
  return theme;
}

/**
 * @param {string} prompt
 * @param {{ backend, providers, ask? }} opts
 * @returns {Promise<object>} a raw theme (unsaved); rejects with a plain message
 */
export async function themeFromPrompt(
  prompt,
  { backend, providers, ask = aiOnce } = {},
) {
  const answer = await ask({
    system: THEME_SYSTEM,
    prompt: String(prompt || ""),
    backend,
    providers,
  });
  const theme = parseThemeAnswer(answer);
  if (!theme) throw new Error("The AI's colors couldn't be used.");
  return theme;
}
