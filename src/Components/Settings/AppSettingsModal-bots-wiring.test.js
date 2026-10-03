/**
 * Static wiring pin: the Bots section is the Bots Manage page (it moved out
 * of AppSettingsModal — app-navigation NAV-004): AppPage renders it with a
 * "New Bot" action. Mirrors the source-presence style used by
 * AppSettingsModal-create-with-type.test.js.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "AppPages", "AppPage.js"),
  "utf8",
);

describe("Bots page — Bots section wiring", () => {
  it("imports BotsSection", () => {
    expect(src).toMatch(
      /import \{ BotsSection \} from "\.\.\/Settings\/sections\/BotsSection"/,
    );
  });

  it('has a "New Bot" action and renders BotsSection', () => {
    expect(src).toMatch(/bots: "New Bot"/);
    expect(src).toMatch(/<BotsSection/);
  });

  it("passes the dashboards to BotsSection (for the event picker)", () => {
    expect(src).toMatch(/<BotsSection[^>]*workspaces=\{workspaces\}/);
  });
});

describe("BotsSection — event picker wiring", () => {
  const sectionSrc = fs.readFileSync(
    path.join(__dirname, "sections", "BotsSection.js"),
    "utf8",
  );

  it("hands BotDetail the dashboards and the widget-config lookup", () => {
    const details = sectionSrc.match(/<BotDetail[\s\S]*?\/>/g) || [];
    expect(details.length).toBe(2); // create + edit
    for (const d of details) {
      expect(d).toMatch(/workspaces=\{workspaces\}/);
      expect(d).toMatch(/getWidgetConfig=\{getWidgetConfig\}/);
      // Other bots' events (From: Another bot).
      expect(d).toMatch(/bots=\{bots\}/);
    }
    expect(sectionSrc).toMatch(/ComponentManager\.config\(/);
  });
});
