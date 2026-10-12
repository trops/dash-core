import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  runTeamRole,
  extractMatches,
  withoutMatches,
} from "../../utils/teamRoles";
import { runCostLabel } from "../../utils/runCostLabel";

/**
 * CreateScoutStep — before building a widget, the Dash team's Scout looks
 * through the user's widgets, AI-built widgets and the registry (create-entry
 * PRD CRE-009 AC1/AC2/AC6, CRE-011 AC2). Each match says where it's from;
 * the user uses one, installs one, or builds new. "Skip" builds right away —
 * nobody has to wait for the search. A paused Scout goes straight to building.
 *
 * @param {string} prompt          what the user asked for
 * @param {() => void} onBuildNew  open the Widget Builder with the prompt
 * @param {(m: { source, name, package }) => void} onUse  open a match
 */
export const CreateScoutStep = ({ prompt, onBuildNew, onUse }) => {
  const { muted, strong, hairline } = useConfigTokens();
  // looking | done | failed
  const [phase, setPhase] = useState("looking");
  const [soFar, setSoFar] = useState("");
  const [run, setRun] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    runTeamRole(
      "scout",
      `Find widgets that could do this: "${prompt}". Search with search_library.`,
      { onText: (t) => alive.current && setSoFar(t) },
    ).then((res) => {
      if (!alive.current) return;
      if (res.skipped) {
        // No Scout right now: build, as before the team existed.
        onBuildNew();
        return;
      }
      setRun(res);
      setPhase(res.status === "failed" ? "failed" : "done");
    });
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const answer = run ? run.output || soFar : soFar;
  const matches = phase === "done" ? extractMatches(answer) : null;
  const prose = withoutMatches(answer);
  const meta = run ? runCostLabel(run) : "";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="create-scout">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-5 px-6 py-12">
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${hairline} ${strong}`}
        >
          {prompt}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-center gap-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Scout
            </span>
            <span className={muted}>
              {phase === "looking"
                ? "Looking through your widgets and the registry…"
                : phase === "failed"
                  ? "Couldn't finish the search"
                  : "Searched your widgets, AI-built widgets and the registry"}
            </span>
            {meta ? <span className={muted}>· {meta}</span> : null}
          </div>
          {phase === "failed" ? (
            <span className="text-sm">
              {(run && run.error) || "The Scout didn't answer."} You can still
              build it.
            </span>
          ) : null}
        </div>

        {/* The choice first — the list can be long. */}
        <div className="flex flex-row flex-wrap items-center gap-3">
          {phase === "looking" ? (
            <Button3 title="Skip — just build it" onClick={onBuildNew} />
          ) : (
            <Button
              title={
                matches && matches.length ? "Build new instead" : "Build it"
              }
              onClick={onBuildNew}
            />
          )}
        </div>
        {phase === "done" && matches && matches.length ? (
          <div className="flex flex-col gap-2" data-testid="scout-matches">
            <SectionLabel text="What you could use instead" />
            {matches.map((m, i) => (
              <div
                key={`${m.package}-${m.name}-${i}`}
                className={`flex flex-row items-center gap-3 rounded-lg border px-4 py-3 ${hairline}`}
              >
                <span
                  className={`text-xs font-semibold uppercase tracking-wider flex-shrink-0 ${muted}`}
                >
                  {m.source === "Registry" ? "Registry · install" : m.source}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm font-medium truncate ${strong}`}>
                    {m.name}
                  </span>
                  <span className={`text-xs truncate ${muted}`}>
                    {[m.package, m.why].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Button3
                  title={m.source === "Registry" ? "Install" : "Use this"}
                  size="sm"
                  onClick={() => onUse(m)}
                />
              </div>
            ))}
          </div>
        ) : null}

        {phase === "done" && (!matches || !matches.length) && prose ? (
          <p className="text-sm whitespace-pre-wrap" data-testid="scout-prose">
            {prose}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default CreateScoutStep;
