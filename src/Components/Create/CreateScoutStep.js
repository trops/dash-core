import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, ChatMessage, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  runTeamRole,
  extractMatches,
  withoutMatches,
} from "../../utils/teamRoles";
import { runCostLabel } from "../../utils/runCostLabel";
import { scoutBotRequest } from "./botCreate";
import { toPlainText } from "../Bots/botConversation";

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
 * @param {boolean} [cell]  for a cell being edited (Phase 2b): each match is
 *   "Use in this cell" (a registry one is installed first), and Build new
 *   plans it with the Dash team
 * @param {{ where: string|null }} [bot]  looking for a bot (Phase 2c-1):
 *   the user's bots and registry ones; each match is "Use on <where>" (a
 *   copy), and Build new plans one with the Dash team
 * @param {string} [context]  what Dash knows about the dashboard (and a
 *   lead's note) — teamContext.contextRequest (2c-2)
 */
export const CreateScoutStep = ({
  prompt,
  onBuildNew,
  onUse,
  cell = false,
  bot = null,
  context = "",
}) => {
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
      // It knows what comes next, so it doesn't send the user elsewhere.
      bot
        ? scoutBotRequest(prompt, context)
        : `Find widgets that could do this: "${prompt}". Search with search_library. If nothing fits, say so in a sentence or two — the Planner plans a new one next, so don't tell the user who to ask.`,
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
  // Bots when looking for a bot, widgets otherwise.
  const found = phase === "done" ? extractMatches(answer) : null;
  // (Looking for a bot, the search only returned bots — a match the Scout
  // didn't mark is one too.)
  const matches = found
    ? bot
      ? found.map((m) => ({ ...m, kind: "bot" }))
      : found.filter((m) => m.kind !== "bot")
    : null;
  // Plain text, as every bot answer (no Markdown markers).
  const prose = toPlainText(withoutMatches(answer));
  const meta = run ? runCostLabel(run) : "";
  // A cell or a bot: the Dash team plans it next.
  const plansNext = cell || !!bot;

  const choice =
    phase === "looking" ? (
      <Button3
        title={plansNext ? "Skip — plan a new one" : "Skip — just build it"}
        onClick={onBuildNew}
      />
    ) : (
      <Button
        title={
          plansNext
            ? matches && matches.length
              ? "None of these — plan a new one"
              : "Plan it"
            : matches && matches.length
              ? "Build new instead"
              : "Build it"
        }
        onClick={onBuildNew}
      />
    );

  // A conversation, as the Planner's (create-entry CRE-011): the request on
  // the right; the Scout's reply on the left — a spinner while it looks, then
  // what it found and the choice, all in its reply.
  return (
    // A solid scroller (the modal's own color): see-through, the Scout's
    // growing reply left stale gray tiles behind it (found live, light mode).
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ backgroundColor: "inherit" }}
      data-testid="create-scout"
    >
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-4 px-6 py-8">
        <ChatMessage role="you">{prompt}</ChatMessage>
        <ChatMessage
          role="reply"
          label="Scout"
          meta={meta || undefined}
          streaming={phase === "looking"}
          testId="scout-message"
        >
          <div className="flex flex-col gap-3">
            <span
              className="whitespace-pre-wrap"
              data-testid={
                phase === "done" && !(matches && matches.length)
                  ? "scout-prose"
                  : undefined
              }
            >
              {phase === "looking"
                ? (soFar && toPlainText(withoutMatches(soFar))) ||
                  (bot
                    ? "Looking through your bots and the registry's…"
                    : "Looking through your widgets, AI-built widgets and the registry…")
                : phase === "failed"
                  ? `${(run && run.error) || "The Scout didn't answer."} You can still ${bot ? "plan" : "build"} it.`
                  : matches && matches.length
                    ? bot
                      ? "Here's what you already have, or could add, that fits:"
                      : "Here's what you already have, or could install, that fits:"
                    : prose ||
                      "Nothing you have, or the registry has, fits — let's make it."}
            </span>
            {phase === "done" && matches && matches.length ? (
              <div className="flex flex-col gap-2" data-testid="scout-matches">
                {matches.map((m, i) => (
                  <div
                    key={`${m.package}-${m.name}-${i}`}
                    className={`flex flex-row items-center gap-3 rounded-lg border px-3 py-2 ${hairline}`}
                  >
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span
                        className={`text-sm font-medium truncate ${strong}`}
                      >
                        {m.name}
                      </span>
                      <span className={`text-xs truncate ${muted}`}>
                        <span>
                          {m.source === "Registry" && !bot
                            ? "Registry · install"
                            : m.source}
                        </span>
                        {m.why ? ` · ${m.why}` : ""}
                      </span>
                    </span>
                    <Button3
                      title={
                        bot
                          ? bot.where
                            ? `Use on ${bot.where}`
                            : "Use a copy"
                          : cell
                            ? "Use in this cell"
                            : m.source === "Registry"
                              ? "Install"
                              : "Use this"
                      }
                      size="sm"
                      onClick={() => onUse(m)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {phase === "done" && matches && matches.length && prose ? (
              <span
                className={`text-xs whitespace-pre-wrap ${muted}`}
                data-testid="scout-prose"
              >
                {prose}
              </span>
            ) : null}
            <div className="flex flex-row flex-wrap items-center gap-3">
              {choice}
            </div>
          </div>
        </ChatMessage>
      </div>
    </div>
  );
};

export default CreateScoutStep;
