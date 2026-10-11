import React, { useState } from "react";
import { Tabs3 } from "@trops/dash-react";
import { BotDetail } from "../Settings/details/BotDetail";
import { BotRunHistory } from "../Bots/BotRunHistory";

/**
 * BotConfigPanel — a selected bot in the edit panel (create-entry PRD
 * CRE-006 AC5): Instructions · Runs · Access.
 *
 * Instructions and Access are one bot form (BotDetail) showing different
 * parts, so switching between them never loses what was typed. The form
 * has no Save of its own here: each valid change goes to `onStage` and
 * waits for the dashboard's Save. Runs is the bot's run history (live,
 * nothing to stage).
 *
 * @param {object} bot                 the bot (with any staged edits applied)
 * @param {(definition, opened) => void} onStage
 * @param {object} formProps            the rest of BotDetail's props
 *                                      (providers, workspaces, …)
 */
export const BotConfigPanel = ({ bot, onStage, formProps = {} }) => {
  const [tab, setTab] = useState("instructions");
  const formSection = tab === "access" ? "access" : "instructions";

  return (
    <Tabs3
      value={tab}
      onValueChange={setTab}
      className="flex flex-col flex-1 min-h-0 border-0"
    >
      <Tabs3.List className="mx-3 self-start">
        <Tabs3.Trigger value="instructions">Instructions</Tabs3.Trigger>
        <Tabs3.Trigger value="runs">Runs</Tabs3.Trigger>
        <Tabs3.Trigger value="access">Access</Tabs3.Trigger>
      </Tabs3.List>
      <span className="px-4 pt-2 text-xs opacity-70">
        Bot changes wait for the dashboard&apos;s Save.
      </span>
      {/* One form for Instructions and Access — kept mounted (hidden on
          Runs) so its edits survive switching tabs. */}
      <div
        className={tab === "runs" ? "hidden" : "flex flex-col flex-1 min-h-0"}
        data-testid="bot-config-form"
      >
        <BotDetail
          {...formProps}
          bot={bot}
          section={formSection}
          stageChanges
          onChange={onStage}
        />
      </div>
      {tab === "runs" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <BotRunHistory
            bot={bot}
            onOpenSettings={() => setTab("instructions")}
            onChangeModel={() => setTab("instructions")}
          />
        </div>
      )}
    </Tabs3>
  );
};
