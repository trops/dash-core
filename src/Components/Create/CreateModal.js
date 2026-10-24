import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Modal,
  ThemeContext,
  FontAwesomeIcon,
  ButtonIcon,
  Button,
  Button2,
  Button3,
  Heading2,
  SubHeading3,
  TextArea,
  ChoiceMenu,
  Stepper,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { BotDetail } from "../Settings/details/BotDetail";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useAiBackend } from "../../hooks/useAiBackend";
import { getWidgetBuilderRenderer } from "../../utils/widgetBuilderRenderer";
import { CreateScoutStep } from "./CreateScoutStep";
import { CreatePlanStep } from "./CreatePlanStep";
import { CreateEdit } from "./CreateEdit";
import { StarterCards } from "./StarterCards";
import { starterPackages, starterToPlan, remixRequest } from "./starters";
import { foldCreate } from "./CreateDockPanel";
import { PlanMenu } from "./PlanMenu";
import { pickType, autoPickLabel } from "./autoType";
import { themeFromPrompt } from "./themeFromPrompt";
import { teamContext, teamLine, contextRequest } from "./teamContext";
import { UnfinishedPlans } from "./UnfinishedPlans";
import {
  useRegistryAuthGate,
  isRegistryAuthError,
} from "../../hooks/useRegistryAuthGate";
import {
  BOT_STEPS,
  botStepIndex,
  whereOptions,
  pieceFromBot,
  pieceFromStarter,
  botSeed,
} from "./botCreate";
import {
  createTypes,
  PROMPT_PLACEHOLDER,
  CREATE_HINT,
  canSend,
  noAiOptions,
  normalizeCreateType,
  routeCreate,
} from "./createRouting";

// Widget config (declared `events`) by component name — the bot form's
// event picker.
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

const EMPTY = [];

// A cell build's steps, shown as a wizard in Create's header (Phase 2b).
export const CELL_STEPS = [
  "Describe",
  "Find",
  "Plan",
  "Build",
  "Preview",
  "Place",
];

/**
 * Where a cell build is: 0 Describe (the start screen), 1 Find (the
 * Scout), 2 Plan (the Planner), 3 Build (Builder, Checker, install), 4
 * Preview (waiting for the user), 5 Place (done — into the cell).
 */
export function cellStepIndex({ scout, plan, buildStatus }) {
  if (buildStatus === "done") return 5;
  if (buildStatus === "waiting-for-you") return 4;
  if (buildStatus) return 3;
  if (plan) return 2;
  if (scout) return 1;
  return 0;
}

/**
 * A widget built on its own (Phase 3b): its name for the Done screen — its
 * config's display name, else its component's last part as words
 * ("ai-built.order-lookup.OrderLookup" → "Order Lookup").
 */
export function builtWidgetName(made) {
  const component = made && made.component ? String(made.component) : "";
  const cfg = component ? ComponentManager.config(component) : null;
  const named = cfg && (cfg.displayName || cfg.name);
  if (named && named !== "My Workspace") return named;
  const tail = component.split(".").pop();
  return tail ? tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2") : "Your widget";
}
// The no-AI starts every type shows (dashboards, themes) — not for a cell.
const NO_AI_COMMON_KEYS = new Set(noAiOptions("__none__").map((o) => o.key));

/**
 * A Scout match as the one widget of a cell build ("Use in this cell",
 * consolidation Phase 2b): { kind, name, source, package } — the package as
 * "@scope/name" (the Scout may give a component id or a bare "scope/name").
 * null without a package (the Planner works it out instead).
 */
export function cellPieceFromMatch(match) {
  if (!match || !match.name) return null;
  const raw = String(match.package || "").trim();
  if (!raw) return null;
  const parts = raw.split(".");
  const pkg =
    !raw.includes("/") && parts.length >= 3
      ? `@${parts[0]}/${parts[1]}`
      : raw.startsWith("@")
        ? raw
        : `@${raw}`;
  const source =
    match.source === "Registry"
      ? "registry"
      : match.source === "AI-built"
        ? "ai-built"
        : "yours";
  const piece = { kind: "widget", name: match.name, source, package: pkg };
  // A component id names the very widget (packages can hold several).
  if (!raw.includes("/") && parts.length >= 3) piece.component = raw;
  return piece;
}

/**
 * CreateModal — one place to start making things (create-entry PRD CRE-001,
 * CRE-005, CRE-008). A prompt box with Type and the AI under it, and a row to
 * start without AI. Send hands the prompt to the right builder:
 *
 *   Widget → the Widget Builder here (the host's, via
 *            setWidgetBuilderRenderer), the prompt as its first message;
 *            without one registered, the builder's own window
 *   Bot    → the bot form here, the prompt as its instructions
 *
 * Both open as a step inside Create: ← goes back to the start screen with the
 * prompt kept (CRE-005 AC1).
 *
 * Dashboard and Theme are listed but can't be made with AI yet; their no-AI
 * starts are always in the row below.
 *
 * Questions and Recent live in the sidebar's Create panel; this screen is
 * only for making something (consolidation Phase 3b).
 *
 * @param {boolean} open
 * @param {(open: boolean) => void} setIsOpen
 * @param {string} [initialType]          "widget" | "bot"
 * @param {string|number} [workspaceId]   a new bot joins this dashboard's team
 * @param {Array<object>} [workspaces]
 * @param {(key: string) => void} onStartWithoutAi  a no-AI row key (createRouting)
 * @param {(saved: object) => void} [onBotCreated]
 * @param {() => void} [onOpenAiSettings]
 */
