import React from "react";
import { Button, Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { STATUS_DOT, triggerSummary } from "./teamUtils";
import { eventText, runsAfter, thenTriggers } from "./teamDiagram";

/**
 * BotFlowSummary — the side panel beside the team diagram (bot-teams PRD
 * TEAM-014 AC4): the selected bot, what it runs after and what it triggers,
 * and the way into its Conversation / Activity / Settings.
 *
 * @param {object[]} team  the dashboard's bots, lead included
 */
export const BotFlowSummary = ({
  bot,
  team = [],
  nameOf = () => null,
  status = "Idle",
  onOpen,
  onRunNow,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  if (!bot) return null;
  const isLead = bot.role === "lead";
  const after = isLead ? [] : runsAfter(bot, team, nameOf);
  const triggers = isLead ? [] : thenTriggers(bot.id, team);
  const providers = isLead ? [] : bot.mcpServers || [];
  const dot = STATUS_DOT[status] || STATUS_DOT.Idle;

  const item = (key, text) => (
    <div
      key={key}
      className={`text-sm rounded-lg border px-3 py-2 ${hairline}`}
    >
      {text}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-row items-center gap-3">
        <BotAvatar bot={bot} large />
        <div className="min-w-0">
          <div className={`text-base font-semibold ${strong}`}>{bot.name}</div>
          <div
            className={`flex flex-row items-center gap-1.5 text-xs ${muted}`}
          >
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            {status}
            {isLead ? " · Team lead" : ` · ${triggerSummary(bot)}`}
          </div>
        </div>
      </div>

      {providers.length ? (
        <div className="flex flex-col gap-1">
          <SectionLabel text="Providers" />
          <span className="text-sm">{providers.join(", ")}</span>
        </div>
      ) : null}

      {isLead ? (
        <span className={`text-sm ${muted}`}>
          The lead answers questions and drafts bots; other bots don't trigger
          it.
        </span>
      ) : (
        <>
          <div data-testid="runs-after" className="flex flex-col gap-2">
            <SectionLabel text="Runs after" />
            {after.length ? (
              after.map((a, i) =>
                item(
                  `a${i}`,
                  `${a.name}${a.offTeam ? " (other dashboard)" : ""} · ${eventText(a.event)}`,
                ),
              )
            ) : (
              <span className={`text-sm ${muted}`}>
                Nothing — runs manually or on its schedule.
              </span>
            )}
          </div>
          <div data-testid="then-triggers" className="flex flex-col gap-2">
            <SectionLabel text="Then triggers" />
            {triggers.length ? (
              triggers.map((t, i) =>
                item(`t${i}`, `${t.name} · ${eventText(t.event)}`),
              )
            ) : (
              <span className={`text-sm ${muted}`}>
                Nothing yet — no bot runs after this one.
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex flex-row flex-wrap gap-2">
        <Button3
          title={isLead ? "Ask the lead" : "Conversation"}
          size="sm"
          onClick={() => onOpen && onOpen("conversation")}
        />
        <Button3
          title="Activity"
          size="sm"
          onClick={() => onOpen && onOpen("activity")}
        />
        <Button3
          title="Settings"
          size="sm"
          onClick={() => onOpen && onOpen("settings")}
        />
        {!isLead ? (
          <Button title="Run now" size="sm" onClick={onRunNow} />
        ) : null}
      </div>
    </div>
  );
};

export default BotFlowSummary;
