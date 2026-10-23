import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ButtonIcon,
  ButtonIcon2,
  Card2,
  ConfirmationModal,
  FontAwesomeIcon,
  InputText,
  StatusBadge,
  useStatusTokens,
  SectionLabel,
  ChatComposer,
  ChatMessage,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runTeamRole } from "../../utils/teamRoles";
import { extractPlan, planTarget, validatePlan } from "../../utils/teamPlan";
import { estimatePlan, describeEstimate } from "../../utils/planEstimate";
import { runCostLabel, usageTokens } from "../../utils/runCostLabel";
import {
  buildChecklist,
  buildButtonLabel,
  countsLine,
  editNote,
  isDone,
  isSkipped,
  nextOpen,
  providerTypesOf,
  removePiece,
  botDetails,
  swapPiece,
  pieceSource,
} from "./planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
  SwapPicker,
} from "./PlanChecklistDialogs";
import { CreateBuildingStep } from "./CreateBuildingStep";
import { PlanSketch } from "./PlanSketch";
import { botPlanRequest, forWhere } from "./botCreate";
import { forEdit } from "./editCreate";

/**
 * The Planner's first question in a conversation reopened from Recent: its
 * session may have moved on, so the plan comes along — and the plan's memory
 * holds the rest (4e-1).
 */
export function reopenedRequest(original, plan, text) {
  return [
    `You're picking up a saved plan. It started from: "${original || ""}".`,
    "This plan's memory has what was asked, answered and built so far.",
    plan
      ? `The plan as it stands:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
      : "There's no plan yet.",
    `Now: ${text}`,
  ].join("\n");
}

/**
 * "Removed the Ask Test dashboard, 1 bot and 1 widget." (4d-3) — or, on a
 * dashboard the user had (5e-2b): "Took 1 widget and 1 bot off Slack Pack
 * and put its theme back."
 */
export function removedText(res) {
  const r = (res && res.removed) || {};
  if (r.from) {
    const n = (count, one) =>
      count ? `${count} ${one}${count === 1 ? "" : "s"}` : null;
    const things = [
      n(r.placed || 0, "widget"),
      n((r.bots || []).length, "bot"),
    ].filter(Boolean);
    const parts = [];
    if (things.length) parts.push(`Took ${things.join(" and ")} off ${r.from}`);
    if (r.theme) {
      parts.push(
        parts.length ? "put its theme back" : `Put ${r.from}'s theme back`,
      );
    }
    const problems = (res && res.problems) || [];
    return (
      (parts.length
        ? `${parts.join(" and ")}.`
        : `Nothing was left to take off ${r.from}.`) +
      (r.widgets && r.widgets.length
        ? ` Uninstalled ${r.widgets.length} widget${r.widgets.length === 1 ? "" : "s"} it built.`
        : "") +
      (problems.length ? ` Couldn't remove: ${problems.join("; ")}.` : "")
    );
  }
  const parts = [];
  if (r.dashboard) parts.push(`the "${r.dashboard}" dashboard`);
  const n = (list, one) =>
    list && list.length
      ? `${list.length} ${one}${list.length === 1 ? "" : "s"}`
      : null;
  [n(r.bots, "bot"), n(r.widgets, "widget")].forEach((p) => p && parts.push(p));
  const kept = (res && res.kept && res.kept.installs) || [];
  const problems = (res && res.problems) || [];
  return (
    (parts.length
      ? `Removed ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`
      : "Nothing was left to remove.") +
    (kept.length ? ` Still installed: ${kept.join(", ")}.` : "") +
    (problems.length ? ` Couldn't remove: ${problems.join("; ")}.` : "")
  );
}

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

/**
 * Where each piece comes from, as a coloured pill above its name (design
 * guide rule 12: status is a word in a badge; screen audit, October 2026).
 */
const SOURCE = {
  yours: { label: "Yours", state: "success" },
  "ai-built": { label: "AI-built", state: "neutral" },
  registry: { label: "From the registry", state: "info" },
  new: { label: "New", state: "closed" },
  update: { label: "Update", state: "warning" },
};
const KIND_ICON = {
  bot: "robot",
  widget: "puzzle-piece",
  layout: "table-cells-large",
  theme: "palette",
};
const GROUPS = [
  ["bot", "Bots"],
  ["widget", "Widgets"],
  ["layout", "Layout"],
  ["theme", "Theme"],
];

/**
 * The dashboard with unsaved edits in this window, if any (DashboardStage
 * mirrors it): a plan doesn't change a dashboard mid-edit (5e-2b).
 */
function dirtyDashboardId() {
  const id = typeof globalThis !== "undefined" && globalThis.__dashboardDirtyId;
  return id === undefined || id === null ? null : String(id);
}

/**
 * An option that means "let me type it" rather than an answer (the Planner
 * sometimes offers one): it focuses the question's field instead.
 */
export function isTypeItOption(option) {
  return /\b(type|write|enter)\b.*\b(it|my own|myself)\b|^other\b|something else/i.test(
    String(option || ""),
  );
}

/** The line under a piece's name: package · providers · notes, or for a
 * layout, what it is ("New dashboard layout"). */
