import React, { useEffect, useRef, useState } from "react";
import { Button, Switch } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * TeamJobSettings — a team's "One job at a time" (DASH-81), on its page in
 * the Bots view. On unless turned off: a job that would start while the team
 * has one going waits its turn (a schedule's run is skipped instead). And
 * its "Standard handoff" (DASH-101), off unless turned on. They're the
 * team's settings, so they apply right away.
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

/** Off unless the team turned it on (DASH-101). */
export const usesHandoffsOf = (settings) =>
  !!(settings && settings.usesHandoffs === true);

export const HANDOFF_HELP = {
  on: "Each bot ends its answer with a handoff (one JSON block). Dash checks it first and sends a wrong one back to the bot, ends the job when there's nothing to do or the work was split, asks you when a bot has a question, and tells the next bot the job's work item, workspace and picks.",
  off: "Off: each bot gets the raw answer of the bot before it, and its own instructions say what to copy forward.",
};

export const SETUP_HELP =
  "Dash checks that every provider starts, every setting has a value, each repo can be read (and pushed to) with the GitHub token, and every repo check is on its repo. With the standard handoff on, it does this before each job, and a job with a bad setup doesn't start.";

/** What a setup check's result says, as one line and its problems. */
export function setupView(res) {
  if (!res) return null;
  if (res.error) return { ok: false, title: res.error, lines: [] };
  const n = (res.problems || []).length;
  return {
    ok: !!res.ok,
    title: res.ok
      ? "The setup is good."
      : `${n} problem${n === 1 ? "" : "s"} to fix:`,
    lines: (res.problems || []).map((p) => p.message),
  };
}

export const TeamJobSettings = ({ workspaceId }) => {
  const { muted, hairline } = useConfigTokens();
  const [on, setOn] = useState(true);
  const [handoffs, setHandoffs] = useState(false);
  const [error, setError] = useState(null);
  const [setup, setSetup] = useState(null);
  const [checking, setChecking] = useState(false);
  const current = useRef(workspaceId);
  current.current = workspaceId;

  useEffect(() => {
    const api = botsApi();
    setError(null);
    setSetup(null);
    if (!api || !api.getTeamSettings || workspaceId == null) return;
    Promise.resolve(api.getTeamSettings(workspaceId))
      .then((s) => {
        if (current.current === workspaceId) {
          setOn(oneJobAtATimeOf(s));
          setHandoffs(usesHandoffsOf(s));
        }
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

  const changeHandoffs = async (next) => {
    const api = botsApi();
    if (!api || !api.setUsesHandoffs) return;
    setError(null);
    setHandoffs(next);
    try {
      const r = await api.setUsesHandoffs(workspaceId, next);
      if (r && r.error) throw new Error(r.error);
    } catch (err) {
      setHandoffs(!next);
      setError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  const checkSetup = async () => {
    const api = botsApi();
    if (!api || !api.checkSetup) {
      setSetup({ error: "This version of Dash can't check a setup yet." });
      return;
    }
    setChecking(true);
    try {
      const r = await api.checkSetup(workspaceId);
      if (current.current === workspaceId) setSetup(r || null);
    } catch (err) {
      if (current.current === workspaceId) {
        setSetup({ error: (err && err.message) || "Couldn't check it." });
      }
    } finally {
      if (current.current === workspaceId) setChecking(false);
    }
  };
  const shown = setupView(setup);

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
      <div
        className={`flex flex-row items-center gap-4 px-4 py-3 border-t ${hairline}`}
        data-testid="team-handoff-setting"
      >
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Standard handoff</span>
          <span className={`text-xs ${muted}`}>
            {handoffs ? HANDOFF_HELP.on : HANDOFF_HELP.off}
          </span>
        </span>
        <Switch
          checked={handoffs}
          onChange={changeHandoffs}
          ariaLabel="Standard handoff"
        />
      </div>
      <div
        className={`flex flex-col gap-2 px-4 py-3 border-t ${hairline}`}
        data-testid="team-setup-check"
      >
        <div className="flex flex-row items-center gap-4">
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Setup</span>
            <span className={`text-xs ${muted}`}>{SETUP_HELP}</span>
          </span>
          <Button
            title={checking ? "Checking…" : "Check setup"}
            size="sm"
            onClick={checking ? undefined : checkSetup}
          />
        </div>
        {shown ? (
          <div
            className="flex flex-col gap-1 text-xs"
            data-testid="setup-result"
          >
            <span className="font-semibold">{shown.title}</span>
            {shown.lines.map((l, i) => (
              <span key={i}>{`• ${l}`}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default TeamJobSettings;
