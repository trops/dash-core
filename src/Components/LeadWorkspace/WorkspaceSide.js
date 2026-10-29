import React, { useContext, useEffect, useState } from "react";
import {
  Button2,
  Button3,
  FontAwesomeIcon,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { DashTeamApprovals } from "../Bots/DashTeamApprovals";
import { normalizeType } from "../Create/planChecklist";
import { toolName } from "./handoffSteps";
import { BeforeItBuilds, OutputCard, PlanOutput } from "./PlanViews";
import { RegistryOutput } from "./RegistryOutput";
import {
  BuildLogOutput,
  BuildNeedsYou,
  CheckReportOutput,
  PreviewOutput,
} from "./BuildViews";
import {
  buildMemberState,
  buildPlanLine,
  buildStatus,
  waitingFor,
} from "./workspaceBuild";
import { planTarget } from "../../utils/teamPlan";
import {
  planName,
  planStatus,
  planSubLine,
  providersLine,
} from "./workspacePlan";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// "gmail_search_messages" → "gmail search messages"; the team's own
// tools in words.
const TOOL_WORDS = {
  team_ask_bot: "asking a bot",
  team_ask_dash_team: "bringing in the Dash team",
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

// What each Dash team role is for, under its name until it's asked (frame
// 13), and what its output is called (frame 1).
const ROLE_LINES = {
  scout: "finds what you already have",
  planner: "turns your request into a plan",
  builder: "builds what you approve",
  checker: "checks what's built",
};
const ROLE_OUTPUT = { scout: "Findings" };
// The roles a build uses, and their output (release 3b, frames 4, 7).
const BUILD_ROLES = {
  builder: { label: "Build log", open: "buildlog" },
  checker: { label: "Report", open: "check" },
};

/**
 * Where you can start a new Dash Lead conversation from (frame 13).
 * `onStartFrom(kind)`: "describe" | "registry" | "copy" | "widget".
 */
const START_FROM = [
  {
    kind: "describe",
    title: "Describe it",
    sub: "Say what you want in the box — the usual way",
  },
  {
    kind: "registry",
    title: "A dashboard from the registry",
    sub: "Install a ready-made one and its bots, then adjust it",
  },
  {
    kind: "copy",
    title: "Copy one of your dashboards",
    sub: "Start from what you have and change it",
  },
  {
    kind: "widget",
    title: "Edit a widget you have",
    sub: "Open it in the Widget Builder",
  },
];

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
      // Its notes to itself aren't what it's doing (memory_list…).
      if (event.type === "tool_call" && /^memory/.test(toolName(event.name)))
        return;
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
 * A team member's state and line (frames 1, 13): working (its live line),
 * done (what it answered), or not asked yet — ready, or waiting while a plan
 * waits for the go-ahead.
 */
function memberState(m, last, status, { plan, lines }) {
  const working = !!(last && last.status === "asking");
  if (working)
    return {
      tone: "working",
      state: "working",
      line: lines[m.id] || "starting…",
    };
  if (last) {
    if (last.status === "failed")
      return { tone: "bad", state: "couldn't answer", line: last.result || "" };
    if (last.status === "stopped")
      return { tone: "idle", state: "stopped", line: last.result || "" };
    // A plan says what it is ("drafted a plan — 2 widgets"), not the
    // Planner's first words.
    if (last.plan) {
      const what = planSubLine(last.plan);
      return {
        tone: "ok",
        state: "done",
        line: what ? `drafted a plan — ${what}` : "drafted a plan",
      };
    }
    return { tone: "ok", state: "done", line: last.result || "" };
  }
  // A dashboard lead's own bot, not asked for this plan (frame 18).
  if (plan && !m.role) return { tone: "idle", state: "not needed", line: "" };
  if (status === "Running")
    return { tone: "idle", state: "busy with its own run", line: "" };
  if (status === "Paused") return { tone: "idle", state: "paused", line: "" };
  if (plan && m.role === "builder")
    return {
      tone: "idle",
      state: "waiting",
      line: "waiting for your go-ahead",
    };
  if (plan && m.role === "checker")
    return { tone: "idle", state: "waiting", line: ROLE_LINES.checker };
  // The plan came without it (the lead looked itself).
  if (plan && m.role === "scout")
    return { tone: "idle", state: "not needed", line: "" };
  return { tone: "idle", state: "ready", line: ROLE_LINES[m.role] || "" };
}

/**
 * WorkspaceSide — the workspace's right column (lead-workspace releases 2
 * and 3a, frames 1, 6, 13): Outputs — where to start from (a new Dash Lead
 * conversation), Before it builds, the team's approvals, the plan and the
 * team's answers — then Team in this conversation (each bot: its state, a
 * live line while it works, its output) and the providers the plan needs. A
 * lone bot shows its runs instead of a team.
 *
 * @param {object} contact     workspaceContacts' contact
 * @param {object[]} messages  the conversation (AskStep's), with its steps
 * @param {(id) => string} statusOf  "Running" | "Paused" | "Idle" | …
 * @param {object|null} wp    the conversation's plan (useWorkspacePlan)
 * @param {boolean} planReadOnly  the lead is answering: a new plan may come
 * @param {() => void} onBuild  Yes, build it
 * @param {string|null} open  what's opened: "plan", "plan:<step id>" (an
 *   earlier plan), a step's id, or null
 * @param {(what) => void} onOpen
 * @param {boolean} wide, onToggleWide  the column's size
 * @param {boolean} isNew  a new conversation, nothing asked yet
 * @param {(kind) => void} onStartFrom  a Start from choice
 * @param {object|null} build  the plan's build (release 3b: { buildId, kind,
 *   leftOff }); its outputs open as "buildlog", "check" and "preview"
 * @param {object|null} pb     the build, live (usePlanBuild)
 * @param {object[]} dashTeam  the Dash team's working roles ({ id, name,
 *   role }), shown under a dashboard lead's own bots once it brings them in
 *   (release 3c, frame 18)
 * @param {({ count, needsYou }) => void} [onSummary]  told what the column
 *   holds — the folded column's button (release 6a)
 * @param {(dashboard, config) => void} [onUseRegistry]  a registry
 *   dashboard picked in Start from (opened as "registry", release 6c)
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
  isNew = false,
  onStartFrom = null,
  build = null,
  pb = null,
  dashTeam = [],
  onSummary = null,
  onUseRegistry = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  // The link colour: the accent role (Aurora gives it its own text shade).
  const link = `${(currentTheme && currentTheme["text-primary-medium"]) || ""} dr-role-accent`;
  const statusTokens = useStatusTokens();
  const members = (contact && contact.members) || [];
  const lines = useLiveLines(
    [...members, ...(dashTeam || [])].map((m) => m.id),
  );
  const runs = useRuns(
    contact && contact.kind === "bot" ? contact.botId : null,
  );
  const steps = (messages || []).filter((m) => m && m.who === "step");
  // A dashboard lead that brought in the Dash team (release 3c): the team
  // shows under its own bots, "brought in by" it.
  // Only the roles in it (frames 18, 30): asked, building, or — a plan
  // waiting for a yes — the Builder.
  const broughtInRoles = (dashTeam || []).filter(
    (m) =>
      steps.some((st) => st.dashTeam && norm(st.bot) === norm(m.name)) ||
      (build && pb && pb.state
        ? !!BUILD_ROLES[m.role] &&
          !!buildMemberState(m.role, pb.state, (build && build.leftOff) || [])
        : !!(wp && wp.plan) && m.role === "builder"),
  );
  const broughtIn =
    !!contact &&
    contact.kind === "lead" &&
    (dashTeam || []).length > 0 &&
    (steps.some((st) => st.dashTeam) || !!(wp && wp.plan) || !!build);

  const plan = wp && wp.plan ? wp.plan : null;
  const back = (
    <div className="flex flex-row items-center gap-2">
      <Button3 size="sm" title="← Outputs" onClick={() => onOpen(null)} />
      <span className="flex-1" />
      {onToggleWide ? (
        <Button2
          size="sm"
          title={wide ? "Shrink ⇥" : "⇤ Expand"}
          ariaLabel={wide ? "Shrink" : "Expand"}
          onClick={onToggleWide}
        />
      ) : null}
    </div>
  );
  // The plan's build (release 3b), as it stands.
  const buildState = build && pb ? pb.state : null;
  const leftOff = (build && build.leftOff) || [];

  const answered = steps.filter(
    (s) => s.status !== "asking" && s.answer && !s.plan,
  );
  const isBot = contact && contact.kind === "bot";
  const approvalBots = contact
    ? [{ id: contact.botId, name: contact.name }, ...members]
    : [];
  const startFrom =
    isNew && contact && contact.kind === "dashlead" && onStartFrom;
  // Connected for real — a connect skipped before building isn't.
  const connected = (it) =>
    !!(wp && wp.have && wp.have.has(normalizeType(it.providerType)));
  // What the build waits for that still isn't connected (Needs you).
  const needs = buildState
    ? waitingFor(buildState)
        .map(normalizeType)
        .filter((t) => t && !(wp && wp.have && wp.have.has(t)))
    : [];
  const status = buildState ? buildStatus(buildState, leftOff) : null;
  // A new widget waiting for your look (frame 31).
  const previewStep =
    status === "waiting-for-you"
      ? (buildState.steps || []).find((x) => x.status === "needs-you") || null
      : null;
  const builtDashboard =
    buildState &&
    buildState.dashboard &&
    (status === "done" || status === "waiting-for-providers")
      ? buildState.dashboard
      : null;

  // For the folded column's button (frames 35, 36): how many outputs, and
  // whether something waits on the user.
  const outputCount =
    (previewStep ? 1 : 0) +
    (plan ? 1 : 0) +
    (builtDashboard ? 1 : 0) +
    answered.length;
  const needsYou = needs.length > 0 || !!previewStep;
  useEffect(() => {
    if (onSummary) onSummary({ count: outputCount, needsYou });
  }, [onSummary, outputCount, needsYou]);
  const buildLine = build
    ? buildState
      ? buildPlanLine(buildState, leftOff)
      : "Starting the build…"
    : null;
  // An opened output: ← Outputs and Expand stay put; what's opened scrolls.
  const opened = (body) => (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 px-5 pt-5 pb-2">{back}</div>
      <div
        // Each opened output starts at its top.
        key={String(open)}
        className="flex-1 flex flex-col gap-4 px-5 pb-5 pt-2 min-h-0 overflow-y-auto"
      >
        {body}
      </div>
    </div>
  );
  if (open === "registry" && onUseRegistry) {
    return opened(<RegistryOutput onUse={onUseRegistry} />);
  }
  if (open === "plan" && plan) {
    return opened(
      <PlanOutput
        wp={wp}
        readOnly={planReadOnly}
        onBuild={onBuild}
        buildLine={buildLine}
        leadName={contact ? contact.name : undefined}
      />,
    );
  }
  if (open === "buildlog" && build) {
    return opened(
      <BuildLogOutput
        build={build}
        state={buildState}
        onRemoved={() => onOpen(null)}
      />,
    );
  }
  if (open === "check" && build) {
    return opened(<CheckReportOutput state={buildState} />);
  }
  if (open === "preview" && build && pb) {
    return opened(<PreviewOutput state={buildState} pb={pb} />);
  }
  // An earlier plan, from its card in the chat.
  const earlierStep =
    typeof open === "string" && open.startsWith("plan:")
      ? steps.find((s) => s.id === open.slice(5) && s.plan) || null
      : null;
  if (earlierStep && wp) {
    return opened(<PlanOutput wp={wp} plan={earlierStep.plan} />);
  }
  const step =
    open && open !== "plan" ? steps.find((s) => s.id === open) || null : null;
  if (step) {
    return opened(
      <>
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
      </>,
    );
  }

  const placed = buildState
    ? (buildState.steps || []).filter(
        (x) => x.kind === "place" && x.status === "done",
      ).length
    : 0;
  const hasCheck =
    !!buildState && (buildState.steps || []).some((x) => x.kind === "check");
  const dot = {
    ok: statusTokens.success.icon,
    bad: statusTokens.error.icon,
    idle: muted,
  };

  // A team member's row: its state, live line and output (frames 1, 3, 18).
  // `dash`: one of the Dash team a dashboard lead brought in — matched to
  // its own steps only (a lead's bot could share a role's name).
  const renderMember = (m, dash = false) => {
    const mine = steps.filter(
      (s) =>
        norm(s.bot) === norm(m.name) &&
        (contact.kind !== "lead" || !!s.dashTeam === dash),
    );
    const last = mine[mine.length - 1] || null;
    // Once it builds, the Builder and Checker follow the build
    // (frames 3, 8, 33) — or weren't needed for it.
    const inBuild =
      buildState && BUILD_ROLES[m.role]
        ? buildMemberState(m.role, buildState, leftOff, {
            [m.role]: lines[m.id],
          }) || { tone: "idle", state: "not needed", line: "" }
        : null;
    const { tone, state, line } =
      inBuild || memberState(m, last, statusOf(m.id), { plan, lines });
    const out =
      inBuild && inBuild.out === "preview"
        ? { label: "Preview", open: "preview" }
        : inBuild && inBuild.out === false
          ? null
          : inBuild && inBuild.state !== "not needed"
            ? BUILD_ROLES[m.role]
            : last && last.plan && plan
              ? {
                  // A change to a dashboard the user has (frame 30).
                  label: planTarget(plan) ? "Changes" : "Plan",
                  open: "plan",
                }
              : last && last.answer
                ? {
                    label: ROLE_OUTPUT[m.role] || "Answer",
                    open: last.id,
                  }
                : null;
    return (
      <div
        key={m.id}
        className={`flex flex-row items-start gap-3 ${dash ? "pl-4" : ""}`}
        data-testid="workspace-member"
      >
        <FontAwesomeIcon
          icon={tone === "working" ? "spinner" : "circle"}
          className={`h-2 w-2 mt-1 ${tone === "working" ? `animate-spin ${muted}` : dot[tone]}`}
          aria-hidden="true"
        />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm">
            <span className={`font-semibold ${strong}`}>{m.name}</span>
            <span className={`text-xs ${muted}`}> · {state}</span>
          </span>
          {line ? (
            <span className={`text-xs font-mono truncate ${muted}`}>
              {line}
            </span>
          ) : null}
        </span>
        {out ? (
          <button
            type="button"
            onClick={() => onOpen(out.open)}
            className={`flex-shrink-0 text-sm ${link}`}
          >
            {out.label} ›
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className="flex-1 flex flex-col gap-4 p-5 min-h-0 overflow-y-auto"
      data-testid="workspace-side"
    >
      <span className={`text-sm font-semibold ${strong}`}>Outputs</span>

      {startFrom ? (
        <div className="flex flex-col gap-2" data-testid="workspace-start-from">
          <span className={`text-xs ${muted}`}>Start from</span>
          {START_FROM.map((s) => (
            <button
              key={s.kind}
              type="button"
              onClick={() => onStartFrom(s.kind)}
              className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left ${hairline}`}
            >
              <span className={`text-sm font-semibold ${strong}`}>
                {s.title}
              </span>
              <span className={`text-xs ${muted}`}>{s.sub}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Once it builds, what's left is asked for as Needs you (frame 3). */}
      {wp && !build ? <BeforeItBuilds wp={wp} readOnly={planReadOnly} /> : null}
      <BuildNeedsYou
        types={needs}
        onConnected={() => {
          if (wp && wp.refreshProviders)
            Promise.resolve(wp.refreshProviders()).catch(() => {});
        }}
      />
      <DashTeamApprovals compact bots={approvalBots} />

      {previewStep ? (
        <OutputCard
          testId="workspace-output-preview"
          icon="puzzle-piece"
          title={String(previewStep.label || "New widget").replace(
            /^Preview /,
            "",
          )}
          sub="Preview ready"
          kind="Widget"
          onClick={() => onOpen("preview")}
        />
      ) : null}
      {plan ? (
        <OutputCard
          testId="workspace-output-plan"
          title={`${planName(plan)} — ${planTarget(plan) ? "changes" : "plan"}`}
          sub={
            buildLine || planStatus({ plan, check: wp.check, open: wp.open })
          }
          kind="Plan"
          onClick={() => onOpen("plan")}
        />
      ) : null}
      {builtDashboard ? (
        <OutputCard
          testId="workspace-output-dashboard"
          icon="table-cells-large"
          title={builtDashboard.name}
          sub={
            builtDashboard.targeted
              ? `changed · ${placed} added`
              : `${placed} ${placed === 1 ? "widget" : "widgets"}`
          }
          kind="Dashboard"
          onClick={() => onOpen(hasCheck ? "check" : "buildlog")}
        />
      ) : null}
      {answered.map((s) => (
        <OutputCard
          key={s.id}
          testId="workspace-output"
          icon="comment"
          title={`${cap(s.bot)}'s answer`}
          sub={s.result}
          kind="Answer"
          onClick={() => onOpen(s.id)}
        />
      ))}
      {!answered.length && !plan && !startFrom ? (
        <span
          className={`rounded-xl border border-dashed p-6 text-center text-sm ${hairline} ${muted}`}
        >
          {isBot
            ? "Its answers and results show here."
            : "What the team makes shows here."}
        </span>
      ) : null}

      <div className={`border-t ${hairline}`} aria-hidden="true" />

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
        <div className="flex flex-col gap-3" data-testid="workspace-team">
          <span className={`text-sm font-semibold ${strong}`}>
            Team in this conversation
          </span>
          {members.map((m) => renderMember(m))}
          {!members.length && !broughtIn ? (
            <span className={`text-sm ${muted}`}>
              This team has no bots yet.
            </span>
          ) : null}
          {/* A dashboard lead's Dash team, brought in (frame 18). */}
          {broughtIn ? (
            <>
              <span className="text-sm" data-testid="workspace-team-group">
                <span className={`font-semibold ${strong}`}>Dash team</span>
                <span className={`text-xs ${muted}`}>
                  {` · brought in by ${contact.name}`}
                </span>
              </span>
              {broughtInRoles.map((m) => renderMember(m, true))}
            </>
          ) : null}
        </div>
      )}

      {plan ? (
        <div
          className="flex flex-row gap-2 text-sm"
          data-testid="workspace-providers"
        >
          <span className={`font-semibold ${strong}`}>Providers</span>
          <span className={muted}>
            {providersLine(wp.checklist, connected)}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default WorkspaceSide;
