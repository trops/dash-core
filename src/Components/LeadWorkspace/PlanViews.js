import React, { useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon2,
  FontAwesomeIcon,
  ListRow,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { planTarget } from "../../utils/teamPlan";
import { estimatePlan } from "../../utils/planEstimate";
import { countsLine, createdFor, removePiece } from "../Create/planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
} from "../Create/PlanChecklistDialogs";
import {
  PlanChecklistRows,
  PlanExpect,
  PlanPieces,
  PlanSection,
  isTypeItOption,
} from "../Create/PlanParts";
import { PlanSketch } from "../Create/PlanSketch";
import { canBuild, planLine, planName, whoAsks } from "./workspacePlan";

/**
 * The plan in a workspace conversation (lead-workspace release 3a, frames 1,
 * 2, 6): a card in the chat that opens it on the right, the reply choices
 * under the lead's answer, Before it builds, and the plan itself.
 */

/** The plan as a card in the conversation: opens it on the right. */
export const PlanCard = ({ plan, onOpen }) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <div
      className={`self-start w-full max-w-md rounded-lg border ${hairline}`}
      data-testid="workspace-plan-card"
    >
      <ListRow
        icon={
          <FontAwesomeIcon
            icon="table-cells-large"
            className={`h-4 w-4 ${muted}`}
          />
        }
        title={planName(plan)}
        meta={planLine(plan)}
        onClick={onOpen}
      />
    </div>
  );
};

/**
 * Under the lead's answer: the Planner's questions as taps, or — a plan
 * ready to go — Yes, build it / Change something.
 *
 * @param {(text) => void} onSend   sends a reply to the lead
 * @param {() => void} onBuild      Yes, build it
 * @param {() => void} onChange     Change something (the reply box)
 * @param {boolean} sent            already sent to Create to build
 */
