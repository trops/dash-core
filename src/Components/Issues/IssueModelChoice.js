import React, { useEffect, useState } from "react";
import { Button } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { ModelPicker } from "../Settings/ModelPicker";
import { useModelList } from "../Settings/useModelList";
import { choiceLabel, choiceNow } from "../Settings/modelChoices";
import { JOB_ROWS } from "../Settings/sections/aiSettingsText";

/** The job a bot does, as Settings › AI names it (aiDefaults.jobOf). */
export function jobOfBot(bot) {
  if (bot && bot.system === "dash-team") {
    return bot.role === "dashlead" ? "dashLead" : bot.role;
  }
  return bot && bot.role === "lead" ? "leads" : "bots";
}

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/**
 * IssueModelChoice — a bot whose model was retired with nothing known to
 * replace it (issue cause "model"): pick what it uses from now on — its
 * job's default, Latest of a family, or one version — and Save.
 */
export function IssueModelChoice({ issue, onSaved = null }) {
  const { muted, strong } = useConfigTokens();
  const { models } = useModelList();
  const botId = issue && issue.asset && issue.asset.botId;
  const [defaultChoice, setDefaultChoice] = useState(null);
  const [value, setValue] = useState("");
  const [state, setState] = useState(null); // null | "saving" | "saved" | error text

  useEffect(() => {
    const b = botsApi();
    if (!b || !b.getSettings || !b.list || !botId) return;
    let live = true;
    Promise.all([b.getSettings(), b.list()])
      .then(([settings, list]) => {
        if (!live) return;
        const bot = (list || []).find((x) => x.id === botId);
        const job = jobOfBot(bot);
        const ai = (settings && settings.aiResolved) || {};
        const d = (ai.defaults && ai.defaults[job]) || {};
        const row = JOB_ROWS.find((r) => r.job === job);
        setDefaultChoice({
          name: `${row ? row.name : "Its"} default`,
          model: d.model || (bot && bot.runsOn) || null,
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [botId]);

  if (!botId) return null;

  const first = [
    {
      value: "",
      label: defaultChoice
        ? `${defaultChoice.name}${defaultChoice.model ? ` (${choiceLabel(models, defaultChoice.model)})` : ""}`
        : "Its default",
      description:
        defaultChoice && defaultChoice.model
          ? choiceNow(models, defaultChoice.model)
          : "what Settings › AI sets for it",
    },
  ];

  const save = async () => {
    const b = botsApi();
    if (!b || !b.save) return;
    setState("saving");
    try {
      await b.save({ id: botId, model: value || null });
      setState("saved");
      if (onSaved) onSaved(value || null);
    } catch (e) {
      setState((e && e.message) || "That didn't save.");
    }
  };

  return (
    <div
      className="flex flex-row flex-wrap items-center gap-2"
      data-testid="issue-model-choice"
    >
      <span className={`text-sm ${strong}`}>Use from now on</span>
      <div className="w-64">
        <ModelPicker
          ariaLabel="Use from now on"
          models={models}
          value={value}
          first={first}
          onChange={(v) => {
            setValue(v);
            setState(null);
          }}
        />
      </div>
      <Button
        title={state === "saving" ? "Saving…" : "Save"}
        size="sm"
        disabled={state === "saving"}
        onClick={save}
      />
      {state && state !== "saving" ? (
        <span className={`text-sm ${muted}`} role="status">
          {state === "saved" ? "Saved." : state}
        </span>
      ) : null}
    </div>
  );
}

export default IssueModelChoice;