export function pieceMeta(p) {
  const parts = [p.package, (p.providers || []).join(", "), p.notes].filter(
    Boolean,
  );
  if (parts.length) return parts.join(" · ");
  if (p.kind === "layout") {
    return p.source === "new" ? "New dashboard layout" : "Dashboard layout";
  }
  if (p.kind === "theme") return "One of your saved themes";
  return "";
}
/**
 * A change's widget on the plan card (Phase 3): what it adds, what it keeps
 * and which files it touches.
 */
const EditPlanDetails = ({ piece, edit, muted }) => {
  const update = edit.mode === "update";
  const files = update
    ? `widgets/${edit.target.componentName}.js, widgets/${edit.target.componentName}.dash.js`
    : `A new widget — ${edit.target.componentName} isn't changed`;
  const keeps = (Array.isArray(piece.keeps) ? piece.keeps : []).filter(
    (k) => typeof k === "string" && k.trim(),
  );
  const rows = [
    ["Adds", typeof piece.adds === "string" ? piece.adds : piece.notes || ""],
    ["Keeps", keeps.join(" · ")],
    ["Files", files],
  ].filter(([, v]) => v);
  return (
    <div
      className="grid gap-x-3 gap-y-1 text-sm"
      style={{ gridTemplateColumns: "4.5rem minmax(0, 1fr)" }}
      data-testid="plan-edit-details"
    >
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <span className={muted}>{k}</span>
          <span>{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

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

/**
 * A planned bot on the plan card (4d-2): Runs / Uses / Sends as a labelled
 * list in a recessed panel, and its full instructions behind a real button.
 */
const BotPlanDetails = ({ piece, muted, strong, open, onToggle }) => {
  const rows = botDetails(piece);
  return (
    <div
      className="flex flex-col gap-3 ml-7 rounded-md p-3"
      style={{ background: "var(--raised-2, transparent)" }}
      data-testid="plan-bot"
    >
      <dl
        className="gap-x-4 gap-y-1 text-sm"
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          margin: 0,
        }}
      >
        {rows.map((r) => (
          <React.Fragment key={r.label}>
            <dt className={`text-xs pt-0.5 ${muted}`}>{r.label}</dt>
            <dd
              className={strong}
              style={{ margin: 0, wordBreak: "break-word" }}
            >
              {r.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <div>
        <Button2
          size="sm"
          onClick={onToggle}
          ariaLabel={open ? "Hide instructions" : "Show instructions"}
        >
          <span className="inline-flex items-center gap-2">
            <FontAwesomeIcon
              icon={open ? "chevron-up" : "chevron-down"}
              className="h-3 w-3"
            />
            {open ? "Hide instructions" : "Show instructions"}
          </span>
        </Button2>
      </div>
      {open ? (
        <span
          className="text-sm whitespace-pre-wrap"
          data-testid="plan-bot-instructions"
        >
          {piece.instructions}
        </span>
      ) : null}
    </div>
  );
};

/** A titled group on the plan (design guide rule 3): a Card2 with a 14px title. */
const PlanSection = ({ title, testId, children }) => {
  const { strong } = useConfigTokens();
  // The body takes the normal text color — a card can carry the theme's
  // accent text color otherwise.
  return (
    <Card2
      padding="p-4"
      rounded="rounded-lg"
      shadow=""
      className="flex flex-col gap-3"
      testId={testId}
    >
      <h3 className={`text-sm font-semibold ${strong}`} style={{ margin: 0 }}>
        {title}
      </h3>
      <div className={`flex flex-col gap-3 text-sm ${strong}`}>{children}</div>
    </Card2>
  );
};

/** A "can't" line in the plan's access list ("None can send email"). */
export function cannotLine(text) {
  return /\b(can't|cannot|can not|none can|no bot|won't|never)\b|^none\b|^no\b/i.test(
    String(text || ""),
  );
}

export const CreatePlanStep = ({
  prompt,
  recentId = null,
  onOpenDashboard = null,
  // The dock's narrow panel (4e-2).
  compact = false,
  // ({ recentId, busy }) — the modal folds a plan into the dock by its id,
  // and not while the Planner is answering (that answer would be lost).
  onState = null,
  // A starter's plan to start from (Remix, 5b): { plan, request, label } —
  // the plan shows at once; the Planner is asked to adapt it.
  seed = null,
  // The dashboard the user is looking at (5e-2b): the Planner is told, so
  // "this dashboard" means it.
  openDashboardId = null,
  // One widget for a cell being edited (consolidation Phase 2b):
  // { label: "cell 2.2 on Slack Pack" } — the plan is one widget, built with
  // a preview and placed by the editor (onCellDone); a seed with autoBuild
  // (Use in this cell) skips the Planner and builds at once.
  cell: cellProp = null,
  // One widget on its own (consolidation Phase 3b): Create › Type: Widget —
  // planned and built like a cell's, previewed, installed into the user's
  // widgets and not placed anywhere (onCellDone hands it back).
  widget = false,
  onCellDone = null,
  onDiscard = null,
  // One bot (consolidation Phase 2c-1): { where: { id, name } | null } —
  // the plan is one new bot, saved paused on that dashboard or Unassigned.
  // Kept with the conversation, so a plan reopened from Recent stays one.
  bot = null,
  // Its page, once saved: (botId).
  onOpenBot = null,
  // What Dash knows about the dashboard it works on, and a lead's note
  // (teamContext.contextRequest, 2c-2) — told to the Planner at the start.
  context = "",
  // A note to show under the request (e.g. why a found bot wasn't used).
  note = "",
  // A change to one widget the user has (consolidation Phase 3): { target:
  // { package, component, componentName, displayName }, mode: "update" |
  // "new", request, usedOn, inputs: { settings, providers }, original } —
  // the plan is that widget, built with a preview like a cell's.
  edit = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  // A widget on its own builds as a cell does; only its words differ.
  const cell =
    cellProp ||
    (widget
      ? {
          label: "your widgets",
          approveLabel: "Looks good — add it to my widgets",
          discardLabel: "Discard — nothing is installed",
          inputsNote: "Only for trying it here.",
        }
      : null);
  const [botMode, setBotMode] = useState(bot);
  const where = botMode ? botMode.where || null : null;
  // One widget, previewed before it's installed: a cell, or a change.
  const single = !!(cell || edit);
  // Create › Widget on its own is saved like any plan (QA 2026-10-22: it
  // wasn't, so closing it lost it); a cell's build and a change aren't.
  const savedWidget = !!(widget && !cellProp && !edit);
  const saves = !single || savedWidget;
  const statusTokens = useStatusTokens();
  const app = useContext(AppContext) || {};
  // [{ who: "you" | "planner" | "note", text, meta? }]
  const [messages, setMessages] = useState(
    recentId
      ? []
      : [
          { who: "you", text: seed ? seed.label : prompt },
          ...(note ? [{ who: "note", text: note }] : []),
        ],
  );
  const [busy, setBusy] = useState(true);
  // Recent (4e-1): this conversation's id (its plan memory too); whether
  // it's loaded (a reopened one restores first); what it was started with.
  const planId = useRef(recentId);
  // The id as state too, so the host hears it as soon as it's saved.
  const [savedId, setSavedId] = useState(recentId);
  const [loaded, setLoaded] = useState(!recentId);
  const [origPrompt, setOrigPrompt] = useState(prompt);
  // A reopened conversation's next question re-introduces the plan: the
  // Planner's own session may have moved on to other work since.
  const reopened = useRef(false);
  const [soFar, setSoFar] = useState("");
  const [plan, setPlan] = useState(seed ? seed.plan : null);
  const [planningTokens, setPlanningTokens] = useState(0);
  const [team, setTeam] = useState([]);
  const [reply, setReply] = useState("");
  // Several questions: picks per question, sent together ({ index: option }).
  const [picks, setPicks] = useState({});
  // Typed answers per question ({ index: text }).
  const [typed, setTyped] = useState({});
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
  // Edit plan (4d-3): the earlier build whose work the next Build reuses.
  const [resumeFrom, setResumeFrom] = useState(null);
  // Remove what was built (4d-3): what was removed, said on the plan.
  const [removedNote, setRemovedNote] = useState(null);
  // Bots whose full instructions are showing on the plan card.
  const [openBots, setOpenBots] = useState([]);
  const started = useRef(false);
  const alive = useRef(true);

  const ask = async (text, continueConversation) => {
    setBusy(true);
    setSoFar("");
    let request = text;
    let cont = continueConversation;
    if (reopened.current) {
      reopened.current = false;
      cont = false;
      request = reopenedRequest(origPrompt, plan, text);
      // Still one bot, where it was going (2c-1).
      if (botMode) request = botPlanRequest(request, where);
    }
    const res = await runTeamRole("planner", request, {
      continueConversation: cont,
      planId: planId.current,
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
          text: `Can't plan right now: ${res.reason}. Turn the Planner on in the Bots page › Dash team.`,
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
      // A bot goes where Where says, whatever the Planner wrote.
      setPlan(
        botMode
          ? forWhere(found, where)
          : edit
            ? forEdit(found, edit.target, edit.mode)
            : found,
      );
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
      const bots = window.mainApi && window.mainApi.bots;
      if (recentId) {
        // Reopened from Recent: as it was — no new question.
        Promise.resolve(bots && bots.getCreateRecent(recentId))
          .then((entry) => {
            if (!alive.current) return;
            restore(entry);
          })
          .catch(() => alive.current && restore(null));
      } else {
        // Saved from the start, then the Planner (with this plan's
        // memory) — saving first gives the plan its id.
        const first = seed ? seed.label : prompt;
        // Use in this cell: nothing to plan — it builds (previews) at once.
        const direct = !!(seed && seed.autoBuild);
        // A cell build isn't saved: it ends in the editor (Phase 2b).
        Promise.resolve(
          bots && bots.saveCreateRecent && saves
            ? bots.saveCreateRecent({
                prompt: first,
                ...(savedWidget ? { conversation: { widget: true } } : {}),
              })
            : null,
        )
          .then((res) => {
            if (res && res.id) {
              planId.current = res.id;
              if (alive.current) setSavedId(res.id);
            }
          })
          .catch(() => {})
          .then(() => {
            if (!alive.current) return;
            if (direct) {
              setBusy(false);
              startBuild();
              return;
            }
            // A plan to start from with nothing to ask (a bot the Scout
            // found, 2c-1): it shows at once; the Planner is there to change it.
            if (seed && !seed.request) {
              // The Planner hasn't seen it: a first question brings it along.
              setOrigPrompt(seed.label);
              reopened.current = true;
              setMessages((m) => [
                ...m,
                {
                  who: "note",
                  text: "Ready to build as it is — or ask the Planner to change anything first, like when it runs.",
                },
              ]);
              setBusy(false);
              return;
            }
            ask(
              seed
                ? seed.request
                : edit
                  ? edit.request
                  : widget
                    ? `${prompt}\n\n(Plan exactly one new widget for the user's widgets — it isn't going on a dashboard. No bots, theme or layout, and don't set "dashboard": the user previews the widget, then it's installed. Put the connection and settings they want on the widget piece.)`
                    : cell
                      ? `${prompt}\n\n(Plan exactly one widget for ${cell.label}: the user is editing that dashboard and it goes into that one cell. No bots, theme or layout, and don't set "dashboard" — the user previews the widget and the editor places it. Put the connection and settings they want on the widget piece.)`
                      : botMode
                        ? botPlanRequest(prompt, where, context)
                        : openDashboardId != null
                          ? `${prompt}\n\n(The user is looking at the dashboard with id ${openDashboardId}.)${context ? `\n\n${context}` : ""}`
                          : prompt,
              false,
            );
          });
      }
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

  // A conversation from Recent, as it was left (4e-1).
  // A widget plan is finished once its widget is added (Looks good);
  // until then it's Unfinished. Discard ("nothing is installed") forgets it.
  const widgetAdded = (made) => {
    const bots = window.mainApi && window.mainApi.bots;
    if (planId.current && bots && bots.saveCreateRecent) {
      Promise.resolve(
        bots.saveCreateRecent({
          id: planId.current,
          conversation: { widgetAdded: true },
        }),
      ).catch(() => {});
    }
    if (onCellDone) onCellDone(made);
  };
  const widgetDiscarded = (...args) => {
    const bots = window.mainApi && window.mainApi.bots;
    if (planId.current && bots && bots.removeCreateRecent) {
      Promise.resolve(bots.removeCreateRecent(planId.current)).catch(() => {});
    }
    return onDiscard(...args);
  };

  const restore = (entry) => {
    const conv = (entry && entry.conversation) || {};
    setOrigPrompt((entry && entry.prompt) || prompt || "");
    setMessages(
      Array.isArray(conv.messages) && conv.messages.length
        ? conv.messages
        : [{ who: "you", text: (entry && entry.prompt) || "" }],
    );
    if (conv.plan) setPlan(conv.plan);
    if (conv.checks) setChecks(conv.checks);
    // A bot plan stays one (2c-1).
    if (conv.bot && typeof conv.bot === "object") setBotMode(conv.bot);
    setPlanningTokens(Number(conv.planningTokens) || 0);
    const b = entry && entry.build;
    if (b && b.state && b.state.status === "removed") {
      setRemovedNote(removedText(b.state));
    } else if (b && b.buildId) {
      setBuild({ buildId: b.buildId, state: b.state });
    }
    if (!entry) {
      setMessages((m) => [
        ...m,
        { who: "note", text: "This conversation isn't saved any more." },
      ]);
    }
    reopened.current = true;
    setBusy(false);
    setLoaded(true);
  };

  // Saved as it goes, so Back, Close and a restart lose nothing (CRE-003
  // AC4); the main process writes its facts to the plan's memory.
  useEffect(() => {
    if (!loaded || !planId.current) return undefined;
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.saveCreateRecent) return undefined;
    const t = setTimeout(() => {
      Promise.resolve(
        bots.saveCreateRecent({
          id: planId.current,
          conversation: {
            messages,
            plan,
            checks,
            planningTokens,
            ...(botMode ? { bot: botMode } : {}),
            ...(savedWidget ? { widget: true } : {}),
          },
        }),
      ).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [loaded, messages, plan, checks, planningTokens, botMode]);

  // What the host needs for Fold and the "…" menu: the plan's id, whether
  // the Planner is answering, whether a build exists (Discard vs Remove from
  // Recent) and a short title for the confirm.
  // The plan's name as Recent shows it: its layout's name, else what was asked.
  const layoutName =
    (
      (plan && Array.isArray(plan.pieces) ? plan.pieces : []).find(
        (p) => p && p.kind === "layout" && p.name,
      ) || {}
    ).name || "";
  const firstAsk =
    layoutName || (messages.find((m) => m.who === "you") || {}).text || "";
  const built = !!build && !removedNote;
  // A bot build's one bot (2c-1): the headers and Done say it.
  const botPiece = botMode
    ? (plan && Array.isArray(plan.pieces) ? plan.pieces : []).find(
        (p) => p && p.kind === "bot",
      ) || null
    : null;
  // A cell build's one widget, by name (the headers say it).
  const widgetName =
    (
      (plan && Array.isArray(plan.pieces) ? plan.pieces : []).find(
        (p) => p && p.kind === "widget" && p.name,
      ) || {}
    ).name || "";
  useEffect(() => {
    if (onState)
      onState({
        recentId: savedId,
        busy,
        built,
        // The running build, so a cell build can be stopped on close.
        buildId: build ? build.buildId : null,
        title: firstAsk.length > 60 ? `${firstAsk.slice(0, 57)}…` : firstAsk,
        widgetName,
        botName: botPiece ? botPiece.name || "" : "",
        // A bot plan (reopened from Recent too): the host shows its steps.
        bot: botMode || null,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, savedId, built, firstAsk, build, widgetName, botPiece, botMode]);

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
  // A question's answer: what was typed, else the tapped option.
  const answerFor = (i) => String(typed[i] || "").trim() || picks[i] || "";
  const answeredCount = (qs) => qs.filter((_q, i) => answerFor(i)).length;
  const sendPicks = (qs) => {
    const text = qs
      .map((q, i) => (answerFor(i) ? `${q.question} — ${answerFor(i)}` : null))
      .filter(Boolean)
      .join("\n");
    setTyped({});
    answer(text);
  };

  const questions = (plan && plan.questions) || [];
  const pieces = (plan && plan.pieces) || [];
  const check = plan
    ? validatePlan(plan, {
        cell: !!cell,
        standalone: !!widget,
        bot: !!botMode,
        edit: edit ? { package: edit.target.package, mode: edit.mode } : null,
      })
    : null;
  const estimate =
    plan && pieces.length ? estimatePlan(plan, { team, planningTokens }) : null;
  const have = providerTypesOf(app.providers);
  const checklist = plan ? buildChecklist(plan, have) : [];
  // A plan for a dashboard the user has (5e-2b).
  const target = planTarget(plan);
  // A bot plan is Build, even on a dashboard the user has (2c-1).
  const buildLabel = buildButtonLabel(checklist, checks, have, {
    targeted: !!target && !botMode,
  });
  // Open questions: the answers change the plan (a connection, an index,
  // which pages), so it isn't built until they're answered.
  const unanswered = questions.length > 0;
  // A plan with errors isn't built — the main process refuses it too
  // (consolidation Phase 1b).
  const broken = !!(check && check.errors.length);

  // Nothing open: build it (4d). Approving here is the consent — nothing
  // asks again during the build.
  // Unsaved edits on the dashboard the plan changes: it waits (two saves at
  // once would overwrite each other) — checked before anything is walked.
  const heldByEdits = () => {
    // A cell build never saves the dashboard: the editor places its widget
    // (a change doesn't touch one).
    if (single) return false;
    if (!target || dirtyDashboardId() !== target.id) return false;
    setReady(false);
    setBuildError(
      `Save or cancel your edits to ${target.name} first, then press ${buildLabel} again.`,
    );
    return true;
  };

  const startBuild = async (continueFrom = null) => {
    setBuildError(null);
    if (heldByEdits()) return;
    // No sign-in first: public registry widgets install signed out. A
    // private one fails its step, which offers "Sign in to the registry"
    // and tries again (decided 2026-10-23).
    setReady(true);
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.startPlanBuild) {
      setBuildError("Building from a plan isn't available in this version.");
      return;
    }
    try {
      const from = continueFrom || resumeFrom;
      const res = await bots.startPlanBuild(plan, {
        ...(from ? { resumeFrom: from } : {}),
        ...(cell ? { cell: true } : {}),
        // A widget on its own (Phase 3b): the team is told it's not for a cell.
        ...(widget ? { standalone: true } : {}),
        // A change: the main process works out the package itself.
        ...(edit
          ? {
              edit: {
                component: edit.target.component,
                mode: edit.mode,
                displayName: edit.target.displayName,
                settings: (edit.inputs && edit.inputs.settings) || null,
                providers: (edit.inputs && edit.inputs.providers) || null,
              },
            }
          : {}),
        ...(botMode ? { bot: true } : {}),
        // Kept on this conversation in Recent, with its build memory.
        ...(planId.current ? { recentId: planId.current } : {}),
      });
      if (!res || res.error) {
        setBuildError((res && res.error) || "The build couldn't start.");
        return;
      }
      setResumeFrom(null);
      setRemovedNote(null);
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
    setBuildError(null);
    if (heldByEdits()) return;
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

  // The chat follows the conversation to its latest message (its own column
  // full size; the one column in the dock).
  const chatScroll = useRef(null);
  useEffect(() => {
    const el = chatScroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, soFar, questions.length]);

  if (build) {
    return (
      <CreateBuildingStep
        compact={compact}
        cell={cell}
        edit={
          edit
            ? {
                mode: edit.mode,
                original: edit.original || null,
                approveLabel:
                  edit.mode === "update"
                    ? `Looks good — update ${edit.target.displayName}`
                    : edit.cellLabel
                      ? "Looks good — put it in this cell"
                      : "Looks good — install it",
                discardLabel: `Discard — keep ${edit.target.displayName} as it is`,
                inputsNote: edit.cellLabel
                  ? "From this cell's settings · only for trying it here."
                  : "Only for trying it here.",
              }
            : null
        }
        bot={botMode ? { where, piece: botPiece } : null}
        onOpenBot={onOpenBot}
        onCellDone={savedWidget ? widgetAdded : onCellDone}
        onDiscard={savedWidget && onDiscard ? widgetDiscarded : onDiscard}
        buildId={build.buildId}
        initialState={build.state}
        estimate={estimate}
        onOpenDashboard={onOpenDashboard}
        onContinue={() => startBuild(build.buildId)}
        onEditPlan={() => {
          setResumeFrom(build.buildId);
          setBuild(null);
          setReady(false);
        }}
        onRemoved={(res) => {
          setResumeFrom(null);
          setBuild(null);
          setReady(false);
          setRemovedNote(removedText(res));
        }}
      />
    );
  }

  // Full size with a plan: the plan on the left, the conversation on the
  // right, so the plan stays in view while the user talks to the Planner.
  // Before a plan, and in the dock, it's one column.
  const split = !compact && !!plan && pieces.length > 0;
  const chatMessages = (
    <>
      {messages.map((m, i) =>
        m.who === "you" ? (
          <ChatMessage key={i} role="you">
            {m.text}
          </ChatMessage>
        ) : m.who === "note" ? (
          <ChatMessage key={i} role="note">
            {m.text}
          </ChatMessage>
        ) : (
          <ChatMessage
            key={i}
            role="reply"
            label="Planner"
            meta={m.meta}
            testId="planner-message"
          >
            <span className="whitespace-pre-wrap">{m.text}</span>
          </ChatMessage>
        ),
      )}

      {busy ? (
        <ChatMessage role="reply" label="Planner" streaming>
          <span className="whitespace-pre-wrap">
            {withoutPlan(soFar) || "Drafting a plan for you to review…"}
          </span>
        </ChatMessage>
      ) : null}
    </>
  );
  const questionsBlock =
    !busy && questions.length ? (
      <div className="flex flex-col gap-3" data-testid="plan-questions">
        {questions.map((q, i) => {
          const options = (Array.isArray(q.options) ? q.options : []).filter(
            Boolean,
          );
          const fieldId = `plan-question-${i}`;
          return (
            <div
              key={i}
              className={`flex flex-col gap-3 rounded-lg border px-4 py-3 ${hairline}`}
              data-testid="plan-question"
            >
              <span className={`text-sm font-semibold ${strong}`}>
                {q.question}
              </span>
              {options.length ? (
                <div className="flex flex-row flex-wrap gap-2">
                  {options.map((o) =>
                    isTypeItOption(o) ? (
                      // "I'll type it" isn't an answer: it puts the
                      // cursor in this question's field.
                      <ButtonIcon2
                        key={o}
                        text={o}
                        ariaPressed={false}
                        onClick={() => {
                          const el = document.getElementById(fieldId);
                          if (el) el.focus();
                        }}
                      />
                    ) : (
                      <ButtonIcon2
                        key={o}
                        text={o}
                        ariaPressed={picks[i] === o}
                        selected={picks[i] === o}
                        onClick={() => pick(questions, i, o)}
                      />
                    ),
                  )}
                </div>
              ) : null}
              <InputText
                id={fieldId}
                ariaLabel={`Your answer: ${q.question}`}
                placeholder={
                  options.length ? "Or type an answer…" : "Type an answer…"
                }
                value={typed[i] || ""}
                onChange={(v) => {
                  setTyped((t) => ({ ...t, [i]: v }));
                  // Typing replaces a tapped option for this question.
                  if (String(v).trim()) {
                    setPicks((p) => {
                      const next = { ...p };
                      delete next[i];
                      return next;
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  const v = String(typed[i] || "").trim();
                  if (!v) return;
                  if (questions.length === 1) {
                    answer(`${q.question} — ${v}`);
                    setTyped({});
                  }
                }}
              />
              {questions.length === 1 ? (
                <span className={`text-xs ${muted}`}>Enter to send</span>
              ) : null}
            </div>
          );
        })}
        {questions.length > 1 ? (
          <div className="flex flex-row items-center gap-3">
            <Button
              title="Send answers"
              onClick={() => sendPicks(questions)}
              disabled={!answeredCount(questions)}
            />
            <span className={`text-sm ${muted}`}>
              {answeredCount(questions)} of {questions.length} answered
            </span>
          </div>
        ) : null}
      </div>
    ) : null;
  const expectSection =
    plan && pieces.length ? (
      <PlanSection title="What to expect" testId="plan-expect">
        {botMode ? (
          <span className="text-sm" data-testid="plan-expect-bot">
            It's checked, then saved paused. Nothing runs until you try it or
            turn it on.
          </span>
        ) : null}
        {(plan.access || []).length ? (
          <div className="flex flex-col gap-1" data-testid="plan-access">
            <SectionLabel text="What it can and can't do" />
            {plan.access.map((a, i) => {
              const cant = cannotLine(a);
              return (
                <span
                  key={i}
                  className="flex flex-row items-start gap-2 text-sm"
                >
                  <FontAwesomeIcon
                    icon={cant ? "ban" : "check"}
                    className={`h-3.5 w-3.5 mt-1 flex-shrink-0 ${cant ? muted : statusTokens.success.icon}`}
                    aria-label={cant ? "Can't" : "Can"}
                  />
                  <span>{a}</span>
                </span>
              );
            })}
          </div>
        ) : null}

        {(plan.checks || []).length ? (
          <div className="flex flex-col gap-1">
            <SectionLabel text="How we'll know it works" />
            <ul
              className="flex flex-col gap-1 text-sm"
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
                listStyle: "disc",
              }}
            >
              {plan.checks.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-1" data-testid="plan-estimate">
          <SectionLabel text="Estimated cost" />
          <span className="text-sm">
            {botMode
              ? // Dash checks and saves it — no AI (2c-1).
                "To build: nothing — Dash checks and saves it, no AI"
              : `To build: ${describeEstimate(estimate)}`}
          </span>
          {plan.estimate && plan.estimate.running ? (
            <span className="text-sm">To run: {plan.estimate.running}</span>
          ) : null}
        </div>
      </PlanSection>
    ) : null;
  const planCard =
    plan && pieces.length ? (
      <div className="flex flex-col gap-4" data-testid="plan-card">
        {/* Nothing changes until Build (the user approves first). */}
        <div data-testid="plan-status">
          <SectionLabel
            text={
              edit
                ? `Change to ${edit.target.displayName} · not made yet`
                : target && !botMode
                  ? `Changes to ${target.name} · not made yet`
                  : "Plan · not built yet"
            }
          />
        </div>
        <span className={`text-lg font-semibold ${strong}`}>
          {plan.summary}
        </span>
        <span className={`text-sm ${muted}`} data-testid="plan-counts">
          {edit
            ? edit.mode === "update"
              ? `1 widget · changes ${edit.target.displayName} in place${
                  edit.usedOn ? ` · used on ${edit.usedOn}` : ""
                }`
              : `1 widget · a new widget${
                  edit.cellLabel ? ` · goes into ${edit.cellLabel}` : ""
                } · ${edit.target.displayName} isn't changed`
            : cell
              ? `Goes into: ${cell.label}`
              : botMode
                ? where
                  ? `1 bot · goes on: ${where.name}`
                  : "1 bot · on no dashboard — its results stay in the Bots view"
                : countsLine(plan)}
        </span>

        <PlanSection
          title={
            edit
              ? "What changes"
              : target && !botMode
                ? "What it adds"
                : "What it makes"
          }
          testId="plan-pieces"
        >
          {GROUPS.map(([kind, label]) => {
            const group = pieces.filter((p) => p && p.kind === kind);
            if (!group.length) return null;
            return (
              <div key={kind} className="flex flex-col">
                <SectionLabel text={label} />
                {group.map((p, gi) => {
                  const index = pieces.indexOf(p);
                  const src = pieceSource(p);
                  const base = SOURCE[src] || {
                    label: src,
                    state: "neutral",
                  };
                  const source = edit
                    ? edit.mode === "update"
                      ? { label: "Change", state: "warning" }
                      : { label: "New widget", state: "closed" }
                    : src === "new"
                      ? { ...base, label: `New ${p.kind}` }
                      : base;
                  const meta = pieceMeta(p);
                  return (
                    <div
                      key={index}
                      className={`flex flex-col gap-2 py-3 ${gi ? `border-t ${hairline}` : ""}`}
                      data-testid="plan-piece"
                    >
                      <div className="flex flex-row items-start gap-3">
                        <FontAwesomeIcon
                          icon={KIND_ICON[p.kind] || "puzzle-piece"}
                          className={`h-4 w-4 mt-6 flex-shrink-0 ${muted}`}
                        />
                        <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
                          <StatusBadge
                            state={source.state}
                            label={source.label}
                          />
                          <span className={`text-sm font-medium ${strong}`}>
                            {p.name}
                          </span>
                          {meta ? (
                            <span className={`text-xs ${muted}`}>{meta}</span>
                          ) : null}
                        </div>
                        <div className="dr-row-actions flex flex-row items-center gap-1 flex-shrink-0 pt-5">
                          {p.kind === "widget" && !edit ? (
                            <Button2
                              title="Swap…"
                              size="sm"
                              onClick={() => setSwapIndex(index)}
                            />
                          ) : null}
                          {single || botMode ? null : (
                            // A cell's plan is this one widget (a bot plan,
                            // this one bot): Swap, not remove.
                            <ButtonIcon
                              icon="xmark"
                              ariaLabel={`Remove ${p.name} from the plan`}
                              onClick={() =>
                                editPlan(
                                  removePiece(plan, index),
                                  `removed ${p.name}`,
                                )
                              }
                            />
                          )}
                        </div>
                      </div>
                      {edit && p.kind === "widget" ? (
                        <EditPlanDetails piece={p} edit={edit} muted={muted} />
                      ) : null}
                      {p.kind === "bot" && p.source === "new" ? (
                        <BotPlanDetails
                          piece={p}
                          muted={muted}
                          strong={strong}
                          open={openBots.includes(index)}
                          onToggle={() =>
                            setOpenBots((o) =>
                              o.includes(index)
                                ? o.filter((x) => x !== index)
                                : [...o, index],
                            )
                          }
                        />
                      ) : null}
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
        </PlanSection>

        {/* What it will look like, with made-up data (CRE-003 AC6) —
                  a new dashboard's grid; not drawn for one the user has. */}
        {/* A cell build shows the real widget running before it goes in. */}
        {target || single || botMode ? null : (
          <PlanSketch plan={plan} compact={compact} />
        )}

        {checklist.length ? (
          <PlanSection title="Before building" testId="plan-before">
            {checklist.map((it) => {
              const skipped = isSkipped(it, checks, have);
              const done = isDone(it, checks, have) && !skipped;
              return (
                <div
                  key={it.id}
                  className="flex flex-row items-center gap-3 text-sm py-1"
                  data-testid="checklist-item"
                >
                  <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
                    <StatusBadge
                      state={done ? "success" : "neutral"}
                      label={done ? "Done" : "To do"}
                    />
                    <span className={done ? muted : strong}>{it.label}</span>
                    {it.package ? (
                      <span className={`text-xs ${muted}`}>{it.package}</span>
                    ) : null}
                    {skipped ? (
                      <span
                        className={`text-xs ${muted}`}
                        data-testid="checklist-skipped"
                      >
                        {" "}
                        · skipped — what needs it waits
                      </span>
                    ) : null}
                  </span>
                  {done ? null : (
                    <Button2
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
          </PlanSection>
        ) : null}

        {/* A cell's (or bot's) plan keeps Build in view (the mockup): this
            goes below. */}
        {single || botMode ? null : expectSection}

        {broken ? (
          <span
            className="text-xs text-red-500 whitespace-pre-wrap"
            data-testid="plan-errors"
          >
            The plan isn't complete yet: {check.errors.join(" ")}
          </span>
        ) : null}
        <div className="flex flex-row flex-wrap items-center gap-3">
          <Button
            title={buildLabel}
            onClick={buildPlan}
            disabled={unanswered || broken}
          />
          {broken ? (
            <Button3
              title="Ask the Planner to fix it"
              size="sm"
              onClick={() =>
                answer(
                  `Please fix these problems in the plan:\n${check.errors
                    .map((e) => `- ${e}`)
                    .join("\n")}`,
                )
              }
            />
          ) : null}
          <span
            className={`text-xs ${buildError ? "text-red-500" : muted}`}
            data-testid="plan-ready"
          >
            {buildError
              ? buildError
              : unanswered
                ? "Answer the Planner's questions first."
                : broken
                  ? "Ask the Planner to fix the plan first."
                  : ready
                    ? "Starting the build…"
                    : resumeFrom
                      ? "What's built is kept — only what's new or changed gets built."
                      : edit
                        ? "Nothing changes until you've seen it running and said OK."
                        : cell
                          ? `Nothing goes into ${cell.label} until you've seen it running.`
                          : botMode && !removedNote
                            ? "Nothing is saved until you press Build."
                            : removedNote ||
                              (target
                                ? `Saved · nothing on ${target.name} changes until you press this.`
                                : "Saved · nothing has been built or installed yet.")}
          </span>
        </div>
        {single || botMode ? expectSection : null}
      </div>
    ) : null;
  const dialogs = (
    <>
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
          onSkip={() => finish(dialog.item, "skipped")}
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
    </>
  );
  // One scroll area: the Planner's questions end the conversation, and the
  // chat opens at its end, so what's asked sits just above the reply box and
  // scrolls out of the way with everything else.
  const foot = (
    <div className="flex-shrink-0 flex flex-col" data-testid="chat-foot">
      <div className={split || compact ? "" : "mx-auto w-full max-w-3xl"}>
        <ChatComposer
          ariaLabel="Reply to the Planner"
          value={reply}
          onChange={(v) => setReply(v)}
          onSend={() => answer(reply)}
          busy={busy}
          placeholder={
            busy ? "The Planner is working…" : "Answer, or ask for changes…"
          }
          className={compact ? "" : split ? "px-4 py-3" : "px-6 py-3"}
        />
      </div>
    </div>
  );

  if (split) {
    return (
      <div className="flex-1 min-h-0 flex flex-row" data-testid="create-plan">
        <div
          className="flex-1 min-w-0 overflow-y-auto"
          data-testid="plan-column"
        >
          <div className="mx-auto w-full max-w-3xl flex flex-col gap-4 px-6 py-8">
            {planCard}
          </div>
        </div>
        <div
          className={`flex-1 min-w-0 min-h-0 flex flex-col border-l ${hairline}`}
          data-testid="chat-column"
        >
          <div
            ref={chatScroll}
            className="flex-1 min-h-0 overflow-y-auto"
            data-testid="chat-scroll"
          >
            <div className="flex flex-col gap-4 px-4 py-6">
              {chatMessages}
              {questionsBlock}
            </div>
          </div>
          {foot}
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="create-plan">
      <div
        ref={chatScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        data-testid="chat-scroll"
      >
        <div
          className={`mx-auto w-full max-w-3xl flex flex-col ${
            compact ? "gap-3 px-3 py-3" : "gap-4 px-6 py-8"
          }`}
        >
          {chatMessages}
          {planCard}
          {questionsBlock}
        </div>
      </div>
      {dialogs}
      {foot}
    </div>
  );
};

export default CreatePlanStep;