export const PlanChoices = ({
  plan,
  check,
  sent = false,
  onSend,
  onBuild,
  onChange,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  // Several questions: picks per question, sent together.
  const [picks, setPicks] = useState({});
  const questions = (plan && plan.questions) || [];
  if (questions.length) {
    const answered = questions.filter((_q, i) => picks[i]).length;
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="workspace-plan-questions"
      >
        {questions.map((q, i) => {
          const options = (Array.isArray(q.options) ? q.options : []).filter(
            Boolean,
          );
          return (
            <div
              key={i}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${hairline}`}
            >
              <span className={`text-xs ${muted}`}>
                Planner · Dash team asks
              </span>
              <span className={`text-sm font-semibold ${strong}`}>
                {q.question}
              </span>
              {options.length ? (
                <div className="flex flex-row flex-wrap gap-2">
                  {options.map((o) => (
                    <ButtonIcon2
                      key={o}
                      text={o}
                      ariaPressed={picks[i] === o}
                      selected={picks[i] === o}
                      onClick={() => {
                        // "I'll type it" isn't an answer: the reply box.
                        if (isTypeItOption(o)) {
                          onChange();
                          return;
                        }
                        if (questions.length === 1) {
                          onSend(`${q.question} — ${o}`);
                          return;
                        }
                        setPicks((p) => ({ ...p, [i]: o }));
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {questions.length > 1 ? (
          <div className="flex flex-row items-center gap-3">
            <Button
              title="Send answers"
              disabled={!answered}
              onClick={() =>
                onSend(
                  questions
                    .map((q, i) =>
                      picks[i] ? `${q.question} — ${picks[i]}` : null,
                    )
                    .filter(Boolean)
                    .join("\n"),
                )
              }
            />
            <span className={`text-sm ${muted}`}>
              {answered} of {questions.length} answered
            </span>
          </div>
        ) : null}
        <span className={`text-xs ${muted}`}>
          Or type your own answer below.
        </span>
      </div>
    );
  }
  const errors = (check && check.errors) || [];
  if (errors.length) {
    return (
      <div className="flex flex-col gap-2" data-testid="workspace-plan-broken">
        <span className={`text-sm ${muted}`}>
          The plan has a few gaps, so it can&apos;t be built yet.
        </span>
        <div>
          <Button3
            size="sm"
            title="Ask the Planner to fix it"
            onClick={() =>
              // The problems go to the lead, not into your message.
              onSend(
                "Please have the Planner fill the gaps in the plan.",
                `(What's missing, for the Planner:\n${errors
                  .map((e) => `- ${e}`)
                  .join("\n")})`,
              )
            }
          />
        </div>
      </div>
    );
  }
  if (sent) {
    return (
      <span className={`text-sm ${muted}`} data-testid="workspace-plan-sent">
        Sent to Create to build — it&apos;s in Create&apos;s Recent.
      </span>
    );
  }
  return (
    <div
      className="flex flex-row flex-wrap items-center gap-2"
      data-testid="workspace-plan-choices"
    >
      <Button title="Yes, build it" onClick={onBuild} />
      <Button3 title="Change something" onClick={onChange} />
    </div>
  );
};

/**
 * Before it builds (Create's checklist, frame 1): each item names who asks,
 * and is done here — reviewed, connected, OK'd or skipped.
 *
 * @param {object} wp  useWorkspacePlan's result
 * @param {boolean} readOnly  the lead is answering: a new plan may come
 */
export const BeforeItBuilds = ({ wp, readOnly = false }) => {
  const [dialog, setDialog] = useState(null);
  const { plan, checklist, checks, have } = wp;
  if (!plan || !checklist.length) return null;
  const done = checklist.length - wp.open;
  return (
    <>
      <PlanSection
        title={`Before it builds · ${done} of ${checklist.length} done`}
        testId="workspace-before"
      >
        <PlanChecklistRows
          checklist={checklist}
          checks={checks}
          have={have}
          providers={wp.providers}
          compact
          readOnly={readOnly}
          who={whoAsks}
          onAction={(it) =>
            it.kind === "approve"
              ? wp.setCheck(it, "done")
              : setDialog({ kind: it.kind, item: it })
          }
          onPickProvider={wp.pickProvider}
        />
      </PlanSection>
      {/* Mounted only while open: a dialog inside the workspace's window. */}
      {dialog && dialog.kind === "install" ? (
        <InstallReviewDialog
          item={dialog.item}
          onApprove={() => {
            wp.setCheck(dialog.item, "approved");
            setDialog(null);
          }}
          onSkip={() => {
            const it = dialog.item;
            const piece = (plan.pieces || [])[it.pieceIndex];
            wp.edit(
              removePiece(plan, it.pieceIndex),
              `removed ${piece ? piece.name : it.package}`,
            );
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && dialog.kind === "connect" ? (
        <ConnectDialog
          item={dialog.item}
          onSkip={() => {
            wp.setCheck(dialog.item, "skipped");
            setDialog(null);
          }}
          onClose={async (created) => {
            const it = dialog.item;
            setDialog(null);
            // A provider made in the window is the one this needed.
            const made = createdFor(created, it.providerType);
            if (made) wp.pickProvider(it, made);
            if (wp.refreshProviders) {
              try {
                await wp.refreshProviders();
              } catch (_e) {
                // the item stays open; it can be picked from the list
              }
            }
          }}
        />
      ) : null}
    </>
  );
};

/**
 * The plan, opened on the right: what it makes, a sketch, what to expect —
 * and Yes, build it, so it can be built whatever the chat ended on.
 */
export const PlanOutput = ({ wp, readOnly = false, onBuild = null }) => {
  const { muted, strong } = useConfigTokens();
  const { plan } = wp;
  if (!plan) return null;
  const target = planTarget(plan);
  const pieces = plan.pieces || [];
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-plan-output">
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${muted}`}>Planner · the plan</span>
        <span className={`text-lg font-semibold ${strong}`}>
          {planName(plan)}
        </span>
        {plan.summary ? <span className="text-sm">{plan.summary}</span> : null}
        <span className={`text-sm ${muted}`}>
          {countsLine(plan) || "Nothing to make yet"} · nothing is made until
          you say yes
        </span>
      </div>
      {pieces.length ? (
        <>
          <PlanPieces
            plan={plan}
            target={target}
            readOnly={readOnly}
            onEdit={wp.edit}
          />
          {target ? null : <PlanSketch plan={plan} compact />}
          <PlanExpect plan={plan} estimate={estimatePlan(plan, {})} />
        </>
      ) : null}
      {readOnly ? (
        <span className={`text-sm ${muted}`}>
          The Dash Lead is answering — the plan may change.
        </span>
      ) : wp.sent ? (
        <span className={`text-sm ${muted}`} data-testid="workspace-plan-sent">
          Sent to Create to build — it&apos;s in Create&apos;s Recent.
        </span>
      ) : onBuild && canBuild({ plan, check: wp.check }) ? (
        <div>
          <Button title="Yes, build it" onClick={onBuild} />
        </div>
      ) : null}
    </div>
  );
};
