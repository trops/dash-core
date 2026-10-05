import { BOT_WIDGET_CONFIGS, registerBotWidgets } from "./index";

jest.mock("../../Widget", () => ({ Widget: ({ children }) => children }));
jest.mock("../../Components/Bots/useTeamBots", () => ({
  useTeamBots: () => ({}),
}));

describe("built-in bot widgets (TEAM-012)", () => {
  it("registers Bot results and Bot activity under dash.bots", () => {
    const registered = [];
    registerBotWidgets({
      registerWidget: (c, key) => registered.push([c.id, key, c.type]),
    });
    expect(registered).toEqual([
      ["dash.bots.BotResults", "dash.bots.BotResults", "widget"],
      ["dash.bots.BotActivity", "dash.bots.BotActivity", "widget"],
    ]);
  });

  it("uses the ids the main process places (botController BOT_WIDGETS)", () => {
    const fs = require("fs");
    const path = require("path");
    const ctrl = fs.readFileSync(
      path.join(__dirname, "../../../electron/controller/botController.js"),
      "utf8",
    );
    for (const c of BOT_WIDGET_CONFIGS) expect(ctrl).toContain(`"${c.id}"`);
  });

  it("keeps the bot link as a widget setting", () => {
    expect(Object.keys(BOT_WIDGET_CONFIGS[0].userConfig)).toEqual(["botId"]);
  });
});
