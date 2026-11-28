import {
  DIAGRAM_MIN,
  PANEL_DEFAULT_MAX,
  PANEL_DEFAULT_MIN,
  PANEL_MIN,
  defaultBotPanelWidth,
  maxBotPanelWidth,
  startBotPanelWidth,
} from "./botPanelWidth";

describe("botPanelWidth (DASH-171)", () => {
  it("defaults to about a third of the window, 480–600px", () => {
    expect(defaultBotPanelWidth(1600)).toBe(533);
    expect(defaultBotPanelWidth(1600)).toBeGreaterThanOrEqual(480);
    expect(defaultBotPanelWidth(1000)).toBe(PANEL_DEFAULT_MIN);
    expect(defaultBotPanelWidth(2560)).toBe(PANEL_DEFAULT_MAX);
    expect(defaultBotPanelWidth(undefined)).toBe(PANEL_DEFAULT_MIN);
  });

  it("leaves the diagram its minimum", () => {
    expect(maxBotPanelWidth(1200)).toBe(1200 - DIAGRAM_MIN);
    expect(maxBotPanelWidth(500)).toBe(PANEL_MIN);
    expect(maxBotPanelWidth(0)).toBe(PANEL_DEFAULT_MAX);
  });

  it("starts at the default, as far as the room allows", () => {
    expect(startBotPanelWidth(1600, 1300)).toBe(533);
    expect(startBotPanelWidth(1600, 800)).toBe(800 - DIAGRAM_MIN);
  });
});
