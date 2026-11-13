import React, { useRef, useState } from "react";
import { Button, Button2, Checkbox, SegmentedControl } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { SettingsEditor } from "./StepReview";
import { TextLink } from "./TextLink";
import { AnswerPart, WizardAnswer } from "./WizardAnswer";
import { changeTools, readsFromLabel, refreshChoices } from "./widgetSpec";

/**
 * The Planner's question for step 2, for its chat bubble.
 */
export const doesQuestion = (piece, providers = []) => {
  const from = readsFromLabel(piece, providers) || "its provider";
  return changeTools(piece, providers).length
    ? {
        question: `Can it change anything on ${from}?`,
        why: "Each one you tick becomes a button in the widget, and asks you before it first changes anything. Then the settings it starts with, and how often it reads.",
      }
    : {
        question: "What should it start with?",
        why: `${from.charAt(0).toUpperCase()}${from.slice(1)} has nothing a widget could change with — it will only read. These are the settings it starts with, and how often it reads.`,
      };
};

/**
 * Step 2 · What it does (the approved "does" frame): can it change things
 * — the actions its provider allows, each a tick; the settings it starts
 * with, as a table; how often it reads again. The Planner's proposals start
 * ticked; nothing is kept until Next.
 *
 * @param {object} piece        the wizard's widget (with what was chosen)
 * @param {Array} providers     the user's providers (providers.json)
 * @param {({ changes, settings, refresh }) => void} onNext
 * @param {() => void} onBack   back to Reads from
 */
export const StepDoes = ({
  piece,
  providers = [],
  onNext,
  onBack,
  readOnly = false,
}) => {
  const { muted } = useConfigTokens();
  const tools = changeTools(piece, providers);
  const from = readsFromLabel(piece, providers) || "Its provider";
  const [ticked, setTicked] = useState(() =>
    (Array.isArray(piece.changes) ? piece.changes : []).filter((t) =>
      tools.some((x) => x.tool === t),
    ),
  );
  // The actions about what it reads, and any ticked; the provider's others
  // behind a link.
  const [showOthers, setShowOthers] = useState(false);
  const others = tools.filter((t) => !t.related && !ticked.includes(t.tool));
  const shown = tools.filter((t) => showOthers || !others.includes(t));
  const refresh = refreshChoices(piece);
  const [every, setEvery] = useState(refresh.value);
  // The table applies what was typed (settingsDone) into taken.
  const settingsDone = useRef(null);
  const taken = useRef(null);
  const settings =
    piece.settings && typeof piece.settings === "object" ? piece.settings : {};
  const next = () => {
    taken.current = null;
    if (settingsDone.current) settingsDone.current();
    onNext({
      changes: tools.map((t) => t.tool).filter((t) => ticked.includes(t)),
      settings: taken.current || settings,
      refresh: every,
    });
  };
  return (
    <WizardAnswer
      testId="wizard-does"
      actions={
        <>
          <Button title="Next: talks to" disabled={readOnly} onClick={next} />
          <Button2 title="Back" disabled={readOnly} onClick={onBack} />
        </>
      }
    >
      <AnswerPart first title="Buttons in the widget">
        {tools.length ? (
          <div
            className="flex flex-row flex-wrap gap-3"
            data-testid="does-acts"
          >
            {shown.map((t) => (
              <Checkbox
                key={t.tool}
                label={t.label}
                checked={ticked.includes(t.tool)}
                disabled={readOnly}
                onChange={(on) =>
                  setTicked((cur) =>
                    on
                      ? [...cur.filter((x) => x !== t.tool), t.tool]
                      : cur.filter((x) => x !== t.tool),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>
            None — {from} has nothing a widget could change with.
          </span>
        )}
        {others.length ? (
          <div>
            <TextLink
              title={
                showOthers
                  ? "Hide the other actions"
                  : `Show ${others.length} other ${others.length === 1 ? "action" : "actions"}`
              }
              onClick={() => setShowOthers((v) => !v)}
            />
          </div>
        ) : null}
      </AnswerPart>
      <AnswerPart
        title="Settings you can change later"
        note="no rebuild needed"
      >
        <SettingsEditor
          settings={settings}
          doneRef={settingsDone}
          onDone={(value) => {
            taken.current = value;
          }}
        />
      </AnswerPart>
      <AnswerPart title="How often it reads">
        <div>
          <SegmentedControl
            ariaLabel="How often it reads again"
            value={every}
            onChange={(v) => setEvery(v)}
            options={refresh.options.map((o) => ({ value: o, label: o }))}
          />
        </div>
      </AnswerPart>
    </WizardAnswer>
  );
};

export default StepDoes;
