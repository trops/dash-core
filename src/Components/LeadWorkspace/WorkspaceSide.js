import React, { useEffect, useState } from "react";
import { Button3, FontAwesomeIcon, ListRow } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { DashTeamApprovals } from "../Bots/DashTeamApprovals";
import { toolName } from "./handoffSteps";
import { BeforeItBuilds, PlanOutput } from "./PlanViews";
import { planName, planStatus } from "./workspacePlan";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// "gmail_search_messages" → "gmail search messages"; the team's own
// tools in words.
const TOOL_WORDS = {
  team_ask_bot: "asking a bot",
  team_recent_runs: "reading what the bots did",
  team_list_bots: "looking at the team",
  team_memory_read: "reading the team's notes",
  ask_role: "asking a role",
  search_library: "searching widgets",
};
function plainTool(name) {
  const t = toolName(name);
  return TOOL_WORDS[t] || t.replace(/[_-]+/g, " ");
}

// "the Scout's answer" → "The Scout's answer" at the start of a title.
const cap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());

const norm = (name) =>
  String(name || "")
    .replace(/^the /i, "")
    .trim()
    .toLowerCase();

/**
 * What each bot is doing right now — one line, from its stream: the tool
 * it's calling, or that it's writing. Cleared when its run ends.
 */
function useLiveLines(botIds) {
  const [lines, setLines] = useState({});
  const key = (botIds || []).join(",");
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.onStream) return undefined;
    const want = new Set(key ? key.split(",") : []);
    const id = b.onStream(({ botId, event } = {}) => {
      if (!want.has(botId) || !event) return;
      let line = null;
      if (event.type === "tool_call") line = `› ${plainTool(event.name)}`;
      else if (event.type === "text") line = "writing its answer…";
      else if (event.type === "done" || event.type === "error") line = "";
      if (line === null) return;
      setLines((cur) => ({ ...cur, [botId]: line }));
    });
    return () => {
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, [key]);
  return lines;
}

