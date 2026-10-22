import React, { useEffect, useState } from "react";
import { Button3, SelectInput, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { DetailGroup } from "./ManageLayout";
import { BotAvatar } from "../Bots/BotAvatar";
import { toPlainText } from "../Bots/botConversation";
import { modelLabel, runCostLabel } from "../../utils/runCostLabel";
import { withoutMatches } from "../../utils/teamRoles";

// A run's answer as words: the Scout's <matches> and the Planner's <plan>
// blocks are for the app, not to read (QA 2026-10-22: a raw tag showed).
function answerText(output) {
  return withoutMatches(output)
    .replace(/<plan>[\s\S]*?<\/plan>/gi, "")
    .trim();
}

/**
 * DashTeamPanel — one Dash team role on the Bots page (create-entry PRD
 * CRE-011): what it does, the model it runs on (the role's recommended tier
 * unless the user picks one for this provider), pause, and its last run.
 * Team bots can't be deleted, so there's no Delete here or in Edit.
 */

const TIER_TEXT = {
  deep: "Uses the most capable model — it plans the work.",
  balanced: "Uses a balanced model.",
  fast: "Uses the fastest model — it only looks things up.",
};

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** The provider's models, for the picker. */
function useModels(providerId) {
  const [models, setModels] = useState([]);
  useEffect(() => {
    let alive = true;
    const llm = typeof window !== "undefined" && window.mainApi?.llm;
    if (!llm || !llm.listModels || !providerId) return undefined;
    Promise.resolve(llm.listModels(providerId))
      .then((res) => alive && setModels((res && res.models) || []))
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [providerId]);
  return models;
}

export const DashTeamPanel = ({ bot, status, lastRun, onChanged, onEdit }) => {
  const { muted, strong } = useConfigTokens();
  const models = useModels(bot.providerId);
  const [pick, setPick] = useState(bot.runsOn || "");
  const [error, setError] = useState(null);
  const paused = !!bot.paused;
  const ownModel = !!bot.model;

  useEffect(() => setPick(bot.runsOn || ""), [bot.runsOn]);

  const recommended = bot.recommendedModel
    ? `Recommended: ${modelLabel(bot.recommendedModel)}`
    : "Recommended";
  const options = [
    ...(bot.recommendedModel
      ? [{ value: bot.recommendedModel, label: recommended }]
      : []),
    ...models.filter((m) => m.value !== bot.recommendedModel),
  ];

  const chooseModel = async (value) => {
    setPick(value);
    setError(null);
    const b = api();
    if (!b || !b.setSettings) return;
    try {
      await b.setSettings({
        dashTeam: {
          models: {
            [bot.providerId]: {
              // Picking the recommended model clears the override, so the
              // role follows future tier changes.
              [bot.role]: value === bot.recommendedModel ? null : value,
            },
          },
        },
      });
      if (onChanged) await onChanged();
    } catch (err) {
      setError((err && err.message) || "Couldn't change the model.");
    }
  };

  const togglePause = async () => {
    setError(null);
    const b = api();
    if (!b) return;
    try {
      if (paused) await b.resumeBot(bot.id);
      else await b.pauseBot(bot.id);
      if (onChanged) await onChanged();
    } catch (err) {
      setError((err && err.message) || "Couldn't change pause.");
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="dash-team-panel">
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-row items-center gap-3 min-w-0">
          <BotAvatar bot={bot} large />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex flex-row items-center gap-2 min-w-0">
              <h3 className={`text-lg font-semibold truncate ${strong}`}>
                {bot.name}
              </h3>
              <StatusBadge state="info" label="Dash team" />
            </span>
            <span className={`text-sm ${muted}`}>{bot.summary}</span>
            <span className={`text-sm ${muted}`}>{status}</span>
          </div>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Button3
            title={paused ? "Turn on" : "Pause"}
            size="sm"
            onClick={togglePause}
          />
          <Button3 title="Edit" size="sm" onClick={onEdit} />
        </div>
      </div>
      {error ? <span className="text-sm text-red-300">{error}</span> : null}

      <span className={`text-sm ${muted}`}>
        Ready — Create and the Widget Builder will hand it work. It runs on your
        Claude Code plan unless you give it an API key in Edit.
      </span>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          {/* The picker carries its own "Model" label; the plain-text
              cases get the same label as text. */}
          {options.length && !ownModel ? null : (
            <span className="text-sm font-medium">Model</span>
          )}
          {ownModel ? (
            <span className="text-sm">
              {modelLabel(bot.model)} — set on this bot (change it in Edit)
            </span>
          ) : options.length ? (
            <SelectInput
              label="Model"
              value={pick}
              onChange={chooseModel}
              options={options}
            />
          ) : (
            <span className="text-sm">
              {bot.runsOn ? modelLabel(bot.runsOn) : "The provider's default"}
            </span>
          )}
          <span className={`text-sm ${muted}`}>{TIER_TEXT[bot.tier]}</span>
        </div>
        <DetailGroup title="Last run">
          {lastRun ? (
            <div className="flex flex-col gap-1 min-w-0">
              {runCostLabel(lastRun) ? (
                <span className={`text-xs ${muted}`}>
                  {runCostLabel(lastRun)}
                </span>
              ) : null}
              {lastRun.error || answerText(lastRun.output) ? (
                <span className={`text-sm line-clamp-3 ${muted}`}>
                  {toPlainText(lastRun.error || answerText(lastRun.output))}
                </span>
              ) : null}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>Hasn&apos;t run yet</span>
          )}
        </DetailGroup>
      </div>
    </div>
  );
};

export default DashTeamPanel;
