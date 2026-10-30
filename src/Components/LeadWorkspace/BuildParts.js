import React, { useEffect, useState } from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * BuildParts — what a build's Build log shows besides its steps: what Remove
 * takes away and keeps, and the bots it saved to try. From Create's build
 * screen (create-entry CRE-004, CRE-006), kept for the lead workspace when
 * the Create window was retired (lead-workspace release 6c).
 */

/** What Remove takes away and what stays (CRE-006 AC7's rule: installs stay). */
// The modal body sets no text color, so each line takes the theme's.
export const RemoveSummary = ({ built, muted = "", strong = "" }) => {
  // A dashboard the user had stays, with its lead and what its team knows.
  const targeted = !!(built.dashboard && built.dashboard.targeted);
  const goes = [];
  if (built.dashboard && !targeted) {
    goes.push(`The "${built.dashboard.name}" dashboard`);
  }
  if (targeted && (built.placed || []).length) {
    const n = built.placed.length;
    goes.push(
      `${n === 1 ? "The widget" : `The ${n} widgets`} it put on ${built.dashboard.name}`,
    );
  }
  for (const b of built.bots || []) goes.push(`The ${b.name} bot`);
  if (built.dashboard && !targeted) {
    goes.push("The dashboard's team lead, if it has one");
  }
  for (const w of built.widgets || []) goes.push(`The ${w} widget`);
  if (targeted && built.theme) {
    goes.push(
      `The ${built.theme.name} theme — ${
        built.theme.previous
          ? `${built.theme.previousName || built.theme.previous} goes back`
          : "it goes back to the app's theme"
      }`,
    );
  }
  // A changed theme (theme change round).
  const ct = built.changedTheme;
  if (ct && ct.remix) {
    for (const r of ct.replaced || []) {
      goes.push(
        `${ct.name} on ${r.name} — ${(ct.of && ct.of.name) || "the original"} goes back`,
      );
    }
  } else if (ct) {
    goes.push(
      `${ct.name}'s new colors — its old ones come back everywhere it's used`,
    );
  }
  const stays = [
    ...(ct && ct.remix ? [`${ct.name} — stays in your themes`] : []),
    ...(targeted
      ? [
          `The "${built.dashboard.name}" dashboard, its team lead and everything else on it`,
        ]
      : []),
    ...(built.installs || []).map((p) => `${p} — stays installed`),
    ...(built.updated || []).map((p) => `${p} — keeps its changes`),
  ];
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="remove-summary">
      <SectionLabel text="Removed" />
      {goes.map((g) => (
        <span key={g} className={strong}>
          {g}
        </span>
      ))}
      {stays.length ? (
        <>
          <SectionLabel text="Kept" />
          {stays.map((g) => (
            <span key={g} className={muted}>
              {g}
            </span>
          ))}
        </>
      ) : null}
    </div>
  );
};

/**
 * The bots a build saved (they start paused, Phase 1d): Run <bot> now is a
 * test run, and a pass offers Turn on. In Create's build and the lead
 * workspace's Build log (release 3b).
 */
export const TryBots = ({ bots: saved = [] }) => {
  const { muted } = useConfigTokens();
  // botId → "starting" | "passed" | "on" | error text
  const [runs, setRuns] = useState({});
  // Which of them are paused — Turn on is offered only for those.
  const [pausedBots, setPausedBots] = useState([]);
  const savedIds = saved.map((b) => b.id).join(",");
  useEffect(() => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!savedIds || !bots || !bots.getPauseState) return undefined;
    let alive = true;
    Promise.resolve(bots.getPauseState())
      .then((p) => {
        if (alive) setPausedBots((p && p.bots) || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [savedIds]);
  const runBot = async (bot) => {
    setRuns((r) => ({ ...r, [bot.id]: "starting" }));
    try {
      const res = await window.mainApi.bots.run(bot.id);
      setRuns((r) => ({
        ...r,
        [bot.id]:
          res && res.skipped
            ? `It didn't run: ${res.reason || "it was skipped"}.`
            : res && (res.error || res.status === "failed")
              ? String(res.error || "The run failed.")
              : "passed",
      }));
    } catch (err) {
      setRuns((r) => ({
        ...r,
        [bot.id]: (err && err.message) || "It couldn't start.",
      }));
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="building-run-bots">
      <SectionLabel text="Try the bots" />
      <span className={`text-xs ${muted}`}>
        New bots start paused — try one, then turn it on.
      </span>
      {saved.map((b) => {
        const run = runs[b.id];
        return (
          <div key={b.id} className="flex flex-row items-center gap-3">
            <Button3
              title={`Run ${b.name} now`}
              onClick={() => runBot(b)}
              disabled={run === "starting"}
            />
            <span className={`text-xs ${muted}`}>
              {run === "starting"
                ? "Running…"
                : run === "passed"
                  ? "It worked — turn it on?"
                  : run === "on"
                    ? `${b.name} is on.`
                    : run || ""}
            </span>
            {pausedBots.includes(b.id) && run !== "on" ? (
              <Button3
                title={`Turn ${b.name} on`}
                onClick={async () => {
                  try {
                    await window.mainApi.bots.resumeBot(b.id);
                    setRuns((r) => ({ ...r, [b.id]: "on" }));
                  } catch (err) {
                    setRuns((r) => ({
                      ...r,
                      [b.id]: `Couldn't turn it on: ${(err && err.message) || "unknown error"}`,
                    }));
                  }
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
