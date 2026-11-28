/**
 * botPanelWidth.js — how wide the team diagram's selected-bot panel is
 * (DASH-171). It shows a bot's details, so it gets its own default: about a
 * third of the window, kept between PANEL_DEFAULT_MIN and PANEL_DEFAULT_MAX.
 * The user drags its left edge to change it; the width is remembered under
 * BOT_PANEL_WIDTH_KEY (its own key: the notifications sidebar and the bot
 * page beside the diagram keep theirs). The diagram always keeps
 * DIAGRAM_MIN.
 *
 * Pure: no React.
 */

export const BOT_PANEL_WIDTH_KEY = "dash:teamChart:botPanelWidth";
export const PANEL_MIN = 360;
export const PANEL_DEFAULT_MIN = 480;
export const PANEL_DEFAULT_MAX = 600;
export const DIAGRAM_MIN = 320;

/** About a third of the window, 480–600px. */
export function defaultBotPanelWidth(windowWidth) {
  const w = Number(windowWidth);
  if (!Number.isFinite(w) || w <= 0) return PANEL_DEFAULT_MIN;
  return Math.min(
    PANEL_DEFAULT_MAX,
    Math.max(PANEL_DEFAULT_MIN, Math.round(w / 3)),
  );
}

/**
 * The widest the panel may be beside a diagram `rootWidth` px wide (the
 * diagram keeps DIAGRAM_MIN). Not measured yet (0): the default's top.
 */
export function maxBotPanelWidth(rootWidth) {
  const w = Number(rootWidth);
  if (!Number.isFinite(w) || w <= 0) return PANEL_DEFAULT_MAX;
  return Math.max(PANEL_MIN, w - DIAGRAM_MIN);
}

/** The panel's starting width: the default, as far as the room allows. */
export function startBotPanelWidth(windowWidth, rootWidth) {
  return Math.min(
    defaultBotPanelWidth(windowWidth),
    maxBotPanelWidth(rootWidth),
  );
}
