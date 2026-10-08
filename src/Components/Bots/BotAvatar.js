import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { avatarColor } from "../AppPages/botSummary";

/**
 * The generic robot avatar on the bot's colour — the Bots page, the Bots
 * view list and the team diagram (bot-teams PRD TEAM-014 AC1).
 */
export const BotAvatar = ({ bot, large = false }) => {
  const color = avatarColor(bot);
  const size = large ? "h-12 w-12 text-xl" : "h-8 w-8 text-sm";
  return (
    <span
      data-testid="bot-avatar"
      className={`flex items-center justify-center rounded-lg flex-shrink-0 text-white ${size} ${color}`}
    >
      <FontAwesomeIcon icon="robot" />
    </span>
  );
};

export default BotAvatar;
