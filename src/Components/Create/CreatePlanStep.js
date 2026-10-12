import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  SectionLabel,
  TextArea,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runTeamRole } from "../../utils/teamRoles";
import { extractPlan, validatePlan } from "../../utils/teamPlan";
import { estimatePlan, describeEstimate } from "../../utils/planEstimate";
import { runCostLabel, usageTokens } from "../../utils/runCostLabel";
import {
  buildChecklist,
  buildButtonLabel,
  countsLine,
  editNote,
  isDone,
  nextOpen,
  providerTypesOf,
  removePiece,
  swapPiece,
} from "./planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
  SwapPicker,
} from "./PlanChecklistDialogs";
import { CreateBuildingStep } from "./CreateBuildingStep";

/**
 * CreatePlanStep — Type: Dashboard (create-entry PRD CRE-003 AC1/AC5,
 * CRE-012 AC1/AC2, team-dashboards TD-007; phase 4a). A conversation with the
 * Dash team's Planner: it asks a few questions as tappable answers, then
 * hands back a plan — bots, widgets and layout tagged by where each comes
 * from, what's needed before building, how to tell it worked, what the bots
 * can and can't do, and an estimate. Nothing is built here (building is 4d).
 *
 * Before building (4b): each install is reviewed and approved, each missing
 * provider connected (in a window over Create), other steps OK'd. The Build
 * button names what's still open and walks through it. Pieces can be swapped
 * (the Scout finds alternatives) or removed; those edits ride along with the
 * next message so the Planner keeps them.
 *
 * Each reply continues the Planner's session, so it remembers the answers.
 */

const SOURCE_TAG = {
  yours: "Yours",
  "ai-built": "AI-built",
  registry: "Registry · install",
  new: "New",
  update: "Update",
};
const GROUPS = [
  ["bot", "Bots"],
  ["widget", "Widgets"],
  ["layout", "Layout"],
];
/** The Planner's words without its <plan> block. */
export function withoutPlan(text) {
  return String(text || "")
    .replace(/<plan>[\s\S]*?<\/plan>/gi, "")
    .trim();
}

function isHandoff(event) {
  return (
    event &&
    event.type === "tool_call" &&
    /(^|__)ask_role$/.test(String(event.name || ""))
  );
}