export const CreateModal = ({
  open,
  setIsOpen,
  initialType = "widget",
  workspaceId = null,
  workspaces = EMPTY,
  onStartWithoutAi = null,
  onBotCreated = null,
  onOpenAiSettings = null,
  // Open a widget the Scout found: ({ source, name, package }) — the host
  // shows it on the Widgets page (yours) or in the registry (to install).
  onOpenWidget = null,
  // Open a dashboard a plan build made: (workspaceId) — the live dashboard.
  onOpenDashboard = null,
  // Open on a plan conversation from Recent — Expand from the dock (4e-2).
  initialRecentId = null,
  // Open on a plan to start from — Open as a plan from Ask (5e).
  initialSeed = null,
  // Open the theme editor on a theme Create made (unsaved) — Type: Theme.
  onOpenTheme = null,
  // An empty cell being edited (consolidation Phase 2b): { workspaceId,
  // gridItemId, cellNumber, pageId, scope } — Create makes one widget for
  // it through the Dash team, with a preview, and the editor places it.
  cell = null,
  // What to ask, filled in (a lead's hand-off).
  initialPrompt = "",
  // A lead's hand-off (2c-2): { note, from } — its note goes to the Scout
  // and the Planner with what Dash knows about the dashboard.
  initialContext = null,
  // A change to one widget the user has (consolidation Phase 3, Change with
  // AI): { component, sourcePackage, itemId, workspaceId, pageId, settings,
  // providers, error } — Create › Change <widget> (CreateEdit).
  edit = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const ai = useAiBackend();
  // Reading a registry bot's package needs the user signed in to the
  // registry (searching doesn't): ask, then carry on.
  const { ensureAuthed, authGate } = useRegistryAuthGate();

  const [type, setType] = useState(normalizeCreateType(initialType));
  // Type: Auto (phase 5c): { prompt } while it works out what to make, and
  // the pick it made ({ type, why, by: "ai" | "guess" }) for the header.
  const [autoStep, setAutoStep] = useState(null);
  const [autoPick, setAutoPick] = useState(null);
  // Type: Theme: { prompt, error? } while the AI makes it.
  const [themeStep, setThemeStep] = useState(null);
  // Answers that arrive after Back or Close are dropped.
  const askSeq = useRef(0);
  const [prompt, setPrompt] = useState("");
  // null = the start screen; { bot, workspaceId } = the bot form.
  const [botForm, setBotForm] = useState(null);
  // null = not building; { initialPrompt, resumeDraftId, title } = the Widget
  // Builder inside Create.
  const [builderStep, setBuilderStep] = useState(null);
  // The Builder step's say on leaving (unsaved work): a function → true |
  // false | Promise of either, registered by the Builder (setLeaveGuard).
  const leaveGuardRef = useRef(null);
  const setLeaveGuard = useCallback((fn) => {
    leaveGuardRef.current = typeof fn === "function" ? fn : null;
  }, []);
  // null = no search; { prompt, detail } = the Scout looking first (slice 4).
  const [scoutStep, setScoutStep] = useState(null);
  // null = no plan; { prompt } = planning a dashboard with the Planner (4a).
  const [planStep, setPlanStep] = useState(null);
  // A widget built on its own (Phase 3b): { name } — the Done screen.
  const [widgetDone, setWidgetDone] = useState(null);
  // The plan's { recentId, busy }, for Fold (4e-2).
  const [planInfo, setPlanInfo] = useState(null);
  // A lead's hand-off note ({ note, from }), shown and passed on (2c-2).
  const [leadContext, setLeadContext] = useState(initialContext);
  // The dashboard a Type: Dashboard plan changes (the open one, or the
  // one a lead handed off for).
  const [planDashboardId, setPlanDashboardId] = useState(workspaceId);
  // Where a new bot goes (Phase 2c-1): a dashboard's id, or "" for none.
  const [whereId, setWhereId] = useState(
    workspaceId != null ? String(workspaceId) : "",
  );
  // A bot plan (2c-1) — the Scout looking for one, or the Planner planning it.
  // A plan reopened from Recent (or expanded from the dock) says so itself.
  const botPlan = !!(
    (planStep && (planStep.bot || (planInfo && planInfo.bot))) ||
    (scoutStep && scoutStep.bot)
  );
  // A cell or bot build's live status, for the step bar (Phase 2b).
  const [cellBuildStatus, setCellBuildStatus] = useState(null);
  // A widget on its own builds like a cell's (Phase 3b).
  const widgetPlan = !!(planStep && planStep.widget);
  const cellBuildId =
    (cell || botPlan || widgetPlan) && planInfo
      ? planInfo.buildId || null
      : null;
  const cellWidget =
    (cell || widgetPlan) && planInfo ? planInfo.widgetName || "" : "";
  useEffect(() => {
    setCellBuildStatus(cellBuildId ? "running" : null);
    const bots = typeof window !== "undefined" ? window.mainApi?.bots : null;
    if (!cellBuildId || !bots || !bots.onPlanBuild) return undefined;
    let alive = true;
    const id = bots.onPlanBuild((payload) => {
      if (payload && payload.buildId === cellBuildId && payload.state) {
        setCellBuildStatus(payload.state.status || "running");
      }
    });
    // A bot build takes a moment — it can be done before we listen.
    if (bots.getPlanBuild) {
      Promise.resolve(bots.getPlanBuild(cellBuildId))
        .then((res) => {
          if (alive && res && res.state && res.state.status) {
            setCellBuildStatus(res.state.status);
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [cellBuildId]);
  const [bots, setBots] = useState(EMPTY);
  // Starters (CRE-002, 5b): registry dashboards tagged "starter" with bots.
  const [starters, setStarters] = useState(EMPTY);
  // Each open starts fresh on the requested type.
  useEffect(() => {
    if (!open) return;
    setType(normalizeCreateType(initialType));
    setPrompt(initialPrompt || "");
    setWhereId(workspaceId != null ? String(workspaceId) : "");
    setPlanDashboardId(workspaceId);
    setLeadContext(initialContext);
    setBotForm(null);
    setBuilderStep(null);
    if (initialRecentId) {
      setPlanStep({ prompt: "", recentId: initialRecentId });
    } else if (initialSeed) {
      setPlanStep({ prompt: "", seed: initialSeed });
    }
  }, [
    open,
    initialType,
    initialRecentId,
    initialSeed,
    initialPrompt,
    initialContext,
    workspaceId,
  ]);

  // The cursor starts in the prompt (CRE-001 AC2). The dialog focuses its
  // first control (Close) on open, so take focus back right after.
  useEffect(() => {
    if (!open || botForm || builderStep) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById("create-prompt");
      if (el) el.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open, botForm, builderStep]);

  // Starters, for Auto and Dashboard (the registry index; none offline).
  const wantsStarters = type === "auto" || type === "dashboard";
  useEffect(() => {
    if (!open || !wantsStarters) return undefined;
    let alive = true;
    const registry = window.mainApi && window.mainApi.registry;
    if (!registry || !registry.fetchIndex) return undefined;
    Promise.resolve(registry.fetchIndex())
      .then((index) => alive && setStarters(starterPackages(index)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, wantsStarters]);

  // A starter opens as a plan the Planner adapts — never built directly.
  const pickStarter = (card, pkg, config) => {
    const plan = starterToPlan(config, pkg);
    setPlanStep({
      prompt: "",
      seed: {
        plan,
        request: remixRequest(card, plan),
        label: `Start from the ${card.name} starter`,
      },
    });
  };

  // Other bots → "Another bot" events in the bot form's picker, and what's
  // on a dashboard for the team context (2c-2).
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.bots?.list) return undefined;
    Promise.resolve(api.bots.list())
      .then((list) => {
        if (alive && Array.isArray(list)) setBots(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, botForm]);

  if (!open) return null;

  // Change with AI: the change, start to finish (CreateEdit).
  if (edit) {
    return (
      <Modal
        isOpen={open}
        setIsOpen={(v) => (v ? setIsOpen(true) : setIsOpen(false))}
        width="w-11/12"
        height="h-5/6"
      >
        <div
          className={`dr-modal-surface flex flex-col h-full w-full rounded-lg overflow-clip border ${
            panelStyles.backgroundColor || ""
          } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
          data-testid="create-modal"
        >
          <CreateEdit
            key={edit.component || "edit"}
            edit={edit}
            workspaces={workspaces}
            onClose={() => setIsOpen(false)}
          />
        </div>
      </Modal>
    );
  }

  // Closing ends any step (builder or bot form) here, so reopening starts on
  // the start screen — never a flash of the last builder, which would rerun
  // its startup (chat reset, draft resume) before the reset effect.
  const close = ({ saveScout = true } = {}) => {
    // Closed while the Scout was still looking: nothing had saved the
    // request yet (the plan step saves on its first open), so it goes under
    // Unfinished now — reopening it asks the Planner. (Not when a match was
    // picked: the user was helped.)
    if (saveScout && scoutStep && !planStep && !cell) {
      const recents = window.mainApi && window.mainApi.bots;
      if (recents && recents.saveCreateRecent) {
        Promise.resolve(
          recents.saveCreateRecent({
            prompt: scoutStep.prompt,
            // The Scout looks first for a bot or a widget (a cell is
            // excluded above); a widget is saved as one so it reopens as one.
            conversation: scoutStep.bot
              ? { bot: { where: botWhere } }
              : { widget: true },
          }),
        ).catch(() => {});
      }
    }
    // A cell build ends here: closed early, it stops (nothing half-done is
    // left running, or installed unseen, for a cell no one is waiting on).
    if (
      (cell || (planStep && planStep.widget)) &&
      planInfo &&
      planInfo.buildId
    ) {
      const bots = window.mainApi && window.mainApi.bots;
      if (bots && bots.stopPlanBuild) {
        Promise.resolve(bots.stopPlanBuild(planInfo.buildId)).catch(() => {});
      }
    }
    askSeq.current += 1;
    setPlanStep(null);
    setWidgetDone(null);
    setScoutStep(null);
    setBuilderStep(null);
    setBotForm(null);
    setAutoStep(null);
    setAutoPick(null);
    setThemeStep(null);
    setIsOpen(false);
  };
  // A cell: the Dash team builds it, so only a description is needed.
  const cellLabel = cell
    ? `cell ${cell.cellNumber}${(() => {
        const ws = (workspaces || []).find(
          (w) => w && String(w.id) === String(cell.workspaceId),
        );
        return ws && ws.name ? ` on ${ws.name}` : "";
      })()}`
    : "";
  const sendable = cell
    ? !!String(prompt || "").trim()
    : canSend({ type, prompt, aiBackend: ai.effective });
  // Create › Bot's start screen (2c-1): the bot, and Where it goes.
  const isBot = !cell && type === "bot";
  // The bot's step bar: on its start screen, and while the Dash team works.
  const botSteps =
    botPlan ||
    (isBot &&
      !botForm &&
      !builderStep &&
      !autoStep &&
      !themeStep &&
      !planStep &&
      !scoutStep);
  // The AI picker shows for types that ask the AI here.
  const needsAi = type === "widget" || type === "theme" || type === "auto";
  const noAi =
    (type === "widget" || type === "theme") &&
    ai.effective === null &&
    ai.cliAvailable !== null;

  const Builder = getWidgetBuilderRenderer();
  // Leave the Builder step only when it agrees (it asks about unsaved
  // work); every other step leaves at once.
  const leaving = (action) => () => {
    const guard = builderStep && leaveGuardRef.current;
    if (!guard) {
      action();
      return;
    }
    Promise.resolve(guard()).then((ok) => {
      if (ok) {
        leaveGuardRef.current = null;
        action();
      }
    });
  };

  // The Widget Builder: inside Create when the host registered one, else its
  // own window (the old event).
  const openBuilder = (detail, title) => {
    if (Builder) {
      setBuilderStep({
        initialPrompt: detail.prompt || null,
        resumeDraftId: detail.resumeDraftId || null,
        title,
      });
      return;
    }
    close();
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", { detail }),
    );
  };

  const send = () => {
    if (!sendable) return;
    if (cell) {
      // The Scout looks first; with nothing that fits, the Planner plans it.
      const text = prompt.trim();
      if (window.mainApi?.bots?.listDashTeam) {
        setScoutStep({ prompt: text, detail: { prompt: text } });
      } else {
        setPlanStep({ prompt: text });
      }
      return;
    }
    setAutoPick(null);
    perform(routeCreate({ type, prompt, workspaceId }));
  };

  // A theme from the description, opened unsaved in the theme editor.
  const makeTheme = (text) => {
    const seq = ++askSeq.current;
    setThemeStep({ prompt: text });
    themeFromPrompt(text, {
      backend: ai.effective,
      providers: appContext.providers,
    }).then(
      (theme) => {
        if (seq !== askSeq.current) return;
        close();
        if (onOpenTheme) onOpenTheme(theme);
      },
      (err) => {
        if (seq !== askSeq.current) return;
        setThemeStep({
          prompt: text,
          error: (err && err.message) || "The theme couldn't be made.",
        });
      },
    );
  };

  // Auto: work out what to make, then carry on as that type.
  const decide = (text) => {
    const seq = ++askSeq.current;
    setAutoStep({ prompt: text });
    pickType(text, {
      backend: ai.effective,
      providers: appContext.providers,
      // A change to one of these goes to the Planner (5e-2b).
      dashboards: (workspaces || []).map((w) => w && (w.name || w.label)),
    }).then((pick) => {
      if (seq !== askSeq.current) return;
      setAutoStep(null);
      setAutoPick(pick);
      perform(routeCreate({ type: pick.type, prompt: text, workspaceId }));
    });
  };

  const perform = (action) => {
    if (!action) return;
    if (action.kind === "auto") {
      decide(action.detail.prompt);
      return;
    }
    if (action.kind === "theme") {
      makeTheme(action.detail.prompt);
      return;
    }
    if (action.kind === "widget-plan") {
      // The Scout looks for something that already does this first (CRE-009),
      // then the Dash team plans and builds one widget (Phase 3b). Without
      // the Dash team: the Widget Builder, to build it by hand.
      if (
        action.detail &&
        action.detail.prompt &&
        typeof window !== "undefined" &&
        window.mainApi?.bots?.listDashTeam
      ) {
        setScoutStep({ prompt: action.detail.prompt, detail: action.detail });
      } else {
        openBuilder({}, "New widget");
      }
    } else if (action.kind === "dashboard-plan") {
      setPlanStep({ prompt: action.detail.prompt });
    } else if (action.kind === "bot-plan") {
      // The Scout looks for a bot first, then the Planner plans one (2c-1);
      // without the Dash team, the form, as before.
      if (typeof window !== "undefined" && window.mainApi?.bots?.listDashTeam) {
        setScoutStep({ prompt: action.detail.prompt, bot: true });
      } else {
        setBotForm({
          bot: { instructions: action.detail.prompt },
          workspaceId: whereId || null,
        });
      }
    } else if (action.kind === "bot-form") {
      setBotForm({ bot: action.bot, workspaceId: action.workspaceId });
    }
  };

  // Where a new bot goes: { id, name }, or null (Unassigned).
  const botWhere = (() => {
    if (!whereId) return null;
    const ws = (workspaces || []).find((w) => w && String(w.id) === whereId);
    return {
      id: whereId,
      name: (ws && (ws.name || ws.label)) || `Dashboard ${whereId}`,
    };
  })();
  // What Dash knows about a dashboard (its widgets and bots) — told to the
  // Scout and Planner with a lead's note (2c-2). Read from Dash's own data.
  const workspaceOf = (id) =>
    id == null || id === ""
      ? null
      : (workspaces || []).find((w) => w && String(w.id) === String(id)) ||
        null;
  const teamOn = (id) => teamContext(workspaceOf(id), bots);
  // A bot's: where it goes. A dashboard plan's: only for a hand-off (its
  // dashboard is the one the lead works for).
  const botContext = (id) => contextRequest(teamOn(id), leadContext);
  const dashContext = leadContext
    ? contextRequest(teamOn(planDashboardId), leadContext)
    : "";
  // A lead's widget or layout hand-off changes its dashboard: said up top.
  const handedOffTitle =
    !cell && !isBot && leadContext && type === "dashboard"
      ? `Changes to ${
          (workspaceOf(planDashboardId) || {}).name || "the dashboard"
        }`
      : "";
  // Said on the start screen: the lead's note, and the dashboard's team.
  const contextNote =
    !cell && leadContext && leadContext.note
      ? `From the ${leadContext.from || "team lead"}: ${leadContext.note}`
      : "";
  const contextTeam = cell
    ? ""
    : isBot
      ? teamLine(teamOn(whereId))
      : leadContext
        ? teamLine(teamOn(planDashboardId))
        : "";
  // A bot the Scout found, as the plan's one bot (a copy): one of the
  // user's (by id), or a registry dashboard package's (by name).
  const useBot = async (match) => {
    const asked = scoutStep ? scoutStep.prompt : "";
    // The Scout's reply stays up while the bot is read (a registry package
    // can take a moment) — no flash of the start screen.
    const api = window.mainApi || {};
    let piece = null;
    // Why a found bot couldn't be used, said in the plan's conversation.
    let why = "";
    try {
      if (match.source === "Registry") {
        const pkgName = String(match.package || "")
          .replace(/^@[^/]+\//, "")
          .trim();
        const read = () =>
          pkgName && api.dashboardConfig && api.dashboardConfig.getPackageConfig
            ? api.dashboardConfig.getPackageConfig(pkgName)
            : null;
        let res = await read();
        if (res && !res.success && isRegistryAuthError(res.error)) {
          const signedIn = await ensureAuthed({
            message: `Sign in to the Dash registry to use ${match.name}.`,
          });
          if (signedIn) res = await read();
          else
            why = `You didn't sign in to the registry, so ${match.name} couldn't be read — the Planner plans one like it.`;
        }
        const config = res && res.success ? res.config : null;
        piece = config ? pieceFromStarter(config, {}, match.name) : null;
      } else if (api.bots && api.bots.list) {
        const list = (await api.bots.list()) || [];
        const found =
          list.find((b) => b && b.id === match.package) ||
          list.find((b) => b && b.name === match.name);
        piece = found ? pieceFromBot(found, botWhere) : null;
      }
    } catch (_e) {
      piece = null;
    }
    setScoutStep(null);
    if (piece) {
      setPlanStep({
        prompt: "",
        seed: botSeed(piece, botWhere),
        bot: { where: botWhere },
      });
      return;
    }
    // It couldn't be read: the Planner plans one like it.
    setPlanStep({
      prompt: `${asked}\n\nBase it on the ${match.name} bot (${match.package}).`,
      bot: { where: botWhere },
      note:
        why ||
        `${match.name} couldn't be read — the Planner plans one like it.`,
    });
  };

  const startWithoutAi = (key) => {
    if (key === "blank-bot") {
      // On the dashboard Where names (2c-1).
      setBotForm({ bot: null, workspaceId: whereId || null });
      return;
    }
    close();
    if (onStartWithoutAi) onStartWithoutAi(key);
  };

  const saveBot = async (definition) => {
    const saved = await window.mainApi.bots.save(definition);
    close();
    if (onBotCreated) onBotCreated(saved);
    return saved;
  };

  const aiFooter = onOpenAiSettings ? (
    <Button3
      title="AI settings…"
      size="sm"
      onClick={() => {
        close();
        onOpenAiSettings();
      }}
    />
  ) : null;

  // Use in this cell: the match is the one widget of a cell build — it's
  // installed (registry) and previewed, then placed. Without a package the
  // Planner works it out.
  const useInCell = (match) => {
    const piece = cellPieceFromMatch(match);
    setScoutStep(null);
    if (!piece) {
      setPlanStep({ prompt: `Use the ${match.name} widget` });
      return;
    }
    const label = `Use ${match.name} in ${cellLabel}`;
    setPlanStep({
      prompt: "",
      seed: {
        plan: { summary: label, pieces: [piece] },
        request: null,
        label,
        autoBuild: true,
      },
    });
  };
  // Done (Looks good, installed): the editor puts it in the cell — an
  // unsaved change, with the picked connection and settings.
  const placeInCell = (made) => {
    const inputs = (made && made.inputs) || {};
    if (made && made.component) {
      window.dispatchEvent(
        new CustomEvent("dash:place-widget-in-cell", {
          detail: {
            widgetComponentName: made.component,
            cellNumber: cell.cellNumber,
            gridItemId: cell.gridItemId,
            workspaceId: cell.workspaceId,
            pageId: cell.pageId ?? null,
            scope: cell.scope || "main",
            userPrefs: inputs.settings || null,
            selectedProviders: inputs.providers || null,
          },
        }),
      );
    }
    close();
  };

  const start = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <Heading2
            title={
              cell
                ? "What should this cell show?"
                : isBot
                  ? "What should this bot do?"
                  : "What do you want to make?"
            }
            padding={false}
          />
          <p className={`text-sm ${muted}`}>
            {cell
              ? "Describe the widget. The Dash team checks what you already have, then builds it if needed — you see it running before it goes in."
              : isBot
                ? "Dash checks whether you already have one, then the Planner plans it with you. It's saved paused — you try it before turning it on."
                : "Describe it and Dash works it out with you, or start without AI below."}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div
            className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
          >
            <TextArea
              id="create-prompt"
              aria-label="What do you want to make?"
              value={prompt}
              onChange={(value) => {
                setPrompt(value);
                // A cleared request ends a hand-off (its note no longer fits).
                if (!String(value || "").trim()) setLeadContext(null);
              }}
              placeholder={PROMPT_PLACEHOLDER[type] || ""}
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="flex flex-row flex-wrap items-center gap-2">
              {cell ? (
                <span
                  className={`text-sm ${muted}`}
                  data-testid="create-cell-type"
                >
                  Type: Widget
                </span>
              ) : (
                <ChoiceMenu
                  label="Type"
                  value={type}
                  options={createTypes()}
                  onChange={(next) => {
                    // Another type is another request: the hand-off's note
                    // stays with the one it was for.
                    if (next !== type) setLeadContext(null);
                    setType(next);
                  }}
                />
              )}
              {isBot ? (
                <ChoiceMenu
                  label="Where"
                  value={whereId}
                  options={whereOptions(workspaces)}
                  onChange={setWhereId}
                />
              ) : null}
              <div className="flex-1" />
              {needsAi && !cell && (
                <ChoiceMenu
                  label="AI"
                  value={ai.effective}
                  options={ai.options}
                  onChange={ai.setPreferred}
                  align="right"
                  footer={aiFooter}
                />
              )}
              <Button title="Send" onClick={send} disabled={!sendable} />
            </div>
          </div>
          {/* A bot: the line under the heading says it (the mockup). */}
          {!isBot && (cell || CREATE_HINT[type]) ? (
            <span className={`text-xs ${muted}`} data-testid="create-hint">
              {cell
                ? "You see it running before it's installed — nothing on the dashboard changes until you say so."
                : CREATE_HINT[type]}
            </span>
          ) : null}
          {/* What goes along to the Dash team (2c-2): the lead's note, and
              what's on the dashboard — nothing hidden from the user. */}
          {contextNote || contextTeam ? (
            <div
              className={`flex flex-col gap-1 text-xs ${muted}`}
              data-testid="create-context"
            >
              {contextNote ? <span>{contextNote}</span> : null}
              {contextTeam ? <span>{contextTeam}</span> : null}
            </div>
          ) : null}
        </div>

        {/* Plans you didn't finish (QA 2026-10-22): Continue reopens one
            as it was left; a stopped build offers Continue building. */}
        {!cell ? (
          <UnfinishedPlans
            onContinue={(row) =>
              setPlanStep({
                prompt: "",
                recentId: row.id,
                // A Create › Widget plan reopens as one.
                ...(row.widget ? { widget: true } : {}),
              })
            }
          />
        ) : null}

        {noAi && !cell && (
          <div className={`flex flex-row items-center gap-2 text-sm ${muted}`}>
            <FontAwesomeIcon icon="circle-info" className="h-3.5 w-3.5" />
            <span>
              No AI is set up yet, so widgets can't be built here. Starting
              without AI still works.
            </span>
            {onOpenAiSettings && (
              <Button3
                title="Set up AI"
                size="sm"
                onClick={() => {
                  close();
                  onOpenAiSettings();
                }}
              />
            )}
          </div>
        )}

        {!cell && wantsStarters && starters.length > 0 && (
          <StarterCards starters={starters} onPick={pickStarter} />
        )}

        <section className="flex flex-col gap-3" data-testid="create-no-ai">
          <SubHeading3 title="Or start without AI" padding={false} />
          <div className="flex flex-row flex-wrap gap-2">
            {(cell || isBot
              ? // A cell: only widget starts (dashboards are made elsewhere);
                // a bot: only the bot form.
                // (An empty cell has its own Add widget; no by-hand row.)
                noAiOptions(cell ? "widget" : "bot").filter(
                  (o) =>
                    !NO_AI_COMMON_KEYS.has(o.key) && o.key !== "widget-by-hand",
                )
              : noAiOptions(type)
            ).map((o) => (
              <Button2 key={o.key} onClick={() => startWithoutAi(o.key)}>
                <span className="inline-flex items-center gap-2">
                  <FontAwesomeIcon icon={o.icon} className="h-3.5 w-3.5" />
                  {o.label}
                </span>
              </Button2>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  const form = botForm && (
    <div className="flex-1 min-h-0 flex flex-col">
      <BotDetail
        key={botForm.bot ? "from-prompt" : "blank"}
        bot={botForm.bot}
        isCreating
        defaultWorkspaceId={botForm.workspaceId}
        providers={appContext.providers || {}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        bots={bots}
        onSave={saveBot}
        onCancel={() => setBotForm(null)}
      />
    </div>
  );

  const scout = scoutStep && !builderStep && (
    <CreateScoutStep
      prompt={scoutStep.prompt}
      cell={!!cell}
      bot={scoutStep.bot ? { where: botWhere ? botWhere.name : null } : null}
      context={scoutStep.bot ? botContext(whereId) : ""}
      onBuildNew={() => {
        const { detail } = scoutStep;
        setScoutStep(null);
        // A bot: the Planner plans one, where Where says (2c-1).
        if (scoutStep.bot) {
          setPlanStep({ prompt: scoutStep.prompt, bot: { where: botWhere } });
          return;
        }
        // A cell (Phase 2b), or a widget on its own (Phase 3b): the Dash
        // team plans and builds it.
        if (cell) setPlanStep({ prompt: detail.prompt || scoutStep.prompt });
        else {
          setPlanStep({
            prompt: detail.prompt || scoutStep.prompt,
            widget: true,
          });
        }
      }}
      onUse={(match) => {
        if (scoutStep.bot) {
          useBot(match);
          return;
        }
        if (cell) {
          useInCell(match);
          return;
        }
        close({ saveScout: false });
        if (onOpenWidget) onOpenWidget(match);
      }}
    />
  );

  // A widget built on its own is in the user's widgets (Phase 3b).
  const widgetDoneView = widgetDone && (
    <div
      className="flex flex-col items-center justify-center flex-1 gap-4 p-8 text-center"
      data-testid="widget-done"
    >
      <Heading2 title={`${widgetDone.name} is in your widgets`} />
      <span className={`text-sm max-w-md ${muted}`}>
        Put it on a dashboard from any empty cell's Add widget, or find it on
        the Widgets page.
      </span>
      <div className="flex flex-row gap-2">
        <Button2
          title="See it on the Widgets page"
          onClick={() => startWithoutAi("open-widgets")}
        />
        <Button title="Done" onClick={close} />
      </div>
    </div>
  );

  const planner = planStep && (
    <CreatePlanStep
      key={planStep.recentId || "new"}
      prompt={planStep.prompt}
      recentId={planStep.recentId || null}
      seed={planStep.seed || null}
      note={planStep.note || ""}
      openDashboardId={cell || planStep.widget ? null : planDashboardId}
      cell={cell ? { label: cellLabel } : null}
      widget={!!planStep.widget}
      onCellDone={
        cell
          ? placeInCell
          : planStep.widget
            ? (made) => setWidgetDone({ name: builtWidgetName(made) })
            : null
      }
      onDiscard={cell || planStep.widget ? close : null}
      bot={planStep.bot || null}
      context={
        planStep.bot
          ? botContext(planStep.bot.where ? planStep.bot.where.id : null)
          : cell || planStep.widget
            ? ""
            : dashContext
      }
      onOpenBot={(botId) => {
        close();
        window.dispatchEvent(
          new CustomEvent("dash:open-bot", { detail: { botId } }),
        );
      }}
      onState={setPlanInfo}
      onOpenDashboard={
        onOpenDashboard
          ? (id) => {
              close();
              onOpenDashboard(id);
            }
          : null
      }
    />
  );

  const builder = builderStep && Builder && (
    <div className="flex-1 min-h-0 flex flex-col">
      <Builder
        key={builderStep.resumeDraftId || "new"}
        initialPrompt={builderStep.initialPrompt}
        resumeDraftId={builderStep.resumeDraftId}
        onClose={close}
        setLeaveGuard={setLeaveGuard}
        onTitle={(title) =>
          title && setBuilderStep((step) => (step ? { ...step, title } : step))
        }
      />
    </div>
  );

  // A step inside Create: the builder or the bot form. ← returns to the
  // start screen (the prompt is kept).
  // A bot plan's place: "for Morning Brief", or nothing (Unassigned).
  // (A plan reopened from Recent reports it through onState.)
  const planBot = planStep
    ? planStep.bot || (planInfo && planInfo.bot) || null
    : null;
  const planWhere = planBot ? planBot.where || null : botWhere;
  const whereSuffix = planWhere ? ` for ${planWhere.name}` : "";
  const botName = planInfo ? planInfo.botName || "" : "";
  const stepTitle = widgetDone
    ? // The screen itself names it; the header only says where you are.
      "Done"
    : builderStep
      ? builderStep.title || "New widget"
      : planBot
        ? // Each step says where it is (the mockup).
          cellBuildStatus === "done"
          ? `${botName || "The bot"} is ready`
          : cellBuildStatus
            ? `Building · ${botName || "the bot"}${whereSuffix}`
            : `Plan a bot${whereSuffix}`
        : scoutStep && scoutStep.bot
          ? planWhere
            ? `Bot for ${planWhere.name}`
            : "New bot"
          : planStep
            ? cell
              ? // Each step says where it is (as the mockup).
                cellBuildStatus === "waiting-for-you"
                ? `Preview · ${cellWidget || cellLabel}`
                : cellBuildStatus === "done"
                  ? `Placing it in ${cellLabel}`
                  : cellBuildStatus
                    ? `Building · ${cellWidget ? `${cellWidget} ` : ""}for ${cellLabel}`
                    : `Plan a widget for ${cellLabel}`
              : widgetPlan
                ? cellBuildStatus === "waiting-for-you"
                  ? `Preview · ${cellWidget || "your widget"}`
                  : cellBuildStatus
                    ? `Building · ${cellWidget || "your widget"}`
                    : "Plan a widget"
                : "Plan a dashboard"
            : scoutStep
              ? cell
                ? `Looking first · ${cellLabel}`
                : "Looking first"
              : botForm
                ? "New bot"
                : autoStep
                  ? "Deciding what to make"
                  : themeStep
                    ? "New theme"
                    : null;
  // Fold the plan into the dock's Create panel; it carries on there (4e-2).
  // A cell build stays here: it ends in this dashboard's editor.
  const canFold = !cell && !!(planStep && planInfo && planInfo.recentId);
  const fold = () => {
    if (!canFold || planInfo.busy) return;
    foldCreate({ recentId: planInfo.recentId, title: stepTitle });
    close();
  };
  const back = () => {
    // A widget build left behind would run on with no one to preview it
    // (and a cell's would keep the team from placing anything).
    if ((cell || widgetPlan) && planInfo && planInfo.buildId) {
      const bots = window.mainApi && window.mainApi.bots;
      if (bots && bots.stopPlanBuild) {
        Promise.resolve(bots.stopPlanBuild(planInfo.buildId)).catch(() => {});
      }
    }
    askSeq.current += 1;
    setPlanStep(null);
    setWidgetDone(null);
    setScoutStep(null);
    setBuilderStep(null);
    setBotForm(null);
    setAutoStep(null);
    setAutoPick(null);
    setThemeStep(null);
  };
  // Auto picked wrong: back to the start, the prompt kept, Type set to its
  // pick so another is one choice away.
  const changePick = () => {
    const picked = autoPick && autoPick.type;
    back();
    if (picked) setType(picked);
  };

  // Working out what to make, or making a theme: a status, and for a
  // theme that failed, why and Try again.
  const waiting = (autoStep || themeStep) && (
    <div
      className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8"
      data-testid="create-waiting"
    >
      {themeStep && themeStep.error ? (
        <>
          <span className={`text-sm ${strong}`}>{themeStep.error}</span>
          <div className="flex flex-row gap-2">
            <Button3
              title="Try again"
              onClick={() => makeTheme(themeStep.prompt)}
            />
            <Button3 title="Back" onClick={back} />
          </div>
        </>
      ) : (
        <span className={`text-sm ${muted}`} role="status">
          {autoStep ? "Deciding what to make…" : "Making a theme…"}
        </span>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={open}
      setIsOpen={(v) => (v ? setIsOpen(true) : leaving(close)())}
      width="w-11/12"
      height="h-5/6"
    >
      {/* dr-modal-surface: raised above the dimmed page (design guide rule
          2); dr-panel-head: the header's icon buttons are quiet, 28px. */}
      <div
        className={`dr-modal-surface flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
        data-testid="create-modal"
      >
        <div
          className={`dr-panel-head flex-shrink-0 flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
        >
          <div className={`flex items-center gap-3 ${strong}`}>
            {stepTitle ? (
              <ButtonIcon
                icon="arrow-left"
                onClick={leaving(back)}
                ariaLabel="Back"
              />
            ) : null}
            {stepTitle || isBot || handedOffTitle ? (
              // A bot's start screen (or a hand-off's) wears the same
              // breadcrumb as its steps.
              <nav
                aria-label="Where you are"
                className="flex items-center gap-2 text-lg"
              >
                <span className={muted}>Create</span>
                <span className={muted} aria-hidden="true">
                  ›
                </span>
                <span className="font-semibold">
                  {stepTitle ||
                    handedOffTitle ||
                    (botWhere ? `Bot for ${botWhere.name}` : "New bot")}
                </span>
                {autoPick && !autoStep ? (
                  <span
                    className={`text-sm ${muted}`}
                    data-testid="auto-pick"
                    title={autoPick.why || undefined}
                  >
                    · {autoPickLabel(autoPick)}
                  </span>
                ) : null}
              </nav>
            ) : (
              <span className="text-lg font-semibold">
                {cell ? (
                  <>
                    <span className={muted}>Create › </span>
                    Widget for {cellLabel}
                  </>
                ) : (
                  "Create"
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {autoPick && !autoStep ? (
              <Button3 title="Change" size="sm" onClick={changePick} />
            ) : null}
            {canFold ? (
              <ButtonIcon
                icon="down-left-and-up-right-to-center"
                onClick={fold}
                disabled={planInfo.busy}
                ariaLabel="Fold into the sidebar"
                title={
                  planInfo.busy
                    ? "Fold after the Planner answers"
                    : "Fold into the sidebar"
                }
              />
            ) : null}
            {planStep && planInfo && planInfo.recentId ? (
              <PlanMenu
                recentId={planInfo.recentId}
                title={planInfo.title}
                built={planInfo.built}
                onRemoved={back}
              />
            ) : null}
            <ButtonIcon
              icon="xmark"
              onClick={leaving(close)}
              ariaLabel="Close"
            />
          </div>
        </div>
        {cell ? (
          <div
            className={`flex-shrink-0 px-6 pt-3 border-b ${hairline}`}
            data-testid="create-cell-steps"
          >
            <Stepper
              activeStep={cellStepIndex({
                scout: !!scoutStep,
                plan: !!planStep,
                buildStatus: cellBuildStatus,
              })}
              showNavigation={false}
            >
              {CELL_STEPS.map((label) => (
                <Stepper.Step key={label} label={label} />
              ))}
            </Stepper>
          </div>
        ) : null}
        {botSteps ? (
          <div
            className={`flex-shrink-0 px-6 pt-3 border-b ${hairline}`}
            data-testid="create-bot-steps"
          >
            <Stepper
              activeStep={botStepIndex({
                scout: !!scoutStep,
                plan: !!planStep,
                buildStatus: cellBuildStatus,
              })}
              showNavigation={false}
            >
              {BOT_STEPS.map((label) => (
                <Stepper.Step key={label} label={label} />
              ))}
            </Stepper>
          </div>
        ) : null}
        {authGate}
        {builder ||
          widgetDoneView ||
          planner ||
          scout ||
          waiting ||
          (botForm ? form : start)}
      </div>
    </Modal>
  );
};
