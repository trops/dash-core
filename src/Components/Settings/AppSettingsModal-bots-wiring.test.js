/**
 * Static wiring pin: the Bots Manage page (it moved out of AppSettingsModal —
 * app-navigation NAV-004, redesigned as list + detail in NAV-006): AppPage
 * renders BotsPage with a "New Bot" action. Mirrors the source-presence style
 * used by AppSettingsModal-create-with-type.test.js.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "AppPages", "AppPage.js"),
  "utf8",
);

describe("Bots page wiring", () => {
  it("imports BotsPage", () => {
    expect(src).toMatch(/import \{ BotsPage \} from "\.\/BotsPage"/);
  });

  it('has a "New Bot" action and renders BotsPage', () => {
    expect(src).toMatch(/bots: "New Bot"/);
    expect(src).toMatch(/<BotsPage/);
  });

  it("passes the dashboards to BotsPage (for the event picker)", () => {
    expect(src).toMatch(/<BotsPage[^>]*workspaces=\{workspaces\}/);
  });
});

describe("BotsPage — event picker wiring", () => {
  const pageSrc = fs.readFileSync(
    path.join(__dirname, "..", "AppPages", "BotsPage.js"),
    "utf8",
  );

  it("hands BotDetail the dashboards and the widget-config lookup", () => {
    const details = pageSrc.match(/<BotDetail\s[\s\S]*?\/>/g) || [];
    expect(details.length).toBe(2); // create + edit
    for (const d of details) {
      expect(d).toMatch(/workspaces=\{workspaces\}/);
      expect(d).toMatch(/getWidgetConfig=\{getWidgetConfig\}/);
      // Other bots' events (From: Another bot).
      expect(d).toMatch(/bots=\{all\.bots\}/);
    }
    expect(pageSrc).toMatch(/ComponentManager\.config\(/);
  });
});