export const CreatePlanStep = ({ prompt, onOpenDashboard = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const app = useContext(AppContext) || {};
  // [{ who: "you" | "planner" | "note", text, meta? }]
  const [messages, setMessages] = useState([{ who: "you", text: prompt }]);
  const [busy, setBusy] = useState(true);
  const [soFar, setSoFar] = useState("");
  const [plan, setPlan] = useState(null);
  const [planningTokens, setPlanningTokens] = useState(0);
  const [team, setTeam] = useState([]);
  const [reply, setReply] = useState("");
  // Several questions: picks per question, sent together ({ index: option }).
  const [picks, setPicks] = useState({});
  // Before building: { [item.id]: "approved" | "done" }, panel edits not yet
  // told to the Planner, the open window, the piece being swapped, and
  // whether Build is walking through the open items.
  const [checks, setChecks] = useState({});
  const [edits, setEdits] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [swapIndex, setSwapIndex] = useState(null);
  const [walking, setWalking] = useState(false);
  const [ready, setReady] = useState(false);
  // The running build (4d): { buildId, state } once Build starts.
  const [build, setBuild] = useState(null);
  const [buildError, setBuildError] = useState(null);
  const started = useRef(false);
  const alive = useRef(true);

  const ask = async (text, continueConversation) => {
    setBusy(true);
    setSoFar("");
    const res = await runTeamRole("planner", text, {
      continueConversation,
      onText: (t) => alive.current && setSoFar(t),
      onEvent: (event) => {
        if (!alive.current || !isHandoff(event)) return;
        const role = (event.input && event.input.role) || "team";
        setMessages((m) => [
          ...m,
          {
            who: "note",
            text: `Planner asked the ${role.charAt(0).toUpperCase()}${role.slice(1)}…`,
          },
        ]);
      },
    });
    if (!alive.current) return;
    setBusy(false);
    setSoFar("");
    if (res.skipped) {
      setMessages((m) => [
        ...m,
        {
          who: "note",
          text: `Can't plan right now: ${res.reason}. Resume the Planner on the Bots page › Dash team.`,
        },
      ]);
      return;
    }
    if (res.status === "failed") {
      setMessages((m) => [
        ...m,
        {
          who: "note",
          text: `The Planner couldn't answer: ${res.error || "unknown error"}`,
        },
      ]);
      return;
    }
    setPlanningTokens((n) => n + usageTokens(res.usage));
    const found = extractPlan(res.output);
    if (found) {
      setPlan(found);
      setSwapIndex(null);
      setReady(false);
    }
    setMessages((m) => [
      ...m,
      {
        who: "planner",
        text:
          withoutPlan(res.output) || (found ? found.summary : "(no answer)"),
        meta: runCostLabel(res),
      },
    ]);
  };

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      ask(prompt, false);
      if (window.mainApi?.bots?.listDashTeam) {
        Promise.resolve(window.mainApi.bots.listDashTeam())
          .then((t) => alive.current && setTeam(Array.isArray(t) ? t : []))
          .catch(() => {});
      }
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = (text) => {
    const t = String(text || "").trim();
    if (!t || busy) return;
    setMessages((m) => [...m, { who: "you", text: t }]);
    setReply("");
    setPicks({});
    const note = editNote(edits);
    setEdits([]);
    ask(note ? `${note}\n${t}` : t, true);
  };

  // One question: a tap answers it. Several: taps mark answers, then send.
  const pick = (qs, i, option) => {
    if (qs.length === 1) {
      answer(`${qs[0].question} — ${option}`);
      return;
    }
    setPicks((p) => ({ ...p, [i]: option }));
  };
  const sendPicks = (qs) =>
    answer(
      qs
        .map((q, i) => (picks[i] ? `${q.question} — ${picks[i]}` : null))
        .filter(Boolean)
        .join("\n"),
    );

  const questions = (plan && plan.questions) || [];
  const pieces = (plan && plan.pieces) || [];
  const check = plan ? validatePlan(plan) : null;
  const estimate =
    plan && pieces.length ? estimatePlan(plan, { team, planningTokens }) : null;
  const have = providerTypesOf(app.providers);
  const checklist = plan ? buildChecklist(plan, have) : [];

  // Nothing open: build it (4d). Approving here is the consent — nothing
  // asks again during the build.
  const startBuild = async () => {
    setReady(true);
    setBuildError(null);
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.startPlanBuild) {
      setBuildError("Building from a plan isn't available in this version.");
      return;
    }
    try {
      const res = await bots.startPlanBuild(plan, {});
      if (!res || res.error) {
        setBuildError((res && res.error) || "The build couldn't start.");
        return;
      }
      setBuild(res);
    } catch (err) {
      setBuildError((err && err.message) || "The build couldn't start.");
    }
  };
  const openItem = (item) => {
    if (!item) {
      setWalking(false);
      startBuild();
      return;
    }
    setDialog({ kind: item.kind, item });
  };
  // Build walks through what's open, one window at a time (CRE-003 AC3).
  const buildPlan = () => {
    setWalking(true);
    openItem(nextOpen(checklist, checks, have));
  };
  const finish = (
    item,
    status,
    nextChecks = { ...checks, [item.id]: status },
  ) => {
    setChecks(nextChecks);
    setDialog(null);
    if (walking) {
      const rest = checklist.filter((it) => it.id !== item.id);
      openItem(nextOpen(rest, nextChecks, have));
    }
  };
  const editPlan = (nextPlan, note) => {
    setPlan(nextPlan);
    setEdits((e) => [...e, note]);
    setReady(false);
  };

  if (build) {
    return (
      <CreateBuildingStep
        buildId={build.buildId}
        initialState={build.state}
        estimate={estimate}
        onOpenDashboard={onOpenDashboard}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="create-plan">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-4 px-6 py-8">
          {messages.map((m, i) =>
            m.who === "you" ? (
              <div
                key={i}
                className={`self-end max-w-xl rounded-lg border px-4 py-3 text-sm ${hairline} ${strong}`}
              >
                {m.text}
              </div>
            ) : m.who === "note" ? (
              <span key={i} className={`text-xs ${muted}`}>
                {m.text}
              </span>
            ) : (
              <div
                key={i}
                className="flex flex-col gap-1"
                data-testid="planner-message"
              >
                <div className="flex flex-row items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    Planner
                  </span>
                  {m.meta ? (
                    <span className={`text-xs ${muted}`}>{m.meta}</span>
                  ) : null}
                </div>
                <p className="text-sm whitespace-pre-wrap">{m.text}</p>
              </div>
            ),
          )}

          {busy ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider">
                Planner
              </span>
              <p className={`text-sm whitespace-pre-wrap ${muted}`}>
                {withoutPlan(soFar) || "Thinking…"}
              </p>
            </div>
          ) : null}

          {!busy && questions.length ? (
            <div className="flex flex-col gap-3" data-testid="plan-questions">
              {questions.map((q, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${hairline}`}
                >
                  <span className={`text-sm font-medium ${strong}`}>
                    {q.question}
                  </span>
                  {Array.isArray(q.options) && q.options.length ? (
                    <div className="flex flex-row flex-wrap gap-2">
                      {q.options.map((o) =>
                        picks[i] === o ? (
                          <Button
                            key={o}
                            title={o}
                            size="sm"
                            onClick={() => pick(questions, i, o)}
                          />
                        ) : (
                          <Button3
                            key={o}
                            title={o}
                            size="sm"
                            onClick={() => pick(questions, i, o)}
                          />
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
              {questions.length > 1 ? (
                <div className="flex flex-row items-center gap-3">
                  <Button
                    title="Send answers"
                    onClick={() => sendPicks(questions)}
                    disabled={!Object.keys(picks).length}
                  />
                  <span className={`text-xs ${muted}`}>
                    {Object.keys(picks).length} of {questions.length} answered —
                    or type below
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {plan && pieces.length ? (
            <div
              className={`flex flex-col gap-4 rounded-lg border p-5 ${hairline}`}
              data-testid="plan-card"
            >
              <span className={`text-lg font-semibold ${strong}`}>
                {plan.summary}
              </span>
              <span className={`text-sm ${muted}`} data-testid="plan-counts">
                {countsLine(plan)}
              </span>

              {GROUPS.map(([kind, label]) => {
                const group = pieces.filter((p) => p && p.kind === kind);
                if (!group.length) return null;
                return (
                  <div key={kind} className="flex flex-col gap-2">
                    <SectionLabel text={label} />
                    {group.map((p) => {
                      const index = pieces.indexOf(p);
                      return (
                        <div key={index} className="flex flex-col gap-2">
                          <div className="flex flex-row items-center gap-3 text-sm">
                            <span
                              className={`text-xs font-semibold uppercase tracking-wider flex-shrink-0 ${muted}`}
                            >
                              {SOURCE_TAG[p.source] || p.source}
                            </span>
                            <span className="flex-1 min-w-0 flex flex-col">
                              <span
                                className={`font-medium truncate ${strong}`}
                              >
                                {p.name}
                              </span>
                              <span className={`text-xs truncate ${muted}`}>
                                {[
                                  p.package,
                                  (p.providers || []).join(", "),
                                  p.notes,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            {p.kind === "widget" ? (
                              <Button3
                                title="Swap…"
                                size="sm"
                                onClick={() => setSwapIndex(index)}
                              />
                            ) : null}
                            <Button3
                              title="Remove"
                              size="sm"
                              onClick={() =>
                                editPlan(
                                  removePiece(plan, index),
                                  `removed ${p.name}`,
                                )
                              }
                            />
                          </div>
                          {swapIndex === index ? (
                            <SwapPicker
                              piece={p}
                              onCancel={() => setSwapIndex(null)}
                              onPick={(m) => {
                                setSwapIndex(null);
                                editPlan(
                                  swapPiece(plan, index, m),
                                  m.source === "New"
                                    ? `build ${p.name} new`
                                    : `swapped ${p.name} for ${m.name}`,
                                );
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {checklist.length ? (
                <div className="flex flex-col gap-2" data-testid="plan-before">
                  <SectionLabel text="Before building" />
                  {checklist.map((it) => {
                    const done = isDone(it, checks, have);
                    return (
                      <div
                        key={it.id}
                        className="flex flex-row items-center gap-3 text-sm"
                        data-testid="checklist-item"
                      >
                        <span className={`flex-1 min-w-0 ${done ? muted : ""}`}>
                          {done ? "✓ " : ""}
                          {it.label}
                          {it.package ? (
                            <span className={`text-xs ${muted}`}>
                              {" "}
                              · {it.package}
                            </span>
                          ) : null}
                        </span>
                        {done ? null : (
                          <Button3
                            title={
                              it.kind === "install"
                                ? "Review & approve"
                                : it.kind === "connect"
                                  ? "Connect"
                                  : "OK"
                            }
                            size="sm"
                            onClick={() =>
                              it.kind === "approve"
                                ? finish(it, "done")
                                : openItem(it)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {(plan.access || []).length ? (
                <div className="flex flex-col gap-1" data-testid="plan-access">
                  <SectionLabel text="What it can and can't do" />
                  {plan.access.map((a, i) => (
                    <span key={i} className="text-sm">
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}

              {(plan.checks || []).length ? (
                <div className="flex flex-col gap-1">
                  <SectionLabel text="How we'll know it works" />
                  <span className="text-sm">{plan.checks.join(" · ")}</span>
                </div>
              ) : null}

              <div className="flex flex-col gap-1" data-testid="plan-estimate">
                <SectionLabel text="Estimated cost" />
                <span className="text-sm">
                  To build: {describeEstimate(estimate)}
                </span>
                {plan.estimate && plan.estimate.running ? (
                  <span className="text-sm">
                    To run: {plan.estimate.running}
                  </span>
                ) : null}
              </div>

              {check && check.errors.length ? (
                <span className={`text-xs ${muted}`}>
                  The plan isn't complete yet: {check.errors.join(" ")}
                </span>
              ) : null}
              <div className="flex flex-row flex-wrap items-center gap-3">
                <Button
                  title={buildButtonLabel(checklist, checks, have)}
                  onClick={buildPlan}
                />
                <span className={`text-xs ${muted}`} data-testid="plan-ready">
                  {buildError
                    ? buildError
                    : ready
                      ? "Starting the build…"
                      : "Nothing has been built or installed yet."}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {dialog && dialog.kind === "install" ? (
        <InstallReviewDialog
          item={dialog.item}
          onApprove={() => finish(dialog.item, "approved")}
          onSkip={() => {
            const it = dialog.item;
            const piece = pieces[it.pieceIndex];
            editPlan(
              removePiece(plan, it.pieceIndex),
              `removed ${piece ? piece.name : it.package}`,
            );
            setDialog(null);
            setWalking(false);
          }}
          onClose={() => {
            setDialog(null);
            setWalking(false);
          }}
        />
      ) : null}
      {dialog && dialog.kind === "connect" ? (
        <ConnectDialog
          item={dialog.item}
          onClose={async () => {
            const it = dialog.item;
            setDialog(null);
            if (app.refreshProviders) {
              try {
                await app.refreshProviders();
              } catch (_e) {
                // keep going; the item stays open
              }
            }
            // Walk on only if it really got connected (no loop otherwise).
            setWalking(false);
            void it;
          }}
        />
      ) : null}
      {dialog && dialog.kind === "approve" ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => {
            setDialog(null);
            setWalking(false);
          }}
          title="Before building"
          message={dialog.item.label}
          confirmLabel="OK"
          onConfirm={() => finish(dialog.item, "done")}
          onCancel={() => {
            setDialog(null);
            setWalking(false);
          }}
        />
      ) : null}

      <div className={`flex-shrink-0 border-t ${hairline}`}>
        <div className="mx-auto w-full max-w-3xl flex flex-row items-end gap-2 px-6 py-3">
          <div className="flex-1">
            <TextArea
              aria-label="Reply to the Planner"
              value={reply}
              onChange={(v) => setReply(v)}
              placeholder={
                busy ? "The Planner is working…" : "Answer, or ask for changes…"
              }
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  answer(reply);
                }
              }}
            />
          </div>
          <Button
            title="Send"
            onClick={() => answer(reply)}
            disabled={busy || !reply.trim()}
          />
        </div>
      </div>
    </div>
  );
};

export default CreatePlanStep;