/** A lone bot's latest runs, kept current as runs start and end. */
function useRuns(botId) {
  const [runs, setRuns] = useState([]);
  useEffect(() => {
    const b = botsApi();
    if (!b || !botId || !b.getRuns) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.getRuns(botId, 10))
        .then((r) => alive && setRuns(Array.isArray(r) ? r : []))
        .catch(() => {});
    load();
    const id = b.onRunActive ? b.onRunActive(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, [botId]);
  return runs;
}

const TRIGGER_WORDS = {
  schedule: "on its schedule",
  event: "on an event",
  manual: "you asked",
  reply: "you asked",
  ask: "asked",
};

function shortTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * WorkspaceSide — the workspace's right column (lead-workspace release 2):
 * Needs you (the team's approvals), Outputs (what the team answered), and
 * Team in this conversation (each bot: whether it was asked, a live line
 * while it works, its answer). A lone bot shows its runs instead.
 *
 * @param {object} contact     workspaceContacts' contact
 * @param {object[]} messages  the conversation (AskStep's), with its steps
 * @param {(id) => string} statusOf  "Running" | "Paused" | "Idle" | …
 * @param {object|null} wp    the conversation's plan (useWorkspacePlan)
 * @param {boolean} planReadOnly  the lead is answering: a new plan may come
 * @param {() => void} onBuild  Yes, build it
 * @param {string|null} open  what's opened: "plan", a step's id, or null
 * @param {(what) => void} onOpen
 * @param {boolean} wide, onToggleWide  the column's size
 */
export const WorkspaceSide = ({
  contact,
  messages = [],
  statusOf = () => "Idle",
  wp = null,
  planReadOnly = false,
  onBuild = null,
  open = null,
  onOpen = () => {},
  wide = false,
  onToggleWide = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const members = (contact && contact.members) || [];
  const lines = useLiveLines(members.map((m) => m.id));
  const runs = useRuns(
    contact && contact.kind === "bot" ? contact.botId : null,
  );
  const steps = (messages || []).filter((m) => m && m.who === "step");

  // A step opened from Outputs or a bot's row: the latest version of it.
  const plan = wp && wp.plan ? wp.plan : null;
  const back = (
    <div className="flex flex-row items-center gap-2">
      <Button3 size="sm" title="← Outputs" onClick={() => onOpen(null)} />
      <span className="flex-1" />
      {onToggleWide ? (
        <Button3
          size="sm"
          title={wide ? "Shrink" : "Expand"}
          onClick={onToggleWide}
        />
      ) : null}
    </div>
  );
  if (open === "plan" && plan) {
    return (
      <div className="flex flex-col gap-4 p-5 min-h-0 overflow-y-auto">
        {back}
        <PlanOutput wp={wp} readOnly={planReadOnly} onBuild={onBuild} />
      </div>
    );
  }
  const step =
    open && open !== "plan" ? steps.find((s) => s.id === open) || null : null;
  if (step) {
    return (
      <div className="flex flex-col gap-4 p-5 min-h-0 overflow-y-auto">
        {back}
        <div className="flex flex-col gap-1">
          <span className={`text-xs ${muted}`}>{step.bot} · answer</span>
          <span className={`text-lg font-semibold ${strong}`}>
            {step.label}
          </span>
        </div>
        {step.request ? (
          <div className="flex flex-col gap-1">
            <span className={`text-xs ${muted}`}>What it was asked</span>
            <span className="text-sm whitespace-pre-wrap">{step.request}</span>
          </div>
        ) : null}
        <div
          className={`flex flex-col gap-1 rounded-lg border p-3 ${hairline}`}
          data-testid="workspace-output-detail"
        >
          <span className={`text-xs ${muted}`}>
            {step.status === "asking" ? "Working on it…" : "Its answer"}
          </span>
          <span className="text-sm whitespace-pre-wrap">
            {step.answer || ""}
          </span>
        </div>
      </div>
    );
  }

  const answered = steps.filter(
    (s) => s.status !== "asking" && s.answer && !s.plan,
  );
  const isBot = contact && contact.kind === "bot";
  const approvalBots = contact
    ? [{ id: contact.botId, name: contact.name }, ...members]
    : [];

  return (
    <div
      className="flex flex-col gap-5 p-5 min-h-0 overflow-y-auto"
      data-testid="workspace-side"
    >
      <DashTeamApprovals compact bots={approvalBots} />
      {wp ? <BeforeItBuilds wp={wp} readOnly={planReadOnly} /> : null}

      <div className="flex flex-col gap-2">
        <span className={`text-sm font-semibold ${strong}`}>Outputs</span>
        {plan ? (
          <ListRow
            testId="workspace-output-plan"
            icon={
              <FontAwesomeIcon
                icon="table-cells-large"
                className={`h-4 w-4 ${muted}`}
              />
            }
            title={`${planName(plan)} — plan`}
            meta={planStatus({ plan, check: wp.check, open: wp.open })}
            onClick={() => onOpen("plan")}
          />
        ) : null}
        {answered.length || plan ? (
          answered.map((s) => (
            <ListRow
              key={s.id}
              testId="workspace-output"
              icon={
                <FontAwesomeIcon
                  icon="comment"
                  className={`h-4 w-4 ${muted}`}
                />
              }
              title={`${cap(s.bot)}'s answer`}
              meta={s.result}
              onClick={() => onOpen(s.id)}
            />
          ))
        ) : (
          <span
            className={`rounded-lg border border-dashed p-4 text-center text-sm ${hairline} ${muted}`}
          >
            {isBot
              ? "Its answers and results show here."
              : "What the team finds shows here."}
          </span>
        )}
      </div>

      {isBot ? (
        <div className="flex flex-col gap-2" data-testid="workspace-runs">
          <span className={`text-sm font-semibold ${strong}`}>Runs</span>
          {runs.length ? (
            [...runs]
              .reverse()
              .slice(0, 8)
              .map((r, i) => (
                <div key={i} className="flex flex-col gap-0.5 text-sm">
                  <span className={strong}>
                    {shortTime(r.endedAt || r.startedAt)} ·{" "}
                    {TRIGGER_WORDS[r.trigger] || r.trigger || "run"} ·{" "}
                    {r.status || ""}
                  </span>
                  {r.output ? (
                    <span className={`text-xs truncate ${muted}`}>
                      {String(r.output).split("\n")[0]}
                    </span>
                  ) : null}
                </div>
              ))
          ) : (
            <span className={`text-sm ${muted}`}>No runs yet.</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="workspace-team">
          <span className={`text-sm font-semibold ${strong}`}>
            Team in this conversation
          </span>
          {members.length ? (
            members.map((m) => {
              const mine = steps.filter((s) => norm(s.bot) === norm(m.name));
              const last = mine[mine.length - 1] || null;
              const status = statusOf(m.id);
              const working = !!(last && last.status === "asking");
              const state = working
                ? "working"
                : last
                  ? last.status === "failed"
                    ? "couldn't answer"
                    : last.status === "stopped"
                      ? "stopped"
                      : "answered"
                  : status === "Running"
                    ? "busy with its own run"
                    : status === "Paused"
                      ? "paused"
                      : "not asked";
              const line = working
                ? lines[m.id] || "starting…"
                : last
                  ? last.result || ""
                  : "";
              return (
                <div
                  key={m.id}
                  className="flex flex-row items-start gap-3"
                  data-testid="workspace-member"
                >
                  <FontAwesomeIcon
                    icon={
                      working ? "spinner" : last ? "circle-check" : "circle"
                    }
                    className={`h-3 w-3 mt-1 ${working ? "animate-spin" : ""} ${muted}`}
                  />
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-sm">
                      <span className={`font-medium ${strong}`}>{m.name}</span>
                      <span className={muted}> · {state}</span>
                    </span>
                    {line ? (
                      <span className={`text-xs font-mono truncate ${muted}`}>
                        {line}
                      </span>
                    ) : null}
                  </span>
                  {last && last.plan && plan ? (
                    <Button3
                      size="sm"
                      title="Plan ›"
                      onClick={() => onOpen("plan")}
                    />
                  ) : last && last.answer ? (
                    <Button3
                      size="sm"
                      title="Answer ›"
                      onClick={() => onOpen(last.id)}
                    />
                  ) : null}
                </div>
              );
            })
          ) : (
            <span className={`text-sm ${muted}`}>
              This team has no bots yet.
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSide;
