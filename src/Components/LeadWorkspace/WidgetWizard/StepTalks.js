import React, { useState } from "react";
import {
  Button,
  Button2,
  Checkbox,
  FontAwesomeIcon,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { TextLink } from "./TextLink";
import { AnswerPart, WizardAnswer } from "./WizardAnswer";
import {
  listenChoices,
  proposedSends,
  silentBots,
  standardSends,
} from "./widgetSpec";

const EventName = ({ name }) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <span
      className={`flex-shrink-0 rounded-md border px-2 font-mono text-xs ${hairline} ${muted}`}
    >
      {name}
    </span>
  );
};

/**
 * Step 3 · Talks to (the approved "talks-step" frame): what every widget
 * sends (Dash's own three, always on), what this one also sends (the
 * Planner's proposals, ticked; untick any), and which of the dashboard's
 * bots' results it shows. Nothing is a fine answer.
 *
 * @param {object} plannedPiece  the widget as the Planner made it
 * @param {object} piece         the widget with what was chosen
 * @param {string[]} eventsOff   events the user unticked
 * @param {Array|null} botEmitters  the dashboard's bots (null: loading)
 * @param {boolean} hasDashboard  false: not on a dashboard, so no bots
 * @param {string} dashboardName
 * @param {string} readsFrom     "Google Calendar"
 * @param {({ eventsOff, listens }) => void} onNext
 * @param {() => void} onBack
 * @param {() => void} onDescribe  something else, said in the chat
 */
/**
 * The Planner's question for step 3, for its chat bubble.
 */
export const talksQuestion = (piece, eventsOff = [], dashboardName = "") => {
  const n = proposedSends(piece, eventsOff).length;
  const where = dashboardName ? ` on ${dashboardName}` : "";
  return {
    question: "Should it tell other widgets when something happens?",
    why: n
      ? `Other widgets and bots${where} can react to it. I suggest ${
          n === 1 ? "one" : n
        } — keep ${n === 1 ? "it" : "them"} or untick. Nothing is a fine answer.`
      : `Other widgets and bots${where} can react to it. Nothing is a fine answer.`,
  };
};

export const StepTalks = ({
  plannedPiece,
  piece,
  eventsOff = [],
  botEmitters = null,
  hasDashboard = true,
  dashboardName = "",
  readsFrom = "",
  onNext,
  onBack,
  onDescribe,
  readOnly = false,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const sends = proposedSends(plannedPiece || piece, eventsOff);
  const [on, setOn] = useState(() =>
    sends.filter((s) => s.on).map((s) => s.event),
  );
  const choices = listenChoices(botEmitters);
  const silent = silentBots(botEmitters);
  const [listening, setListening] = useState(() =>
    (Array.isArray(piece.listens) ? piece.listens : [])
      .map((l) => l && l.botId && `${l.botId}:${l.result}`)
      .filter(Boolean),
  );
  const toggle = (set, key) => (yes) =>
    set((cur) =>
      yes
        ? [...cur.filter((x) => x !== key), key]
        : cur.filter((x) => x !== key),
    );
  const next = () =>
    onNext({
      eventsOff: sends.map((s) => s.event).filter((e) => !on.includes(e)),
      // The bots not known yet: what it listens for stays as it is.
      listens:
        botEmitters === null
          ? Array.isArray(piece.listens)
            ? piece.listens
            : []
          : choices
              .filter((c) => listening.includes(c.key))
              .map(({ bot, botId, ref, result, handler }) => ({
                bot,
                botId,
                ref,
                result,
                handler,
              })),
    });
  const where = dashboardName || "this dashboard";
  const [showAlways, setShowAlways] = useState(false);
  const row = `flex flex-row items-start gap-3 rounded-lg border px-3 py-2 ${hairline}`;
  return (
    <WizardAnswer
      testId="wizard-talks"
      actions={
        <>
          <Button title="Next: looks" disabled={readOnly} onClick={next} />
          <Button2 title="Back" disabled={readOnly} onClick={onBack} />
        </>
      }
    >
      <AnswerPart
        first
        title="It sends"
        note={sends.length ? "suggested; untick any" : null}
      >
        {sends.length ? (
          sends.map((s) => (
            <div key={s.event} className={row} data-testid="talks-sends">
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="flex flex-row flex-wrap items-center gap-2">
                  <Checkbox
                    label={s.when}
                    checked={on.includes(s.event)}
                    disabled={readOnly}
                    onChange={toggle(setOn, s.event)}
                  />
                  <EventName name={s.event} />
                </span>
                {s.carries ? (
                  <span className={`text-xs ${muted}`}>
                    Carries: {s.carries}
                  </span>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <span className={`text-sm ${muted}`}>
            Nothing of its own was proposed.
          </span>
        )}
      </AnswerPart>
      <AnswerPart
        title="It listens for"
        note={`what the bots on ${where} send`}
      >
        {botEmitters === null ? (
          <span className={`text-sm ${muted}`}>Looking for its bots…</span>
        ) : choices.length ? (
          choices.map((c) => (
            <div key={c.key} className={row} data-testid="talks-listens">
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <Checkbox
                  label={`${c.bot}'s ${c.label}`}
                  checked={listening.includes(c.key)}
                  disabled={readOnly}
                  onChange={toggle(setListening, c.key)}
                />
                <span className={`text-xs ${muted}`}>
                  Shows it in the widget each time {c.bot} sends one.
                </span>
              </span>
            </div>
          ))
        ) : (
          <span className={`text-sm ${muted}`}>
            {!hasDashboard
              ? "It isn't on a dashboard yet — once it is, it can show what that dashboard's bots send."
              : silent.length
                ? `The bots on ${where} (${silent.join(", ")}) send no results a widget could show.`
                : `Nothing yet — there are no bots on ${where}.`}
          </span>
        )}
        <span className={`text-sm ${muted}`}>
          Something else?{" "}
          <TextLink
            title="Describe it"
            disabled={readOnly}
            onClick={onDescribe}
          />{" "}
          — the Planner adds it.
        </span>
      </AnswerPart>
      {/* Sent by every widget, by Dash itself: one quiet line, open to see. */}
      <AnswerPart>
        <span className={`flex flex-row items-start gap-2 text-xs ${muted}`}>
          <FontAwesomeIcon
            icon="lock"
            className={`h-3 w-3 mt-0.5 flex-shrink-0 ${statusTokens.success.icon}`}
            aria-label="Always on"
          />
          <span className="flex-1">
            Every widget also says when it has read, is on screen, or can&apos;t
            read — nothing to set up.{" "}
            <TextLink
              title={showAlways ? "Hide" : "Show"}
              onClick={() => setShowAlways((v) => !v)}
            />
          </span>
        </span>
        {showAlways
          ? standardSends(readsFrom).map((s) => (
              <div key={s.event} className={row} data-testid="talks-always">
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="flex flex-row flex-wrap items-center gap-2">
                    <span className={`text-sm ${strong}`}>{s.when}</span>
                    <EventName name={s.event} />
                  </span>
                  <span className={`text-xs ${muted}`}>
                    Carries: {s.carries}
                  </span>
                </span>
              </div>
            ))
          : null}
      </AnswerPart>
    </WizardAnswer>
  );
};

export default StepTalks;
