/**
 * newBotWiring (make it in Create): DashboardStage opens a new bot's form
 * from Create — the dashboard's Bots view, or a window for no dashboard —
 * once, and never behind an unsaved-edits question.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "DashboardStage.js"), "utf8");

describe("DashboardStage — dash:new-bot", () => {
  test("listens for Create's blank bot and copy", () => {
    expect(src).toMatch(/window\.addEventListener\("dash:new-bot", handler\)/);
  });
  test("no dashboard: the bot form in its own window; saved, its page opens", () => {
    expect(src).toMatch(
      /d\.workspaceId === undefined \|\|\s*d\.workspaceId === null \|\|\s*d\.workspaceId === ""[\s\S]{0,80}setNewBotRequest\(\{ \.\.\.extra, seq: Date\.now\(\) \}\)/,
    );
    expect(src).toMatch(
      /<NewBotModal[\s\S]{0,300}onSaved=\{\(bot\) =>\s*setBotPageRequest\(\{ botId: bot\.id, tab: "activity" \}\)/,
    );
  });
  test("a dashboard, found by id as text or number: its Bots view, on the form", () => {
    expect(src).toMatch(
      /\(w\) => w && String\(w\.id\) === String\(d\.workspaceId\)/,
    );
    expect(src).toMatch(
      /focusBot\(ws\.id, "__new__", "settings", extra\);\s*handleOpenTab\(ws\);/,
    );
  });
  test("unsaved edits or Edit mode: says so instead of queueing the form", () => {
    expect(src).toMatch(
      /\(isDirty && !here\) \|\| \(here && !previewMode\) \|\| botsDirtyRef\.current/,
    );
    expect(src).toMatch(/Save or cancel your edits first/);
  });
  test("the request is let go once the Bots view used it", () => {
    expect(src).toMatch(
      /onFocusApplied=\{\(seq\) =>\s*setBotsFocus\(\(prev\) =>\s*prev && prev\.seq === seq && prev\.botId === "__new__"\s*\?\s*null\s*:\s*prev,?\s*\)\s*\}/,
    );
  });
});
