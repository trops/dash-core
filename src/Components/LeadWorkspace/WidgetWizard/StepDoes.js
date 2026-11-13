import React, { useCallback, useRef, useState } from "react";
import { Button, Button2, Checkbox, SegmentedControl } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { SettingsEditor } from "./StepReview";
import { TextLink } from "./TextLink";
import { AnswerPart, WizardAnswer } from "./WizardAnswer";
import { offeredChanges, readNotice, settingBounds } from "./askChecks";
import { readsFromLabel, refreshChoices } from "./widgetSpec";

/**
 * The Planner's question for step 2, for its chat bubble.
 */
export const doesQuestion = (piece, providers = [], live = null) => {
  const from = readsFromLabel(piece, providers) || "its provider";
  return offeredChanges(piece, providers, live).length
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
 * @param {object} live         the provider's running tools (useLiveTools):
 *   checked before it's asked — only actions it really has, a reading
 *   tool that can change things said here, settings held to their tool
 */
export const StepDoes = ({
  piece,
  providers = [],
  onNext,
  onBack,
  readOnly = false,
  live = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const tools = offeredChanges(piece, providers, live);
  const notice = readNotice(piece, providers, live);
  const bounds = settingBounds(piece, providers, live);
  const [valid, setValid] = useState(true);
  const onValidity = useCallback((v) => setValid(v), []);
  const checking = !!live && live.status === "reading";
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
      // Only what it offers now (a tool it doesn't have is never kept).
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
          <Button
            title="Next: talks to"
            disabled={readOnly || !valid}
            onClick={next}
          />
          <Button2 title="Back" disabled={readOnly} onClick={onBack} />
        </>
      }
    >
      {notice.map((n) => (
        <div
          key={n.tool}
          className={`flex flex-row items-start gap-3 rounded-xl border px-3 py-2 ${hairline}`}
          data-testid="does-read-notice"
        >
          <span className={`text-xs font-bold mt-0.5 ${muted}`}>i</span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className={`text-sm font-semibold ${strong}`}>
              To read, it has to use {n.tool}
            </span>
            <span className={`text-xs ${muted}`}>
              {n.kind === "change"
                ? "That tool can also change things."
                : "That tool doesn't say whether it changes things."}{" "}
              With nothing ticked below, the widget only ever calls it to read —
              the Checker checks that.
            </span>
          </span>
        </div>
      ))}
      <AnswerPart first title="Buttons in the widget">
        {checking ? (
          <span className={`text-xs ${muted}`}>
            Checking what {from} can do…
          </span>
        ) : null}
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
        ) : checking ? null : (
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
          bounds={bounds}
          onValidity={onValidity}
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
