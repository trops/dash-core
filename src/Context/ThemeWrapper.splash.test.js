/**
 * The loading splash paints no background of its own — the app's shows
 * through, so the screen is one colour while Dash loads (a fill of its own
 * showed as a mismatched block when part of it repainted late).
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "ThemeWrapper.js"), "utf8");

describe("ThemeWrapper splash", () => {
  it("has no background fill of its own", () => {
    const splash = src.slice(src.indexOf("if (!chosenTheme || !splashDone)"));
    const outer = splash.match(/<div className="([^"]*)">/);
    expect(outer).not.toBeNull();
    expect(outer[1]).toBe("flex items-center justify-center w-screen h-screen");
    expect(outer[1]).not.toMatch(/\bbg-/);
  });
});
