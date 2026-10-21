import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { avatarColor } from "../AppPages/botSummary";

/**
 * The generic robot avatar on the bot's colour — the Bots page, the Bots
 * view list and the team diagram (bot-teams PRD TEAM-014 AC1). `icon`
 * swaps the robot (the Dash team's people, Phase 4a).
 */
export const BotAvatar = ({ bot, large = false, icon = "robot" }) => {
  const color = avatarColor(bot);
  const size = large ? "h-12 w-12 text-xl" : "h-8 w-8 text-sm";
  return (
    <span
      data-testid="bot-avatar"
      className={`flex items-center justify-center rounded-lg flex-shrink-0 text-white ${size} ${color}`}
    >
      <FontAwesomeIcon icon={icon} />
    </span>
  );
};

export default BotAvatar;
