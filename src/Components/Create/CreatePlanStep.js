import React, { useEffect, useRef, useState } from "react";
import { Button, Button3, SectionLabel, TextArea } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runTeamRole } from "../../utils/teamRoles";
import { extractPlan, validatePlan } from "../../utils/teamPlan";
import { estimatePlan, describeEstimate } from "../../utils/planEstimate";
import { runCostLabel, usageTokens } from "../../utils/runCostLabel";

/**
 * CreatePlanStep — Type: Dashboard (create-entry PRD CRE-003 AC1/AC5,
 * CRE-012 AC1/AC2, team-dashboards TD-007; phase 4a). A conversation with the
 * Dash team's Planner: it asks a few questions as tappable answers, then
 * hands back a plan — bots, widgets and layout tagged by where each comes
 * from, what's needed before building, how to tell it worked, what the bots
 * can and can't do, and an estimate. Nothing is built here (building is 4d).
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
const BEFORE_LABEL = {
  connect: "Connect",
  install: "Install",
  approve: "Approve",
};

/** "Install @x" when the step reads "Install @x from …" already. */
function startsWithLabel(b) {
  const label = String(BEFORE_LABEL[b.kind] || b.kind || "").toLowerCase();
  return String(b.what || "")
    .trim()
    .toLowerCase()
    .startsWith(label);
}

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

export const CreatePlanStep = ({ prompt }) => {
  const { muted, strong, hairline } = useConfigTokens();
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
    if (found) setPlan(found);
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
    ask(t, true);
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

              {GROUPS.map(([kind, label]) => {
                const group = pieces.filter((p) => p && p.kind === kind);
                if (!group.length) return null;
                return (
                  <div key={kind} className="flex flex-col gap-2">
                    <SectionLabel text={label} />
                    {group.map((p, i) => (
                      <div
                        key={i}
                        className="flex flex-row items-center gap-3 text-sm"
                      >
                        <span
                          className={`text-xs font-semibold uppercase tracking-wider flex-shrink-0 ${muted}`}
                        >
                          {SOURCE_TAG[p.source] || p.source}
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col">
                          <span className={`font-medium truncate ${strong}`}>
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
                      </div>
                    ))}
                  </div>
                );
              })}

              {(plan.beforeBuilding || []).length ? (
                <div className="flex flex-col gap-1" data-testid="plan-before">
                  <SectionLabel text="Before building" />
                  {plan.beforeBuilding.map((b, i) => (
                    <span key={i} className="text-sm">
                      {startsWithLabel(b) ? null : (
                        <span className={`font-medium ${strong}`}>
                          {(BEFORE_LABEL[b.kind] || b.kind) + " "}
                        </span>
                      )}
                      {b.what}
                    </span>
                  ))}
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
              <span className={`text-xs ${muted}`}>
                Nothing has been built or installed. Building from a plan comes
                next — ask for changes below.
              </span>
            </div>
          ) : null}
        </div>
      </div>

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
