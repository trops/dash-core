import React, { useEffect, useRef, useState } from "react";
import { Switch } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * TeamJobSettings — a team's "One job at a time" (DASH-81), on its page in
 * the Bots view. On unless turned off: a job that would start while the team
 * has one going waits its turn (a schedule's run is skipped instead). It's
 * the team's setting, so it applies right away.
 */

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** On unless the team turned it off. */
export const oneJobAtATimeOf = (settings) =>
  !(settings && settings.oneJobAtATime === false);

export const ONE_JOB_HELP = {
  on: "A job that starts while this team is busy waits its turn: tasks and triggers queue on the Jobs page, and a scheduled run is skipped until the team is free. Use it when the bots share one app or folder.",
  off: "Off: jobs can run at the same time, so two can use the team's apps and folders at once.",
};

export const TeamJobSettings = ({ workspaceId }) => {
  const { muted, hairline } = useConfigTokens();
  const [on, setOn] = useState(true);
  const [error, setError] = useState(null);
  const current = useRef(workspaceId);
  current.current = workspaceId;

  useEffect(() => {
    const api = botsApi();
    setError(null);
    if (!api || !api.getTeamSettings || workspaceId == null) return;
    Promise.resolve(api.getTeamSettings(workspaceId))
      .then((s) => {
        if (current.current === workspaceId) setOn(oneJobAtATimeOf(s));
      })
      .catch(() => {});
  }, [workspaceId]);

  const change = async (next) => {
    const api = botsApi();
    if (!api || !api.setOneJobAtATime) return;
    setError(null);
    setOn(next);
    try {
      await api.setOneJobAtATime(workspaceId, next);
    } catch (err) {
      setOn(!next);
      setError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  return (
    <section
      aria-label="Jobs"
      data-testid="team-job-settings"
      className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
    >
      <div className="flex flex-row items-center gap-4 px-4 py-3">
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-semibold">One job at a time</span>
          <span className={`text-xs ${muted}`}>
            {on ? ONE_JOB_HELP.on : ONE_JOB_HELP.off}
          </span>
          {error ? <span className="text-xs">{error}</span> : null}
        </span>
        <Switch checked={on} onChange={change} ariaLabel="One job at a time" />
      </div>
    </section>
  );
};

export default TeamJobSettings;
