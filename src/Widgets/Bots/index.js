import { BotResultsWidget } from "./BotResultsWidget";
import { BotActivityWidget } from "./BotActivityWidget";

/**
 * Built-in bot widgets (bot-teams TEAM-012). They ship with dash-core —
 * nothing to install — and only show bots on their own dashboard's team.
 * Ids must match electron/controller/botController.js BOT_WIDGETS.
 */
export const BOT_WIDGET_CONFIGS = [
  {
    id: "dash.bots.BotResults",
    scope: "dash",
    packageName: "bots",
    name: "BotResults",
    displayName: "Bot results",
    component: BotResultsWidget,
    canHaveChildren: false,
    type: "widget",
    workspace: "bots-workspace",
    package: "Bots (built in)",
    author: "Dash",
    icon: "robot",
    description:
      "One bot's latest result: status, when it ran and why, its answer, approvals waiting, and Run now.",
    events: [],
    eventHandlers: [],
    providers: [],
    userConfig: {
      botId: {
        type: "text",
        defaultValue: "",
        displayName: "Bot",
        instructions:
          "Set by a bot's Show on dashboard, or by picking a bot in the widget.",
        required: false,
      },
    },
  },
  {
    id: "dash.bots.BotActivity",
    scope: "dash",
    packageName: "bots",
    name: "BotActivity",
    displayName: "Bot activity",
    component: BotActivityWidget,
    canHaveChildren: false,
    type: "widget",
    workspace: "bots-workspace",
    package: "Bots (built in)",
    author: "Dash",
    icon: "list",
    description:
      "This dashboard's latest bot runs and approvals waiting, newest first.",
    events: [],
    eventHandlers: [],
    providers: [],
    userConfig: {},
  },
];

/** Register the built-in bot widgets with a ComponentManager. */
export function registerBotWidgets(componentManager) {
  for (const config of BOT_WIDGET_CONFIGS) {
    componentManager.registerWidget(config, config.id);
  }
}
