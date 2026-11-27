import React, { useEffect, useRef, useState } from "react";
import { Switch, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { offCommandsLine } from "../../utils/offCommands";
import { MoreDetail } from "./MoreDetail";

/**
 * TeamJobSettings — "How jobs run" on a team's page (DASH-120): its "One
 * job at a time" (DASH-81), on unless turned off: a job that would start
 * while the team has one going waits its turn (a schedule's run is skipped
 * instead). And its standard handoff (DASH-101), off unless turned on, or
 * on from install for a package that declares it (DASH-129).
 * They're about how the bots hand work to each other, so they're the
 * team's, and they apply right away; each switch's error shows under its
 * own row.
 *
 * The self-test and Check setup moved to the Set up checklist
 * (TeamSetupChecklist); their helpers stay here.
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

// What the switch is for, in an installer's words (DASH-129); how it
// works is under "Learn more" (HANDOFF_DETAIL).
export const HANDOFF_HELP = {
  on: "Dash checks each handoff, stops when there's nothing to do, and brings a bot's question to you as a card.",
  off: "Off: each bot gets the answer of the bot before it as it is, and its own instructions say what to pass on.",
};

export const HANDOFF_DETAIL =
  "Each bot ends its answer with a handoff: one JSON block with its status, the ticket or issue it worked on, and what it picked. Dash checks it first and sends a wrong one back to the bot, ends the job when there's nothing to do or the work was split, asks you when a bot has a question, and tells the next bot the job's ticket, workspace and picks. Packages that say their bots use it turn it on when they're installed.";

export const SELF_TEST_HELP =
  "Runs the whole team on a test item with outward actions off: no comments, transitions, pushes or merges. It checks setup first, then opens the job so you can follow it.";

/** What the self-test row says: tested, or the untested change. */
export function selfTestLine(settings) {
  const u = settings && settings.untested;
  if (u) return `Untested change: ${u.what}. Run a self-test before real work.`;
  const t = settings && settings.lastTest;
  return t && t.at
    ? `Tested ${new Date(t.at).toLocaleString()}.`
    : "Not tested yet.";
}

export const SETUP_HELP =
  "Dash checks that every provider starts, every setting has a value, each repo can be read (and pushed to) with the GitHub token, and every repo check is on its repo. With the standard handoff on, it does this before each job, and a job with a bad setup doesn't start.";

/** What a setup check's result says, as one line and its problems. */
export function setupView(res) {
  if (!res) return null;
  if (res.error) return { ok: false, title: res.error, lines: [] };
  // Commands that came with a package and are off (DASH-125): one more
  // thing to fix, though jobs still start (they wait for your approval).
  const off = Array.isArray(res.off) ? res.off : [];
  const offLine = offCommandsLine(off);
  const n = (res.problems || []).length + (offLine ? 1 : 0);
  return {
    ok: !!res.ok,
    title:
      res.ok && !offLine
        ? "The setup is good."
        : `${n} problem${n === 1 ? "" : "s"} to fix:`,
    lines: [
      ...(res.problems || []).map((p) => p.message),
      ...(offLine ? [offLine] : []),
    ],
    off,
    offLine,
  };
}

export const HANDOFF_TITLE =
  "Bots pass work in a standard format (recommended)";

export const TeamJobSettings = ({ workspaceId }) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const [on, setOn] = useState(true);
  const [handoffs, setHandoffs] = useState(false);
  const [oneError, setOneError] = useState(null);
  const [handoffError, setHandoffError] = useState(null);
  const current = useRef(workspaceId);
  current.current = workspaceId;

  useEffect(() => {
    const api = botsApi();
    setOneError(null);
    setHandoffError(null);
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
    setOneError(null);
    setOn(next);
    try {
      await api.setOneJobAtATime(workspaceId, next);
    } catch (err) {
      setOn(!next);
      setOneError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  const changeHandoffs = async (next) => {
    const api = botsApi();
    if (!api || !api.setUsesHandoffs) return;
    setHandoffError(null);
    setHandoffs(next);
    try {
      const r = await api.setUsesHandoffs(workspaceId, next);
      if (r && r.error) throw new Error(r.error);
    } catch (err) {
      setHandoffs(!next);
      setHandoffError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  const errorLine = (text, id) =>
    text ? (
      <span className={`text-xs ${status.error.text}`} data-testid={id}>
        {text}
      </span>
    ) : null;

  return (
    <section
      aria-label="How jobs run"
      data-testid="team-job-settings"
      className="flex flex-col gap-2"
    >
      <span className="text-sm font-semibold">How jobs run</span>
      <div className={`flex flex-col rounded-xl border ${hairline}`}>
        <div className="flex flex-row items-center gap-4 px-4 py-3">
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-sm font-semibold">One job at a time</span>
            <span className={`text-xs ${muted}`}>
              {on ? ONE_JOB_HELP.on : ONE_JOB_HELP.off}
            </span>
            {errorLine(oneError, "one-job-error")}
          </span>
          <Switch
            checked={on}
            onChange={change}
            ariaLabel="One job at a time"
          />
        </div>
        <div
          className={`flex flex-row items-center gap-4 px-4 py-3 border-t ${hairline}`}
          data-testid="team-handoff-setting"
        >
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-sm font-semibold">{HANDOFF_TITLE}</span>
            <span className={`text-xs ${muted}`}>
              {handoffs ? HANDOFF_HELP.on : HANDOFF_HELP.off}
            </span>
            <MoreDetail
              label="Learn more"
              hideLabel="Show less"
              testId="handoff-learn-more"
            >
              {HANDOFF_DETAIL}
            </MoreDetail>
            {errorLine(handoffError, "handoff-error")}
          </span>
          <Switch
            checked={handoffs}
            onChange={changeHandoffs}
            ariaLabel="Standard handoff"
          />
        </div>
      </div>
    </section>
  );
};

export default TeamJobSettings;
