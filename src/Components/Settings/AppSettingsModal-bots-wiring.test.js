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
});
