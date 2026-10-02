/**
 * Static wiring pin: the Bots section is registered in AppSettingsModal
 * (sidebar entry, "New Bot" header button, and body render). Mirrors the
 * source-presence style used by AppSettingsModal-create-with-type.test.js.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "AppSettingsModal.js"),
  "utf8",
);

describe("AppSettingsModal — Bots section wiring", () => {
  it("imports BotsSection", () => {
    expect(src).toMatch(
      /import \{ BotsSection \} from "\.\/sections\/BotsSection"/,
    );
  });

  it("registers a bots sidebar entry", () => {
    expect(src).toMatch(/key: "bots"/);
  });

  it('includes bots in the "+ New" header button and renders BotsSection', () => {
    expect(src).toMatch(/activeSection === "bots"/);
    expect(src).toMatch(/"New Bot"/);
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
