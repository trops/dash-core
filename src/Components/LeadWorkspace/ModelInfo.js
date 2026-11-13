import React, { createContext, useContext } from "react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { TextLink } from "./WidgetWizard/TextLink";
import { runModelLabel, tookText, whyModel } from "../../utils/modelRunLabel";

/**
 * Which model ran it (lead workspace): each step says which model did it,
 * an opened build step says why and where to change it, and the side lists
 * who works on the conversation and on what.
 *
 * ModelInfoContext: { team, lead, openAiSettings } — team: the Dash team's
 * roles as bots.listDashTeam gives them ({ role, name, runsOn, style,
 * chosen }); lead: the conversation's dashboard lead, the same way
 * ({ name, runsOn, style, chosen }), or null; openAiSettings(): opens
 * Settings › AI.
 */
export const ModelInfoContext = createContext({
  team: [],
  lead: null,
  openAiSettings: null,
});

// "the Planner" (a hand-off step's bot) → "planner".
const ROLE_OF = {
  "the planner": "planner",
  "the scout": "scout",
  "the builder": "builder",
  "the checker": "checker",
};

/**
 * What a hand-off step ran on, taken when it's asked (the model it starts
 * on): { model, style, modelChosen, role } — or {} for a bot that isn't a
 * Dash team role.
 */
export function stepRun(step, team = []) {
  const role = ROLE_OF[String((step && step.bot) || "").toLowerCase()];
  const row = role ? (team || []).find((b) => b && b.role === role) : null;
  if (!row || !row.runsOn) return {};
  return {
    model: row.runsOn,
    style: row.style || null,
    modelChosen: !!row.chosen,
    role,
  };
}

/** "Opus 5.5 · Thorough" after a step's line; "Dash itself" for its own check. */
export const ModelTag = ({ run }) => {
  const { muted, hairline } = useConfigTokens();
  const text = run && run.dash ? "Dash itself" : runModelLabel(run);
  if (!text) return null;
  return (
    <span
      className={`flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${muted} ${hairline}`}
      data-testid="model-tag"
    >
      {text}
    </span>
  );
};

/** An opened step: what it ran on, why, how long it took, and where to change it. */
export const RanOn = ({ run }) => {
  const { muted, strong } = useConfigTokens();
  const { openAiSettings } = useContext(ModelInfoContext);
  const label = runModelLabel(run);
  if (!label) return null;
  const took = tookText(run.tookMs);
  const row = (key, value) => (
    <div className="flex flex-row gap-3 text-xs">
      <span className={`w-14 flex-shrink-0 ${muted}`}>{key}</span>
      {value}
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5" data-testid="model-ran-on">
      {row(
        "Ran on",
        <span className={`font-semibold ${strong}`}>{label}</span>,
      )}
      {row(
        "Why",
        <span className={strong}>{whyModel(run.role, run.modelChosen)}</span>,
      )}
      {took ? row("Took", <span className={strong}>{took}</span>) : null}
      {openAiSettings
        ? row(
            "",
            <TextLink
              title="Change in Settings › AI"
              onClick={openAiSettings}
            />,
          )
        : null}
    </div>
  );
};

const WORK_ROLES = ["planner", "builder", "checker", "scout"];

/** The side's "Who works on this": each role, its model, and whose choice it is. */
export const WhoWorks = () => {
  const { muted, strong, hairline } = useConfigTokens();
  const { team, lead, openAiSettings } = useContext(ModelInfoContext);
  const rows = [
    ...WORK_ROLES.map((r) => (team || []).find((b) => b && b.role === r)),
    lead,
  ].filter((b) => b && b.runsOn);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="workspace-who-works">
      <span
        className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
      >
        Who works on this
      </span>
      <div
        className={`dr-chat-card flex flex-col rounded-xl border overflow-hidden ${hairline}`}
      >
        {rows.map((b, i) => (
          <div
            key={b.id || b.name || i}
            className={`flex flex-row items-center gap-3 px-3 py-2 text-xs ${i ? `border-t ${hairline}` : ""}`}
            data-testid="workspace-who-row"
          >
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className={`font-semibold ${strong}`}>
                {b.name || b.leadName}
              </span>
              <span className={muted}>
                {b.chosen ? "Your choice" : "Built in"}
              </span>
            </span>
            <span className={strong}>
              {runModelLabel({ model: b.runsOn, style: b.style })}
            </span>
          </div>
        ))}
      </div>
      <span className={`text-xs ${muted}`}>
        A change applies from the next step — one already running keeps its
        model.
      </span>
      {openAiSettings ? (
        <span>
          <TextLink title="Change in Settings › AI" onClick={openAiSettings} />
        </span>
      ) : null}
    </div>
  );
};
