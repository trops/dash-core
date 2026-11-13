import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button2,
  Button3,
  ChatComposer,
  ChatMessage,
  FontAwesomeIcon,
  ListRow,
  Modal,
  ResizeHandle,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useResizableWidth,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useAllBots } from "../AppPages/useAllBots";
import { useTeamLeads } from "../AiAssistant/components/RecipientPicker";
import { AskStep } from "../Create/AskStep";
import { BotChat } from "../Bots/BotChat";
import { BotAvatar } from "../Bots/BotAvatar";
import { questionThreads } from "../Create/recentRows";
import {
  contactGroups,
  contactThreads,
  findContact,
} from "./workspaceContacts";
import { WorkspaceSide } from "./WorkspaceSide";
import {
  cellStart,
  makingAbout,
  widgetStart,
  makingStart,
  registrySeed,
  MAKE_KINDS,
  START_FROM,
  waysFor,
} from "./workspaceStart";
import {
  CopyPicker,
  GoesOn,
  WayActions,
  WayScreen,
  WaysChooser,
  WherePicker,
} from "./MakeWays";
import { RegistryOutput } from "./RegistryOutput";
import { RegistryBrowse } from "../Bots/RegistryBrowse";
import { TeamImportReview } from "../Bots/TeamImportReview";
import { botCopy, copyCandidates } from "../Bots/botCopy";
import { scheduleLabel } from "../Create/planChecklist";
import { useDashboard } from "./useDashboard";
import { useWidgetTarget } from "./useWidgetTarget";
import { useRegistryAuthGate } from "../../hooks/useRegistryAuthGate";
import { useWorkspacePlan } from "./useWorkspacePlan";
import { PlanCard, PlanChoices, PlanOutput } from "./PlanViews";
import {
  BuildInChat,
  BuildNext,
  BuildWalk,
  PastBuild,
  PastFix,
} from "./BuildViews";
import { usePlanBuild } from "./usePlanBuild";
import {
  choicesIndex,
  seedConversation,
  stillAnswering,
  withPlanContext,
  isPlainYes,
  canBuild,
  planNext,
  answerRequest,
  decideRequest,
  fixRequest,
  startOverRequest,
  yesLabel,
  cellBuildPlan,
  widgetBuildPlan,
} from "./workspacePlan";
import {
  buildKind,
  buildStatus,
  buildOptions,
  isBuilding,
  waitingFor,
  workingLine,
} from "./workspaceBuild";
import {
  normalizeType,
  pinWidgetProviders,
  providerPickAnswer,
} from "../Create/planChecklist";
import { StepReadsFrom } from "./WidgetWizard/StepReadsFrom";
import {
  chosenParts,
  foundLine,
  isNewOnlyWidget,
  listenersFor,
  previewRead,
  readsFromNames,
  refreshChoices,
  reviewRows,
  settingLabel,
  stepAnswers,
  stepNotes,
  toolWords,
} from "./WidgetWizard/widgetSpec";
import { StepBar, StepReview } from "./WidgetWizard/StepReview";
import { StepDoes, doesQuestion } from "./WidgetWizard/StepDoes";
import { StepTalks, talksQuestion } from "./WidgetWizard/StepTalks";
import { StepLooks, looksQuestion } from "./WidgetWizard/StepLooks";
import { StepQuestion } from "./WidgetWizard/WizardAnswer";
import {
  REUSE_STEPS,
  componentNamed,
  packageComponentIds,
  readsFromNeeds,
  settingFields,
  settingsLine,
} from "./WidgetWizard/reuseSpec";
import {
  ReuseReview,
  ReuseSettings,
  ReuseWhich,
  reuseQuestion,
} from "./WidgetWizard/StepReuse";
import { ComponentManager } from "../../ComponentManager";
import { providerLabel } from "../Create/planChecklist";
import { ChooseProviderDialog } from "../Create/ProviderPick";
import { cellPlace } from "./workspaceStart";
import { StepTailContext } from "./HandoffStep";
import { dirtyDashboardId } from "./dirtyDashboard";
import { planTarget } from "../../utils/teamPlan";
import { useRegistryUsername } from "../../hooks/useRegistryUsername";

const EMPTY = [];
const TICK_MS = 60000;
const SIDE_MIN = 320;
const SIDE_MAX = 900;
const WIDE = 760;
// Narrower than this (frames 35, 36): the left column folds to ☰ and
// Outputs becomes a button that slides over the conversation.
export const NARROW_AT = 1100;

/** The window's width, live. */
function useWindowWidth() {
  const [w, setW] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1600,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}
const WORK_ROLES = ["scout", "planner", "builder", "checker"];
// A conversation's build in its Recents row (release 3b, frame 8).
const BUILT_TAG = {
  building: "Building",
  built: "Built",
  ready: "Ready to look at",
  problems: "Built, with problems",
  waiting: "Built, waiting",
  stopped: "Stopped",
  interrupted: "Interrupted",
  removed: "Removed",
};

/** A bot in Copy one of your bots: what it does, and when it runs. */
function botLine(b) {
  const what = String((b && b.instructions) || "")
    .replace(/\s+/g, " ")
    .trim();
  const short = what.length > 80 ? `${what.slice(0, 79)}…` : what;
  const cron = b && b.schedules && b.schedules[0] && b.schedules[0].cron;
  const when = cron ? scheduleLabel(cron) : "when you run it";
  return [short, when].filter(Boolean).join(" · ");
}

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** Recent's entries, live (questions are the conversations). */
function useRecentEntries() {
  const [entries, setEntries] = useState(EMPTY);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.listCreateRecent) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.listCreateRecent())
        .then((l) => {
          if (!alive) return;
          setEntries(Array.isArray(l) ? l : EMPTY);
          setNow(Date.now());
        })
        .catch(() => {});
    load();
    const id = b.onCreateRecent ? b.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, []);
  return { entries, now };
}

/** The start of a conversation: who this is, and a few things to ask. */
function startText(contact) {
  if (!contact) return { title: "", text: "", starters: [] };
  // What the team can make, a card each (Create — one place to start).
  if (contact.kind === "dashlead") {
    return {
      title: "What should we make?",
      text: "Describe it in your own words. The team plans it with you, and nothing is made until you say yes.",
      starters: [],
      kinds: MAKE_KINDS,
    };
  }
  const first = contact.members[0];
  return {
    title: `Ask ${contact.name}`,
    text: contact.members.length
      ? `${contact.name} knows what this dashboard's ${contact.members.length === 1 ? "bot does" : `${contact.members.length} bots do`}, and asks ${contact.members.length === 1 ? "it" : "them"} for you.`
      : `${contact.name} is ready — this dashboard has no bots yet.`,
    starters: [
      "What did my bots do today?",
      "Is anything waiting on me?",
      ...(first ? [`Ask ${first.name} to run now`] : []),
    ],
  };
}

// At the preview: words that keep it, and words that change nothing.
const LOOKS_GOOD =
  /^\s*(looks? (good|great|fine|perfect)|lgtm|keep it|add it|put it in|ship it)[\s.!]*$/i;
const PLEASANTRY =
  /^\s*(thanks?( you)?|thx|ty|ok(ay)?|cool|nice|great|perfect|awesome|good|neat)[\s.!]*$/i;

/**
 * LeadWorkspace — talking to a team through its lead (lead-workspace PRD,
 * release 2). A large window: on the left, who you're talking to (the Dash
 * Lead, a dashboard's lead, or a bot on no dashboard) and their
 * conversations; in the middle, the conversation (AskStep — with each
 * hand-off as a step); on the right, the team's outputs and what each bot
 * is doing (WorkspaceSide), resizable.
 *
 * A conversation always stays with the lead it was started with: switching
 * lead shows that lead's own conversations.
 *
 * @param {{ key?: string, seed? }|null} request  who to open on
 *   ("role:dashlead", "lead:<botId>", "bot:<botId>"); default the Dash Lead.
 *   `seed` (Open as a plan, release 3c): a plan from another chat, carried
 *   on as a new Dash Lead conversation. `recentId` (release 4): one of its
 *   conversations to open on
 * @param {() => void} onClose
 * @param {(page) => void} [onOpenPage]  opens an app page ("dashboards",
 *   "widgets") in the workspace's place — Start from's copy and edit
 * @param {(dashboardId) => void} [onOpenDashboard]  opens a built dashboard
 * @param {(themeKey) => void} [onOpenThemeEditor]  opens a theme it made in
 *   the theme editor (theme round)
 * @param {({ key, name, visibility }) => void} [onPublishTheme]  publishes a
 *   theme it changed (theme change round)
 *   in the workspace's place (release 3b)
 * @param {(key) => void} [onStartWithoutAi]  Start from's blank dashboard
 *   ("blank-dashboard") or file ("import-dashboard"), in the workspace's
 *   place (release 6c)
 * @param {object[]} [dashboards]  the user's dashboards — where a new bot
 *   goes, and Copy one of your dashboards ("make it in Create")
 * @param {(dashboard) => Promise} [onDuplicateDashboard]  saves a copy of
 *   one and opens it
 *
 * Making a bot or a dashboard ("make it in Create": a page's New, a
 * dashboard's Add bot, or its card on the start) shows the ways first —
 * Ask AI, or the registry, a copy, a blank one, a file — each on its own
 * screen with ← Back; the box is only Ask AI's.
 */
// The wizard's steps after Reads from, in the order they're asked.
const WIZARD_ASKS = ["does", "talks", "looks", "review"];

export const LeadWorkspace = ({
  request = null,
  onClose,
  onOpenPage = null,
  onOpenDashboard = null,
  onOpenThemeEditor = null,
  onPublishTheme = null,
  onStartWithoutAi = null,
  dashboards = EMPTY,
  onDuplicateDashboard = null,
}) => {
  // rawThemes: whose a changed theme is (theme change round).
  // changeCurrentTheme: Use the remix for the app (theme change leftovers).
  const { currentTheme, rawThemes, changeCurrentTheme, themeKey } =
    useContext(ThemeContext) || {};
  // An example's colour: the accent role (as the side's links).
  const link = `${(currentTheme && currentTheme["text-primary-medium"]) || ""} dr-role-accent`;
  const username = useRegistryUsername();
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const { muted, strong, hairline, selectedBg, fieldBg } = useConfigTokens();
  // The lead card and the lead you are on: one step up from the panel, in
  // the theme's own colour (the neutral surface showed plain gray on a
  // coloured panel).
  const raised = `${(currentTheme && currentTheme["bg-primary-dark"]) || selectedBg} ${(currentTheme && currentTheme["border-primary-medium"]) || hairline}`;
  const statusTokens = useStatusTokens();
  const composer = useRef(null);
  // The conversation's handle (AskStep's askPlanner): the plan's card sends
  // answers straight to the Planner.
  const askCtl = useRef(null);
  // A smaller window (frames 35, 36): the columns fold away.
  const narrow = useWindowWidth() < NARROW_AT;
  const [navOpen, setNavOpen] = useState(false);
  const [outsOpen, setOutsOpen] = useState(false);
  // What the right column holds, for its button: { count, needsYou }.
  const [sideSummary, setSideSummary] = useState({
    count: 0,
    needsYou: false,
  });
  const all = useAllBots();
  const { leads, loaded: leadsLoaded } = useTeamLeads(true);
  const { entries, now } = useRecentEntries();

  const groups = useMemo(
    () => contactGroups({ dashTeam: all.dashTeam, leads, bots: all.bots }),
    [all.dashTeam, leads, all.bots],
  );
  const [key, setKey] = useState((request && request.key) || "role:dashlead");
  // An empty cell's Build with AI (release 6c, frame 38):
  // { workspaceId, gridItemId, cellNumber, pageId, scope, span? } — talked
  // over with that dashboard's lead (the Dash Lead when it has none), once
  // the leads are in.
  const cellReq =
    request &&
    request.cell &&
    request.cell.gridItemId != null &&
    request.cell.cellNumber
      ? request.cell
      : null;
  // A widget's Change with AI (release 6c, frame 40): the door's
  // { component, sourcePackage, itemId, workspaceId, pageId, scope, … } —
  // with its dashboard's lead; from the Widgets page (no dashboard), the
  // Dash Lead.
  const widgetReq =
    request && request.widget && request.widget.component
      ? request.widget
      : null;
  const found = useWidgetTarget(widgetReq);
  // The dashboard the door is on, and its lead.
  const doorDashboardId = cellReq
    ? cellReq.workspaceId
    : widgetReq && widgetReq.itemId != null
      ? widgetReq.workspaceId
      : null;
  const cellLead =
    doorDashboardId != null
      ? (leads || []).find(
          (l) => l && String(l.dashboardId) === String(doorDashboardId),
        ) || null
      : null;
  const [cellKeyed, setCellKeyed] = useState(
    !(cellReq || widgetReq) || !!(request && request.key),
  );
  if (!cellKeyed && leadsLoaded) {
    setCellKeyed(true);
    setKey(cellLead ? `lead:${cellLead.botId}` : "role:dashlead");
  }
  const cellDashboard = useDashboard(
    doorDashboardId != null && !cellLead ? doorDashboardId : null,
  );
  // Until the lists are in, nothing is asked: a question must never go to a
  // stand-in while the lead you picked is still loading — nor before the
  // widget being changed is worked out.
  const loading =
    !!all.loading ||
    !leadsLoaded ||
    !cellKeyed ||
    (!!widgetReq && found.status === "loading");
  const picked = findContact(groups, key);
  const missing = !loading && !picked;
  const contact = loading ? null : picked;
  // What a new conversation opened by a door is about — a page's New
  // (release 6c, frame 41: the Dash Lead, "Making:") or an empty cell
  // (frame 38: "For:") — until another conversation is opened.
  // Kept on plain values: the leads and bots lists refresh while the team
  // works, and the cell's plan shouldn't change with them.
  const cellDashboardName =
    (cellLead && (cellLead.dashboardLabel || cellLead.dashboardName)) ||
    (cellDashboard && (cellDashboard.label || cellDashboard.name)) ||
    "";
  const contactName = contact ? contact.name : "";
  // What's being made: a page's New, a dashboard's Add bot (with where the
  // bot goes, `target`), or the start's dashboard or bot card.
  const [makingReq, setMakingReq] = useState(
    (request && request.making) || null,
  );
  const making = useMemo(
    () =>
      makingStart(makingReq) ||
      cellStart(cellReq, {
        dashboardName: cellDashboardName,
        leadName: contactName,
      }) ||
      widgetStart(widgetReq, {
        target: found.target,
        mode: found.mode,
        usedOn: found.usedOn,
        dashboardName: cellDashboardName,
        leadName: contactName,
        canInPlace: found.canInPlace,
        canSignIn: found.canSignIn,
      }) ||
      (widgetReq && found.status === "missing"
        ? {
            label: "Changing",
            text: widgetReq.component.split(".").pop(),
            title: "That widget isn't installed any more",
            greeting:
              "It may have been removed or renamed. Open the dashboard it's on and choose Change on it again.",
            starters: [],
            note: "",
            gone: true,
          }
        : null),
    [makingReq, cellReq, widgetReq, found, cellDashboardName, contactName],
  );
  const [makingOn, setMakingOn] = useState(
    !!(request && request.making) || !!cellReq || !!widgetReq,
  );
  const makingShown =
    !!making &&
    makingOn &&
    !!contact &&
    (making.cell || making.widget || making.gone
      ? contact.kind !== "bot"
      : contact.kind === "dashlead");
  // Making a bot or a dashboard: its ways, then the one picked — "ai",
  // "where" (a bot's dashboard first), "registry", "copy" or "file" — one
  // at a time (null: the ways).
  const ways =
    makingShown && !making.cell && !making.widget
      ? waysFor(makingReq && makingReq.kind)
      : null;
  // A door that brings words for the box (a lead's hand-off) opens on Ask AI.
  const [way, setWay] = useState(() =>
    request && typeof request.draft === "string" && request.draft.trim()
      ? "ai"
      : null,
  );
  // After Where it goes: the way it was picked for, and the pick so far.
  const [whereNext, setWhereNext] = useState(null);
  const [wherePick, setWherePick] = useState(null);
  // A way's search, pick, review (a registry package or a file), outcome.
  const [wayQuery, setWayQuery] = useState("");
  const [wayPicked, setWayPicked] = useState(null);
  const [review, setReview] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [wayError, setWayError] = useState(null);
  const [installed, setInstalled] = useState(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  // What's open in the middle: a thread ({ recentId }), a new question just
  // sent ({ question }), or nothing yet (the start).
  // Opened on a conversation (release 4: Review in conversation).
  const [open, setOpen] = useState(() =>
    request && request.recentId
      ? { key: request.recentId, recentId: request.recentId }
      : null,
  );
  const [selectedId, setSelectedId] = useState(
    (request && request.recentId) || null,
  );
  // A door's words, ready to send (release 6c: a hand-off, the Widget
  // Builder's Ask the Dash team).
  const [draft, setDraft] = useState(
    (request && typeof request.draft === "string" && request.draft) || "",
  );
  const [messages, setMessages] = useState(EMPTY);
  // The conversation is still being answered (AskStep's busy): the lead's
  // words can still be coming after the Planner's plan arrived.
  const [askBusy, setAskBusy] = useState(false);
  // What's open on the right: "plan", a step's id, or the overview (null).
  const [sideOpen, setSideOpen] = useState(null);
  // Change the plan instead: the next reply goes to the Planner, not to the
  // Builder as a fix.
  const [planChange, setPlanChange] = useState(false);
  const [wide, setWide] = useState(false);
  // Folded drawers close when the window grows.
  useEffect(() => {
    if (!narrow) {
      setNavOpen(false);
      setOutsOpen(false);
    }
  }, [narrow]);
  // Another lead (or none while loading): the old Outputs count goes.
  useEffect(() => {
    setSideSummary({ count: 0, needsYou: false });
  }, [key]);
  // The drawers open under the header, so ☰ and Outputs stay in reach.
  const headerRef = useRef(null);
  const navBtn = useRef(null);
  const outsBtn = useRef(null);
  const navRef = useRef(null);
  const asideRef = useRef(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    if (!narrow || !headerRef.current) return;
    setHeaderH(headerRef.current.offsetHeight || 0);
  });
  const drawerOpen = narrow && (navOpen || outsOpen);
  // Focus goes into an opened drawer, and back to its button when it
  // closes.
  const lastDrawer = useRef(null);
  useEffect(() => {
    const opened = navOpen
      ? navRef.current
      : outsOpen
        ? asideRef.current
        : null;
    if (opened) {
      lastDrawer.current = navOpen ? navBtn.current : outsBtn.current;
      const first = opened.querySelector(
        "button, [href], input, textarea, select",
      );
      if (first) first.focus();
    } else if (lastDrawer.current) {
      const back = lastDrawer.current;
      lastDrawer.current = null;
      if (back && back.isConnected) back.focus();
    }
  }, [navOpen, outsOpen]);
  // Escape closes an open drawer — not the window (the Modal listens on
  // the window, so this runs first and stops it).
  useEffect(() => {
    if (!drawerOpen || typeof window === "undefined") return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      if (switchOpen) {
        setSwitchOpen(false);
        return;
      }
      setNavOpen(false);
      setOutsOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawerOpen, switchOpen]);
  // What a reopened conversation is about (its saved `about`, release 6c).
  const [reopenedAbout, setReopenedAbout] = useState(null);
  // The empty cell this conversation is about (release 6c): the door's, or
  // a reopened one's.
  const convCell =
    makingShown && making.cell && (!open || open.making)
      ? making.cell
      : open && open.recentId && reopenedAbout && reopenedAbout.cell
        ? reopenedAbout.cell
        : null;
  // The widget this conversation changes (release 6c): the door's, or a
  // reopened one's.
  const convWidgetAsIs =
    makingShown && making.widget && (!open || open.making)
      ? making.widget
      : open && open.recentId && reopenedAbout && reopenedAbout.widget
        ? reopenedAbout.widget
        : null;
  // In place or a new widget, when it can go either way: the user's pick
  // on the plan (review fix — Create › Change let them choose too).
  const [modePick, setModePick] = useState(null);
  const convWidget = useMemo(
    () =>
      convWidgetAsIs && modePick && convWidgetAsIs.canInPlace
        ? { ...convWidgetAsIs, mode: modePick }
        : convWidgetAsIs,
    [convWidgetAsIs, modePick],
  );
  // The plan this conversation is about (release 3a) — for its cell, if any.
  const wp = useWorkspacePlan({
    messages,
    recentId: open ? open.recentId || selectedId : null,
    reopened: !!(open && open.recentId),
    convKey: open ? `${key}:${open.key}` : key,
    cell: convCell,
    widget: convWidget,
  });
  const { width: sideWidth, handleProps } = useResizableWidth({
    defaultWidth: 420,
    min: SIDE_MIN,
    max: SIDE_MAX,
    edge: "left",
    storageKey: "dash:leadWorkspace:sideWidth",
  });

  const threads = useMemo(
    () => questionThreads(contactThreads(entries, contact && contact.key), now),
    [entries, now, contact],
  );

  // Edit the code yourself: the Widget Builder on this widget, by hand
  // (dash-electron hears dash:edit-widget-code), with this copy's settings
  // and connections; a new widget saved there takes this one's place.
  const editByHand = () => {
    const w = making && making.widget;
    if (!w || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("dash:edit-widget-code", {
        detail: {
          widgetComponentName: w.component,
          sourcePackage: w.package,
          widgetId: w.itemId != null ? w.itemId : `${w.package}/${w.component}`,
          workspaceId: w.workspaceId ?? null,
          gridItemId: w.gridItemId ?? null,
          cellNumber: w.cellNumber ?? null,
          userPrefs: (widgetReq && widgetReq.settings) || null,
          selectedProviders: w.providers || null,
        },
      }),
    );
    onClose();
  };
  // Signed out, a widget the user published can't change in place: sign
  // in, then work it out again (review fix — Create › Change offered it).
  const { ensureAuthed, authGate } = useRegistryAuthGate();
  const signInToChange = async () => {
    const ok = await ensureAuthed({
      message: `Sign in to the registry to change ${
        (making && making.widget && making.widget.displayName) || "it"
      } in place.`,
    });
    if (ok && found.refresh) found.refresh();
  };
  // Moving on — another lead, a new or other conversation, a question —
  // leaves what was being started behind: a seed still saving doesn't open
  // over it afterwards.
  const moves = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const moveOn = () => {
    moves.current += 1;
    setSeedError(null);
    setReopenedAbout(null);
    setModePick(null);
    leaveWay(null);
  };
  // To another way (null: the ways), leaving the last one's pick behind.
  function leaveWay(next) {
    setWay(next);
    setWayQuery("");
    setWayPicked(null);
    setReview(null);
    setWayError(null);
    setInstalled(null);
  }
  const switchTo = (next) => {
    setSwitchOpen(false);
    setNavOpen(false);
    if (next === key) return;
    moveOn();
    setKey(next);
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
    setAskBusy(false);
    setSideOpen(null);
    setMakingOn(false);
  };
  // A seeded plan becomes a new Dash Lead conversation — saved, then opened
  // like any in Recents: Open as a plan (release 3c), from another chat,
  // and a registry dashboard picked in Start from (release 6c). Resolves
  // true once it's open; false when it couldn't be saved (`lostText`, if
  // given, says so at the start) or the user moved on meanwhile.
  const seeded = useRef(false);
  const [seedError, setSeedError] = useState(null);
  const startSeeded = (seed, lostText = null) => {
    setSeedError(null);
    const b = botsApi();
    const at = moves.current;
    const current = () => alive.current && moves.current === at;
    // Never lost without a word: the start says it didn't come over.
    const lost = () => {
      if (lostText && current()) setSeedError(lostText);
      return false;
    };
    if (!b || !b.saveCreateRecent || !contact || contact.kind !== "dashlead")
      return Promise.resolve(lost());
    return Promise.resolve(
      b.saveCreateRecent({
        kind: "question",
        prompt: seed.label || "From the Dash team chat",
        conversation: {
          recipient: contact.recipient,
          messages: seedConversation(seed),
        },
      }),
    )
      .then((res) => {
        if (!res || !res.id) return lost();
        if (!current()) return false;
        moveOn();
        setSelectedId(res.id);
        setSideOpen(null);
        setOutsOpen(false);
        setMakingOn(false);
        setOpen({ key: res.id, recentId: res.id });
        return true;
      })
      .catch(lost);
  };
  useEffect(() => {
    const seed = request && request.seed;
    if (!seed || seeded.current || !contact || contact.kind !== "dashlead")
      return;
    seeded.current = true;
    startSeeded(
      seed,
      "The plan from your chat didn't come over. Ask for it here, or open it again from that chat.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, contact]);
  // A plan started in the Create window (retired in release 6c): carried
  // on as a new Dash Lead conversation — what was said, the plan on the
  // right, and its build (if any) with Carry on building. The old entry goes
  // once this one is saved (the main process moves its build over).
  const carrying = useRef(null);
  const carryOverCreatePlan = async (id) => {
    // Once at a time: a second click doesn't carry it twice.
    if (carrying.current) return;
    carrying.current = id;
    const b = botsApi();
    const at = moves.current;
    const lost = (why) =>
      alive.current &&
      moves.current === at &&
      setSeedError(why || "That plan from Create couldn't be opened.");
    try {
      if (!b || !b.getCreateRecent || !b.saveCreateRecent || !contact) {
        lost();
        return;
      }
      const entry = await b.getCreateRecent(id);
      if (!entry) {
        lost("That plan from Create isn't saved any more.");
        return;
      }
      const conv = entry.conversation || {};
      const plan = conv.plan || null;
      const said = Array.isArray(conv.messages) ? conv.messages : [];
      const build =
        plan && entry.build && entry.build.buildId ? entry.build : null;
      const messages = seedConversation({
        plan,
        // Closed before anything was said back: what was asked.
        messages: said.length
          ? said
          : [{ who: "you", text: entry.prompt || entry.title || "" }],
        reply: !plan
          ? "Here's what you asked in Create — it wasn't planned yet. Want me to plan it? Say yes, or tell me more."
          : build
            ? "Here's the plan you started in Create, and how its build went — the plan is on the right, the build just below."
            : "Here's the plan you started in Create — it's on the right. Want me to build it?",
      });
      const planStep = [...messages].reverse().find((m) => m && m.plan);
      // When it was planned: an old plan isn't news (the notifications panel).
      const madeAt = Date.parse(entry.updatedAt || "") || Date.now();
      const res = await b.saveCreateRecent({
        carryFrom: id,
        // Its name in Recents stays what it was (the plan's).
        prompt: entry.title || entry.prompt || "From Create",
        conversation: {
          recipient: contact.recipient,
          messages,
          ...(plan
            ? {
                workspacePlan: {
                  stepId: planStep ? planStep.id : null,
                  plan,
                  checks: conv.checks || {},
                  edits: [],
                  sent: false,
                  madeAt,
                  builds: build
                    ? [
                        {
                          stepId: planStep ? planStep.id : null,
                          buildId: build.buildId,
                          kind: buildKind(plan),
                          at: messages.length - 1,
                          leftOff: [],
                          last: build.state || null,
                        },
                      ]
                    : [],
                },
              }
            : {}),
        },
      });
      if (!alive.current || moves.current !== at) return;
      if (!res || !res.id) {
        lost(
          res && res.error
            ? `That plan from Create couldn't be opened: ${res.error}`
            : null,
        );
        return;
      }
      moveOn();
      setSelectedId(res.id);
      setSideOpen(null);
      setOpen({ key: res.id, recentId: res.id });
    } catch (_e) {
      lost();
    } finally {
      carrying.current = null;
    }
  };
  // Start from › A dashboard from the registry (frame 42): the picked one,
  // as a plan the Dash Lead sets up with you. Its row says when it
  // couldn't be opened.
  const pickRegistryDashboard = (dashboard, config) =>
    startSeeded(registrySeed(dashboard, config)).then((ok) =>
      ok
        ? null
        : {
            error: `${dashboard.name} didn't come over. Pick it again, or click Ask AI instead.`,
          },
    );
  const startNew = () => {
    moveOn();
    setNavOpen(false);
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
    setAskBusy(false);
    setSideOpen(null);
    setMakingOn(false);
  };
  const ask = (text) => {
    const q = String(text || draft).trim();
    if (!q || !contact) return;
    moveOn();
    setDraft("");
    setSideOpen(null);
    setOpen({
      key: `new:${Date.now()}`,
      question: q,
      // A widget that's gone isn't what this question is about.
      making: makingShown && !making.gone,
    });
  };

  // From the Bots diagram (TD-009): what the user said the widget should
  // show from a bot is asked straight away, once.
  const wireAsked = useRef(false);
  useEffect(() => {
    const w = making && making.widget && making.widget.wire;
    if (!w || !w.ask || wireAsked.current || loading || !contact) return;
    wireAsked.current = true;
    ask(w.ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [making, loading, contact]);

  // The plan's build, live (release 3b) — from how it last ended until the
  // main process says more.
  const pb = usePlanBuild(
    wp.build ? wp.build.buildId : null,
    wp.build ? wp.build.last || null : null,
  );
  const [walking, setWalking] = useState(false);
  // Between Yes, build it and the build being there: it can't be pressed
  // twice.
  const [starting, setStarting] = useState(false);
  const [buildError, setBuildError] = useState(null);
  const conversationId = open ? open.recentId || selectedId : null;
  const removed = !!(pb.state && pb.state.status === "removed");

  // Builds the plan here, in the conversation, after its last message. A
  // changed plan reuses what an earlier build made (resumeFrom); Carry on
  // building continues this plan's build.
  const startBuild = async ({ checks = null, carryOn = false } = {}) => {
    setBuildError(null);
    const b = botsApi();
    if (!wp.plan || !b || !b.startPlanBuild) {
      setBuildError("Building from a plan isn't available in this version.");
      return;
    }
    const kind = carryOn && wp.build ? wp.build.kind : buildKind(wp.plan);
    // Two saves at once would overwrite each other (as Create, 5e-2b) — a
    // cell build saves nothing: the editor places it (release 6c).
    const target = planTarget(wp.plan);
    if (kind !== "cell" && target && dirtyDashboardId() === target.id) {
      setBuildError(
        `Save or cancel your edits to ${target.name} first, then say yes again.`,
      );
      return;
    }
    const earlier = carryOn
      ? wp.build
      : wp.lastBuild && wp.lastBuild.stepId !== (wp.step && wp.step.id)
        ? wp.lastBuild
        : null;
    // Where it started: if the user moves on meanwhile, it isn't added there.
    const from = { key: wp.key, stepId: wp.step ? wp.step.id : null };
    const at = carryOn && wp.build ? wp.build.at : messages.length - 1;
    const start = (resumeFrom) =>
      b.startPlanBuild(
        kind === "cell"
          ? cellBuildPlan(wp.plan)
          : kind === "settings" || kind === "edit"
            ? widgetBuildPlan(wp.plan)
            : wp.plan,
        {
          ...buildOptions(kind, wp.plan),
          ...(resumeFrom ? { resumeFrom } : {}),
          ...(conversationId ? { recentId: conversationId } : {}),
        },
      );
    setStarting(true);
    try {
      let res = await start(earlier ? earlier.buildId : null);
      // An earlier plan's build that can't be reused (removed, or another
      // dashboard): this one starts fresh.
      if (res && res.error && earlier && !carryOn) res = await start(null);
      if (!res || res.error) {
        setBuildError((res && res.error) || "The build couldn't start.");
        return;
      }
      wp.addBuild({
        buildId: res.buildId,
        kind,
        at,
        ...from,
        ...(carryOn && wp.build
          ? { replaces: wp.build.buildId, leftOff: wp.build.leftOff }
          : {}),
        ...(checks ? { checks } : {}),
      });
    } catch (err) {
      setBuildError((err && err.message) || "The build couldn't start.");
    } finally {
      setStarting(false);
    }
  };
  // Yes, build it: what's left to review first, then the build. Once —
  // again only after what was built was removed.
  const reviewHeld = useRef(false);
  // Yes said here: its preview opens by itself when it's ready.
  const previewAskedHere = useRef(false);
  const buildIt = () => {
    if (!wp.plan || walking || starting || (wp.build && !removed)) return;
    // The wizard: not before Review & build, nor until every part is set.
    if (reviewHeld.current) return;
    // This conversation's: another one's preview never opens for it.
    previewAskedHere.current = wp.key || true;
    setBuildError(null);
    setWalking(true);
  };
  const building = isBuilding(pb.state);
  // How it ended, kept with the build (an earlier one shows after a restart).
  const ended = pb.state && !building ? pb.state : null;
  useEffect(() => {
    if (ended && wp.build) wp.keepLast(wp.build.buildId, ended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended && ended.status, ended && ended.finishedAt]);
  // A provider the build waits for got connected (here, or anywhere): the
  // steps that need it carry on. Once per change in what's connected — if
  // the build still waits after that, it waits for the user.
  const resumed = useRef(null);
  const waitingTypes = pb.state
    ? waitingFor(pb.state)
        .map(normalizeType)
        // A provider type, not a description of what's missing.
        .filter((t) => t && /^[a-z0-9][a-z0-9._-]*$/.test(t))
    : [];
  const ready =
    !!pb.state &&
    !building &&
    waitingTypes.length > 0 &&
    waitingTypes.every((t) => wp.have.has(t));
  const resumeKey = ready
    ? `${wp.build.buildId}:${[...wp.have].sort().join(",")}`
    : null;
  useEffect(() => {
    // A restored build has nothing running to resume: Carry on building.
    if (!resumeKey || resumed.current === resumeKey || pb.restored) return;
    resumed.current = resumeKey;
    pb.resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeKey]);
  // A cell build that's done (release 6c): the editor puts it in the cell
  // — an unsaved change, as Create did. Once, when it finishes here; the
  // editor says whether it went in, or why not (LayoutBuilder: "preview",
  // "gone", "taken", "unknown-widget", "failed"; no answer: "no-answer"),
  // and Put it in the cell tries again — only ever into an empty cell.
  // buildId → "placing" | true | a reason.
  const [placements, setPlacements] = useState({});
  const madeForCell = (pb.state && pb.state.made && pb.state.made[0]) || null;
  const canPlace = !!(
    wp.build &&
    convCell &&
    madeForCell &&
    madeForCell.component
  );
  const placeInCell = () => {
    if (!canPlace) return;
    const build = wp.build;
    const at = convCell;
    const made = madeForCell;
    const id = build.buildId;
    // Put in again while it's still there: the cell is taken by it.
    const was = placements[id];
    const set = (v) =>
      alive.current && setPlacements((cur) => ({ ...cur, [id]: v }));
    set("placing");
    let answered = false;
    let timer = null;
    const answer = (result) => {
      if (answered) return;
      answered = true;
      if (timer) clearTimeout(timer);
      set(
        result === true || (was === true && result === "taken")
          ? true
          : String(result || "failed"),
      );
    };
    // No editor answers (that dashboard, or its page, isn't open).
    timer = setTimeout(() => answer("no-answer"), 8000);
    const inputs = made.inputs || {};
    window.dispatchEvent(
      new CustomEvent("dash:place-widget-in-cell", {
        detail: {
          widgetComponentName: made.component,
          cellNumber: at.cellNumber,
          gridItemId: at.gridItemId,
          workspaceId: at.workspaceId,
          pageId: at.pageId ?? null,
          scope: at.scope || "main",
          userPrefs: inputs.settings || null,
          selectedProviders: inputs.providers || null,
          // What it shows from the dashboard's bots (Talks to).
          listeners: wp.wizard ? listenersFor(wp.wizard.piece) : null,
          onPlaced: answer,
        },
      }),
    );
  };
  // Seen running here: only then is it placed by itself when it's done (a
  // reopened, finished one asks first).
  const sawRunning = useRef(null);
  const cellBuildId =
    wp.build && wp.build.kind === "cell" ? wp.build.buildId : null;
  // Done as the chat says it: finished (anything failed left off), or
  // waiting only for a provider.
  const cellStatus =
    cellBuildId && pb.state
      ? buildStatus(pb.state, (wp.build && wp.build.leftOff) || [])
      : null;
  const cellDone =
    cellStatus === "done" || cellStatus === "waiting-for-providers";
  useEffect(() => {
    if (!cellBuildId || !cellStatus) return;
    if (!cellDone) {
      sawRunning.current = cellBuildId;
      return;
    }
    if (
      sawRunning.current === cellBuildId &&
      placements[cellBuildId] === undefined
    )
      placeInCell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellBuildId, cellStatus]);
  // Put in the cell here: the widget is done — the window closes onto the
  // dashboard, where it shows (a moment first, so the line is seen).
  const placedHere = cellBuildId && placements[cellBuildId] === true;
  useEffect(() => {
    if (!placedHere) return undefined;
    const t = setTimeout(() => {
      if (alive.current) onClose();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedHere]);
  // A change to one widget that's done (release 6c), once, when it
  // finishes here: in place, it reloads everywhere it runs; a new widget
  // goes in your widgets and, made from one on a dashboard, the editor puts
  // it in that one's place — an unsaved change, told back as a cell build's
  // is (`placements`).
  const changeBuildId =
    wp.build && wp.build.kind === "edit" ? wp.build.buildId : null;
  const changeStatus =
    changeBuildId && pb.state
      ? buildStatus(pb.state, (wp.build && wp.build.leftOff) || [])
      : null;
  const changeDone =
    changeStatus === "done" || changeStatus === "waiting-for-providers";
  const canSwap = !!(
    convWidget &&
    convWidget.onDashboard &&
    convWidget.mode === "new" &&
    madeForCell &&
    madeForCell.component
  );
  const swapInPlace = () => {
    if (!canSwap || !wp.build) return;
    const id = wp.build.buildId;
    const w = convWidget;
    const set = (v) =>
      alive.current && setPlacements((cur) => ({ ...cur, [id]: v }));
    set("placing");
    let answered = false;
    let timer = null;
    const answer = (result) => {
      if (answered) return;
      answered = true;
      if (timer) clearTimeout(timer);
      set(result === true ? true : String(result || "failed"));
      // The copy is in the widget's place: now its listener (TD-009),
      // once the editor has the swap — on every try that places it.
      if (result === true && w.wire && w.onDashboard && w.itemId != null) {
        setTimeout(wireWidget(w), 50);
      }
    };
    timer = setTimeout(() => answer("no-answer"), 8000);
    window.dispatchEvent(
      new CustomEvent("dash:swap-widget-in-cell", {
        detail: {
          widgetComponentName: madeForCell.component,
          widgetId: w.itemId,
          workspaceId: w.workspaceId,
          pageId: w.pageId ?? null,
          scope: w.scope || "main",
          onPlaced: answer,
        },
      }),
    );
  };
  const sawChanging = useRef(null);
  // A change from the Bots diagram (TD-009) made as a copy: the editor
  // connects the bot to it once it's in the widget's place (changed in
  // place, the main process wires it when it installs).
  const wireWidget = (w) => () =>
    window.dispatchEvent(
      new CustomEvent("dash:wire-bot-to-widget", {
        detail: { ...w.wire, workspaceId: w.workspaceId, itemId: w.itemId },
      }),
    );
  useEffect(() => {
    if (!changeBuildId || !changeStatus) return;
    if (!changeDone) {
      sawChanging.current = changeBuildId;
      return;
    }
    if (sawChanging.current !== changeBuildId) return;
    sawChanging.current = null;
    const w = convWidget;
    if (w && w.mode === "update") {
      window.dispatchEvent(
        new CustomEvent("dash:widget-changed", {
          detail: { package: w.package, component: w.component },
        }),
      );
    }
    window.dispatchEvent(new Event("dash:widgets-updated"));
    if (canSwap && placements[changeBuildId] === undefined) swapInPlace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeBuildId, changeStatus]);
  // The built widget waiting on a look: what's typed (or marked) is a fix
  // to it — the Builder changes its own code, never a new plan.
  const previewWaiting =
    wp.build && !removed && pb.state && pb.state.status === "waiting-for-you"
      ? (pb.state.steps || []).find(
          (s) => s.kind === "preview" && s.status === "needs-you",
        ) || null
      : null;
  // Its preview ready after the user said yes here: it opens on the right
  // by itself (once) — saying yes was asking to see it, no second click.
  // Built here (the Builder's draft), or a widget the user already has.
  const previewBuilt =
    !!previewWaiting &&
    ((pb.state && pb.state.steps) || []).some((s) => s.kind === "build");
  const previewSawRunning = useRef(null);
  const previewOpened = useRef(null);
  const previewKey =
    previewWaiting && wp.build
      ? `${wp.build.buildId}:${previewWaiting.id}`
      : null;
  const buildStatusNow = pb.state ? pb.state.status : null;
  useEffect(() => {
    if (!wp.build) return;
    if (!previewKey) {
      if (buildStatusNow === "running")
        previewSawRunning.current = wp.build.buildId;
      return;
    }
    // Seen running here, or started here (a widget the user already has
    // can be ready before it's ever seen running).
    if (
      (previewSawRunning.current === wp.build.buildId ||
        previewAskedHere.current === (wp.key || true)) &&
      previewOpened.current !== previewKey
    ) {
      previewAskedHere.current = false;
      previewOpened.current = previewKey;
      setSideOpen("preview");
      if (narrow) setOutsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, buildStatusNow]);
  const sendFix = async (stepId, note, marks = null) => {
    const res = await pb.revise(stepId, note, marks);
    const say = askCtl.current && askCtl.current.say;
    const went = !!res && !res.error;
    if (say) {
      // Your words in the chat, with what you marked — a fix only if it
      // went to the Builder.
      say({
        who: "you",
        text: note,
        ...(went ? { fix: true } : { local: true }),
        ...(went && res.marked
          ? { marks: { count: res.marked, thumb: res.thumb || null } }
          : {}),
      });
      if (res && res.error) {
        say({
          who: "note",
          text: `Couldn't send that to the Builder: ${res.error}`,
        });
      }
    }
    setPlanChange(false);
    return res;
  };
  const buildActions = {
    placeInCell,
    swapInPlace,
    fix: pb.fix,
    retry: pb.retry,
    approve: pb.approve,
    leaveOff: wp.leaveOff,
    carryOn: () => !starting && startBuild({ carryOn: true }),
    buildAgain: buildIt,
    openDashboard: onOpenDashboard,
    openThemeEditor: onOpenThemeEditor,
    publishTheme: onPublishTheme,
    // The app's theme switches only when the user clicks (leftovers).
    useThemeForApp: changeCurrentTheme
      ? (key) => changeCurrentTheme(key)
      : null,
    appThemeKey: themeKey || null,
    open: setSideOpen,
    changePlan: () => {
      setPlanChange(true);
      if (askCtl.current && askCtl.current.focusReply) {
        askCtl.current.focusReply();
      }
    },
  };
  // The lead is still answering: the plan isn't changed meanwhile.
  const answering = stillAnswering(messages) || askBusy;

  // Or start from shows in a new Dash Lead conversation, in the middle.
  // Making a bot or a dashboard has its own ways instead.
  const startsHere =
    !open && !!contact && contact.kind === "dashlead" && !makingShown;
  // Making a bot or a dashboard: its ways first (one place to start → make
  // it in Create).
  const startMaking = (kind, next = null) => {
    setMakingReq({ kind });
    setMakingOn(true);
    leaveWay(next);
  };
  // Start from (frame 13): the registry's dashboards and copying one open
  // on their own, as making a dashboard does; editing a widget is on its
  // page.
  const startFrom = (kind) => {
    if (kind === "registry" || kind === "copy") {
      startMaking("dashboard", kind);
      return;
    }
    if (kind === "blank" || kind === "import") {
      if (onStartWithoutAi)
        onStartWithoutAi(
          kind === "blank" ? "blank-dashboard" : "import-dashboard",
        );
      else onClose();
      return;
    }
    if (onOpenPage) onOpenPage("widgets");
    else onClose();
  };

  // ── Making a bot: where it goes, and each way ──
  const botTarget = makingReq && makingReq.target ? makingReq.target : null;
  const targetId =
    botTarget && !botTarget.none && botTarget.id != null
      ? String(botTarget.id)
      : null;
  const savedDashboards = useMemo(
    () =>
      (dashboards || [])
        .filter((d) => d && d.id !== undefined && d.id !== null)
        .map((d) => ({
          id: String(d.id),
          name: d.name || "Dashboard",
          bots: (all.bots || []).filter(
            (b) =>
              b &&
              b.role !== "lead" &&
              b.workspaceId != null &&
              String(b.workspaceId) === String(d.id),
          ).length,
        })),
    [dashboards, all.bots],
  );
  const dashboardName = (id) => {
    const d = savedDashboards.find((x) => x.id === String(id));
    return d ? d.name : "";
  };
  // The bot form, for a blank bot or a copy: on its dashboard's Bots view,
  // or in a window for no dashboard (DashboardStage hears dash:new-bot).
  const openBotForm = (initial = null, note = null) => {
    window.dispatchEvent(
      new CustomEvent("dash:new-bot", {
        detail: { workspaceId: targetId, initial, note },
      }),
    );
    onClose();
  };
  // A bot file: the file picker, then its review here.
  const startBotFile = async () => {
    const b = botsApi();
    if (!b || !b.previewTeamImport) return;
    let r;
    try {
      r = (await b.previewTeamImport(targetId)) || {};
    } catch (e) {
      r = { error: (e && e.message) || "That file couldn't be read." };
    }
    if (r.canceled || r.error) {
      // Back to the ways (from Where it goes too), saying what went wrong.
      leaveWay(null);
      if (r.error) setWayError([r.error, ...(r.errors || [])].join(" "));
      return;
    }
    leaveWay("file");
    setReview(r);
  };
  // A way, once a bot's dashboard is known.
  const goWay = (w) => {
    if (w === "blank") openBotForm();
    else if (w === "file") startBotFile();
    else leaveWay(w);
  };
  const pickWay = (w) => {
    setWayError(null);
    if (w === "ai") {
      leaveWay("ai");
      return;
    }
    if (makingReq && makingReq.kind === "dashboard") {
      if (w === "blank" || w === "file") {
        if (onStartWithoutAi)
          onStartWithoutAi(
            w === "blank" ? "blank-dashboard" : "import-dashboard",
          );
        else onClose();
        return;
      }
      leaveWay(w);
      return;
    }
    // A bot: where it goes first, unless the door said.
    if (!botTarget) {
      setWhereNext(w);
      setWherePick(null);
      leaveWay("where");
      return;
    }
    goWay(w);
  };
  const changeWhere = () => {
    setWhereNext(way);
    setWherePick(botTarget);
    leaveWay("where");
  };
  const confirmWhere = () => {
    if (!wherePick) return;
    setMakingReq((m) => ({ ...(m || { kind: "bot" }), target: wherePick }));
    const next = whereNext;
    setWhereNext(null);
    if (!next || next === "ai") {
      leaveWay(next);
      return;
    }
    // The target is read from the request: go once it's set.
    setPendingWay(next);
  };
  const [pendingWay, setPendingWay] = useState(null);
  useEffect(() => {
    if (!pendingWay || !botTarget) return;
    const next = pendingWay;
    setPendingWay(null);
    goWay(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWay, botTarget]);
  // A registry bot or team: checked in the main process, then reviewed.
  const pickRegistryBot = async (ref) => {
    const b = botsApi();
    if (!b || !b.previewRegistryInstall) return;
    setWayError(null);
    let r;
    try {
      r = (await b.previewRegistryInstall(targetId, ref)) || {};
      if (r.authRequired) {
        const signedIn = await ensureAuthed({
          message: "Sign in to the Dash registry to install.",
        });
        if (!signedIn) return;
        r = (await b.previewRegistryInstall(targetId, ref)) || {};
      }
    } catch (e) {
      r = { error: (e && e.message) || "That package couldn't be opened." };
    }
    if (r.error) {
      setWayError([r.error, ...(r.errors || [])].join(" "));
      return;
    }
    setReview(r);
  };
  const installReviewed = async (choices, roles = null) => {
    const b = botsApi();
    if (!b || !review) return;
    setInstalling(true);
    setWayError(null);
    try {
      const r =
        (review.previewId
          ? await b.installFromRegistry(
              targetId,
              review.previewId,
              choices,
              roles,
            )
          : await b.installTeam(targetId, review.manifest, choices, roles)) ||
        {};
      if (r.error) {
        setWayError([r.error, ...(r.errors || [])].join(" "));
        return;
      }
      setInstalled({
        name: review.manifest.name,
        bots: r.installed || [],
        // Triggers and widgets that couldn't be set up (no such widget here).
        skipped: (r.unwired || []).filter((x) => typeof x === "string"),
      });
      setReview(null);
    } catch (e) {
      setWayError((e && e.message) || "It couldn't be installed.");
    } finally {
      setInstalling(false);
    }
  };
  // Copy one of your bots: its own bot, in the form.
  const botGroups = useMemo(
    () => copyCandidates(all.bots, dashboards, wayQuery),
    [all.bots, dashboards, wayQuery],
  );
  const copyPickedBot = () => {
    const bot = (all.bots || []).find((b) => b.id === wayPicked);
    if (!bot) return;
    const { initial, note } = botCopy(bot, {
      workspaceId: targetId,
      dashboardName: targetId ? dashboardName(targetId) : "",
      fromDashboardName:
        bot.workspaceId != null ? dashboardName(bot.workspaceId) : "",
    });
    openBotForm(initial, note);
  };
  // Copy one of your dashboards: saved as its own, then opened.
  const [copying, setCopying] = useState(false);
  const copyPickedDashboard = async () => {
    const ws = (dashboards || []).find(
      (d) => d && String(d.id) === String(wayPicked),
    );
    if (!ws || !onDuplicateDashboard || copying) return;
    setCopying(true);
    setWayError(null);
    try {
      await onDuplicateDashboard(ws);
      onClose();
    } catch (e) {
      setWayError(
        `${ws.name || "That dashboard"} couldn't be copied: ${
          (e && e.message) || "try again"
        }`,
      );
    } finally {
      setCopying(false);
    }
  };

  // What a build's chat needs to know about a widget change or a cell.
  const buildChange = (b) =>
    b.kind === "edit" || b.kind === "settings"
      ? {
          displayName: convWidget ? convWidget.displayName : "",
          mode: convWidget ? convWidget.mode : null,
          dashboardName: convWidget ? convWidget.dashboardName : "",
          onDashboard: !!(convWidget && convWidget.onDashboard),
          settingLabels: convWidget ? convWidget.settingLabels : null,
          placed: placements[b.buildId],
          canPlace: canSwap,
        }
      : null;
  const buildCell = (b) =>
    b.kind === "cell"
      ? {
          dashboardName: convCell ? convCell.dashboardName : "",
          placed: placements[b.buildId],
          canPlace,
        }
      : null;

  // The plan's next step (plan → build): the app sends answers, Decide for
  // me, Ask again and Start over to the Planner itself — never through a
  // lead that might not pass them on.
  const firstAsk =
    ((messages || []).find((m) => m && m.who === "you") || {}).text ||
    (open && open.question) ||
    "";
  const lastDirect = (() => {
    for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.who === "step" && m.direct) return m;
    }
    return null;
  })();
  const toPlanner = (shown, request, label) =>
    !!(askCtl.current && askCtl.current.askPlanner(shown, request, label));
  const planActions = {
    // A provider the user picked in a question (it counts as chosen).
    onPicked: wp.notePicked,
    // `shown`: what the chat shows as theirs (a tap: just the option).
    onAnswer: (text, shown) =>
      toPlanner(shown || text, () =>
        answerRequest(text, wp.plan, {
          asked: firstAsk,
          edits: wp.takeEdits(),
        }),
      ),
    onDecide: () =>
      toPlanner(
        "Decide for me and finish the plan",
        () =>
          decideRequest(wp.plan, { asked: firstAsk, edits: wp.takeEdits() }),
        "Asked the Planner to decide and finish the plan",
      ),
    onAskAgain: lastDirect
      ? () => toPlanner("Ask again", lastDirect.request, lastDirect.label)
      : null,
    onStartOver: String(firstAsk).trim()
      ? () =>
          toPlanner(
            "Start the plan over",
            startOverRequest(firstAsk),
            "Asked the Planner to start the plan over",
          )
      : null,
    onFix: () =>
      toPlanner(
        "Fill the gaps in the plan",
        () =>
          fixRequest((wp.check && wp.check.errors) || [], wp.plan, {
            asked: firstAsk,
            edits: wp.takeEdits(),
          }),
        "Asked the Planner to fill the gaps",
      ),
    onBuild: starting || walking ? null : buildIt,
    onChange: () => {
      const box =
        typeof document !== "undefined"
          ? document.querySelector(
              '[data-testid="lead-workspace"] [data-testid="ask-step"] textarea',
            )
          : null;
      if (box) box.focus();
    },
    onStopPlanner: () => askCtl.current && askCtl.current.stopPlanner(),
  };
  // The wizard's widget in words: where it goes, what it reads from.
  const wizardWords = wp.wizard
    ? {
        where: wp.plan && wp.plan.cell ? cellPlace(wp.plan.cell) : "",
        reads: readsFromNames(wp.wizard.piece, wp.providers, wp.picked),
      }
    : {};
  // The wizard's steps 2–5: the wizard's widget, part by part, before it's
  // built — a plan that only makes that one new widget (a reused one, or a
  // dashboard's layout, keeps the plan's own view), with no questions or
  // gaps left to settle first.
  const wizardOn =
    !!wp.wizard &&
    !!wp.plan &&
    isNewOnlyWidget(wp.plan, wp.wizard.piece) &&
    !(wp.build && !removed) &&
    !wp.waitingForPick &&
    !(wp.plan.questions || []).length &&
    !(wp.check && (wp.check.errors || []).length);
  // Which step: What it does, Talks to, then Review & build (step 5).
  // A stage from the other steps (a widget the user has) isn't one of these.
  const wizardStage = wizardOn
    ? WIZARD_ASKS.includes(wp.wizardStage)
      ? wp.wizardStage
      : "does"
    : null;
  const reviewing = wizardStage === "review";
  const reviewSet = reviewing
    ? (() => {
        const r = reviewRows(wp.plan, wp.wizard.piece, {
          providers: wp.providers,
          picked: wp.picked,
          reads: wp.wizard.reads,
          where: wizardWords.where,
        });
        return r.setCount === r.total;
      })()
    : false;
  // Reads from's Change / Choose: which widget's window is open.
  const [choosingAt, setChoosingAt] = useState(null);
  // A widget the user already has, into a cell (the approved "…goes
  // through its own steps"): Which one, Settings, Review — nothing to build.
  const reuseOn =
    !wizardOn &&
    !!wp.reuse &&
    !!wp.plan &&
    !(wp.build && !removed) &&
    !wp.waitingForPick &&
    !(wp.plan.questions || []).length &&
    !(wp.check && (wp.check.errors || []).length);
  const reuseConfig = (id) =>
    (id && ComponentManager.config && ComponentManager.config(id)) || null;
  const reuseIds = reuseOn
    ? packageComponentIds(
        wp.reuse.piece.package,
        Object.keys(
          (ComponentManager.componentMap && ComponentManager.componentMap()) ||
            {},
        ),
      )
    : [];
  // Installed: its widgets are registered here (a registry one isn't yet).
  const reuseInstalled = reuseIds.length > 0;
  const reuseSuggested = reuseOn
    ? (wp.reuse.planned.component &&
        reuseIds.find(
          (id) =>
            id.split(".").pop() ===
            String(wp.reuse.planned.component).split(".").pop(),
        )) ||
      componentNamed(
        reuseIds,
        wp.reuse.planned.name,
        (id) => (reuseConfig(id) || {}).displayName,
      )
    : null;
  const reusePicked =
    reuseOn && wp.choices.component && reuseIds.includes(wp.choices.component)
      ? wp.choices.component
      : null;
  const reuseComponent =
    reusePicked || (reuseIds.length === 1 ? reuseIds[0] : null);
  // Which one is asked only when the package has several.
  const reuseOrder =
    reuseIds.length > 1
      ? ["which", "settings", "review"]
      : ["settings", "review"];
  const reuseStage = !reuseOn
    ? null
    : reuseIds.length > 1 && !reusePicked
      ? "which"
      : reuseOrder.includes(wp.wizardStage)
        ? wp.wizardStage
        : reuseOrder[0];
  const reuseName = reuseOn
    ? (reuseConfig(reuseComponent) || {}).displayName ||
      wp.reuse.piece.name ||
      "your widget"
    : "";
  const reuseFields = reuseOn
    ? settingFields(
        (reuseConfig(reuseComponent) || {}).userConfig ||
          // Not installed yet: the Planner's settings, to type.
          Object.fromEntries(
            Object.keys(wp.reuse.planned.settings || {}).map((k) => [
              k,
              { type: "text", displayName: settingLabel(k) },
            ]),
          ),
        wp.reuse.planned.settings || {},
        wp.choices.settings || {},
      )
    : [];
  // What it reads from follows from the widget picked: the user's
  // providers of the kind it's built for (one is used as it is).
  const reuseNeeds = reuseOn
    ? readsFromNeeds(
        (reuseConfig(reuseComponent) || {}).providers ||
          (Array.isArray(wp.reuse.planned.providers)
            ? wp.reuse.planned.providers
            : []
          ).map((type) => ({ type })),
        wp.providers,
        {
          ...(wp.reuse.planned.provider || {}),
          ...(wp.choices.provider || {}),
        },
      )
    : [];
  const reuseMissing =
    reuseNeeds.find((n) => n.required && !n.options.length) || null;
  const reuseUnpicked =
    reuseNeeds.find((n) => n.required && n.options.length && !n.selected) ||
    null;
  const reusePkgLabel = reuseOn
    ? (reuseConfig(reuseIds[0]) || {}).package ||
      String(wp.reuse.piece.package).split("/").pop()
    : "";
  reviewHeld.current =
    (wizardOn && !(reviewing && reviewSet)) ||
    (reuseOn && (reuseStage !== "review" || !!reuseMissing || !!reuseUnpicked));
  // A new plan or conversation: its own window.
  const reviewKey = `${wp.key || ""}:${wp.step ? wp.step.id : ""}`;
  useEffect(() => {
    setChoosingAt(null);
  }, [reviewKey]);
  // A part chosen in the wizard: kept over every plan (wp.choose), and the
  // Planner told with the next message — only when it changed.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const editSettings = (next) => {
    const w = wp.wizard;
    if (!w || same(next, w.piece.settings || {})) return;
    wp.choose(
      "settings",
      next,
      `the user set ${w.piece.name}'s settings to: ${Object.keys(next)
        .map((k) => `${settingLabel(k)} (${k}) = ${JSON.stringify(next[k])}`)
        .join("; ")} — keep them`,
    );
  };
  const chooseDoes = ({ changes, settings, refresh }) => {
    const w = wp.wizard;
    if (!w) return;
    const name = w.piece.name;
    // Not said yet: what's ticked (even nothing — it only reads) is said now.
    const had = w.piece.changes;
    if (!Array.isArray(had) || !same(changes, had)) {
      wp.choose(
        "changes",
        changes,
        changes.length
          ? `the user chose what ${name} may change: only with ${changes.join(", ")} (${changes.map(toolWords).join(", ")}) — keep it`
          : `the user chose that ${name} only reads — it changes nothing`,
      );
    }
    editSettings(settings);
    if (refresh !== refreshChoices(w.piece).value) {
      wp.choose(
        "refresh",
        refresh,
        `the user chose how often ${name} reads again: ${refresh}`,
      );
    }
    wp.choose("confirmed", [
      ...new Set([...(wp.choices.confirmed || []), "does"]),
    ]);
    wp.setWizardStage("talks");
  };
  const chooseTalks = ({ eventsOff, listens }) => {
    const w = wp.wizard;
    if (!w) return;
    const name = w.piece.name;
    if (!same(eventsOff, wp.choices.eventsOff || [])) {
      wp.choose(
        "eventsOff",
        eventsOff,
        eventsOff.length
          ? `the user doesn't want ${name} to send: ${eventsOff.join(", ")}`
          : `the user wants ${name} to send all it proposed`,
      );
    }
    const had = Array.isArray(w.piece.listens) ? w.piece.listens : [];
    if (!same(listens, had)) {
      wp.choose(
        "listens",
        listens,
        listens.length
          ? `the user wants ${name} to show: ${listens
              .map(
                (l) => `${l.bot}'s "${l.result}" result (handler ${l.handler})`,
              )
              .join(
                "; ",
              )} — those bots are already on the dashboard; Dash wires them`
          : `the user wants ${name} to listen for nothing`,
      );
    }
    wp.choose("confirmed", [
      ...new Set([...(wp.choices.confirmed || []), "talks"]),
    ]);
    wp.setWizardStage("looks");
  };
  const chooseLook = (look) => {
    const w = wp.wizard;
    if (!w) return;
    // The Planner is told a look only when it changed.
    const was = wp.choices.look || null;
    wp.choose(
      "look",
      look,
      was && same(was, look)
        ? null
        : `the user picked how ${w.piece.name} looks: ${JSON.stringify(look)} — keep it`,
    );
    wp.setWizardStage("review");
  };
  const toWizardStep = (stage) => wp.setWizardStage(stage);
  // Step 1 · Reads from: the user's pick pins the widget and the Planner
  // plans with it.
  const useReadsPick = (chosen) => {
    const pk = wp.pick;
    if (!pk || !chosen || !chosen.length) return;
    const names = chosen.map((c) => c.name);
    const w = wp.wizard;
    if (w) {
      const { plan: pinned } = pinWidgetProviders(wp.plan, w.index, chosen);
      wp.edit(pinned, null);
    }
    wp.notePicked(names, wp.step ? wp.step.id : null);
    const list = names.join(" and ");
    // The Planner's own question: answered in its words.
    if (pk.question) {
      planActions.onAnswer(
        providerPickAnswer(pk.question.question, chosen, pk.question.options),
        `Use ${list}`,
      );
      return;
    }
    planActions.onAnswer(
      `${pk.name} reads from ${list} — the user picked ${
        names.length === 1 ? "it" : "them"
      } from their providers. Plan it with ${list} only (their saved tools); if ${
        names.length === 1 ? "it" : "one"
      } can't give what the widget needs, say so plainly.`,
      `Use ${list}`,
    );
  };
  const pickCard =
    wp.waitingForPick && wp.pick ? (
      <StepReadsFrom
        piece={wp.pick.piece || { name: wp.pick.name }}
        reads={wp.pick.reads}
        reasons={wp.pick.reasons || null}
        onUse={useReadsPick}
        readOnly={askBusy}
      />
    ) : null;
  // The step line while the user picks: what was found, not "drafted a plan".
  const stepTail = (s) => {
    if (!s) return null;
    if (wp.waitingForPick && wp.pick && wp.step && s.id === wp.step.id) {
      return foundLine(wp.pick.piece || { name: wp.pick.name }, wp.pick.reads);
    }
    if (wp.pickStepId && s.id === wp.pickStepId && wp.picked.length) {
      return `asked which provider to use · you picked ${wp.picked.join(" and ")}`;
    }
    return null;
  };
  // The lead's words on the draft the user was asked to pick at — a plan
  // that isn't one yet — stay out: the pick shows in their place.
  const pickAt = (() => {
    const id =
      wp.waitingForPick && wp.step ? wp.step.id : wp.pickStepId || null;
    return id ? messages.findIndex((m) => m && m.id === id) : -1;
  })();
  const hideMessage = (m, i) => {
    if (pickAt < 0 || i <= pickAt || !m) return false;
    if (m.who !== "role" && m.who !== "lead") return false;
    // Only the lead's answer before the user's own next message.
    for (let j = pickAt + 1; j < i; j += 1) {
      if (messages[j] && messages[j].who === "you") return false;
    }
    return true;
  };
  // The step bar in the header: the step being asked, the ones before ticked.
  const headerSteps = reuseOn
    ? REUSE_STEPS.filter((s) => reuseOrder.includes(s.id))
    : undefined;
  const headerStep = reuseOn
    ? reuseStage
    : pickCard
      ? "reads"
      : wizardStage || "reads";
  const headerDone = (() => {
    if (reuseOn) {
      const before = reuseOrder.slice(0, reuseOrder.indexOf(reuseStage));
      return Object.fromEntries(before.map((id) => [id, "Done"]));
    }
    if (!wizardOn || pickCard) return {};
    const notes = stepNotes(wp.wizard.piece, wizardWords.reads || "Picked");
    const order = ["reads", ...WIZARD_ASKS];
    const before = order.slice(0, order.indexOf(headerStep));
    return Object.fromEntries(
      Object.entries(notes).filter(([id]) => before.includes(id)),
    );
  })();
  const next = planNext({
    messages,
    busy: askBusy,
    plan: wp.plan,
    check: wp.check,
    sent: wp.sent,
    build: wp.build && !removed ? wp.build : null,
  });

  // After a message: the plan's card under the step that brought it, and
  // the reply choices under the lead's answer to it.
  const choicesAt = choicesIndex(messages);
  const leadName = contact ? contact.name : "Dash Lead";
  const fixAts = wp.build
    ? messages
        .map((x, j) =>
          x && x.who === "you" && x.fix && j > wp.build.at ? j : -1,
        )
        .filter((j) => j >= 0)
    : [];
  const lastFix = fixAts.length ? fixAts[fixAts.length - 1] : -1;
  const renderAfter = (m, i, api) => {
    // Under a fix: the Builder changing the widget, then the widget changed
    // (the latest), or what an earlier one did.
    const fixN = fixAts.indexOf(i);
    if (fixN >= 0) {
      return i === lastFix ? (
        <BuildInChat
          build={wp.build}
          state={pb.state}
          leadName={leadName}
          current
          fix={fixN + 1}
          actions={buildActions}
          restored={pb.restored}
          change={buildChange(wp.build)}
          cell={buildCell(wp.build)}
          actionError={pb.actionError || buildError}
        />
      ) : (
        <PastFix state={pb.state} n={fixN + 1} />
      );
    }
    // A build shows after the message it started from (release 3b).
    const builds = wp.builds.filter((b) => b.at === i);
    if (builds.length) {
      return (
        <>
          {builds.map((b) =>
            b === wp.build ? (
              <BuildInChat
                key={b.buildId}
                build={b}
                state={pb.state}
                leadName={leadName}
                current
                earlier={lastFix >= 0}
                yes={yesLabel(wp.plan, { rawThemes, username })}
                actions={buildActions}
                restored={pb.restored}
                change={buildChange(b)}
                cell={buildCell(b)}
                actionError={pb.actionError || buildError}
              />
            ) : (
              <PastBuild
                key={b.buildId}
                build={b}
                leadName={leadName}
                onOpen={() => setSideOpen(null)}
              />
            ),
          )}
        </>
      );
    }
    // The wizard (steps 2–5), as a chat: each step the Planner's question in
    // its bubble with your answer in one card under it; the steps before it
    // read as its question and your answer. Review & build ends with the
    // plan's own buttons.
    const wizardDashboard =
      (convCell && convCell.dashboardName) ||
      (wp.plan && wp.plan.dashboard && wp.plan.dashboard.name) ||
      "";
    const questions = !wizardOn
      ? {}
      : {
          does: doesQuestion(wp.wizard.piece, wp.providers),
          talks: talksQuestion(
            wp.plannedPiece || wp.wizard.piece,
            wp.choices.eventsOff || [],
            wizardDashboard,
          ),
          looks: looksQuestion(),
          review: {
            question: reviewSet
              ? "Here's the whole widget. Build it?"
              : "Here's the whole widget — one part needs you.",
            why: reviewSet
              ? "I proposed what you didn't say. Check each part and change anything now — it's free until it's built."
              : "Which provider it reads from. The rest I proposed — check it, change anything.",
          },
        };
    const answers = wizardOn ? stepAnswers(wp.wizard.piece, wp.providers) : {};
    const askedBefore = (stage) =>
      WIZARD_ASKS.slice(0, WIZARD_ASKS.indexOf(stage)).map((id) => (
        <React.Fragment key={id}>
          <ChatMessage
            role="reply"
            label="Planner"
            meta={`Step ${WIZARD_ASKS.indexOf(id) + 2} of 5`}
          >
            {questions[id].question}
          </ChatMessage>
          <ChatMessage role="you">{answers[id]}</ChatMessage>
        </React.Fragment>
      ));
    const ask = (stage, answer) => (
      <>
        {askedBefore(stage)}
        <ChatMessage
          role="reply"
          label="Planner"
          meta={`Step ${WIZARD_ASKS.indexOf(stage) + 2} of 5`}
          testId="wizard-ask"
          footer={answer}
        >
          <StepQuestion
            question={questions[stage].question}
            why={questions[stage].why}
          />
        </ChatMessage>
      </>
    );
    const providerDialog =
      choosingAt !== null ? (
        <ChooseProviderDialog
          plan={wp.plan}
          index={choosingAt}
          onEdit={wp.edit}
          picked={wp.picked}
          onPicked={wp.notePicked}
          onReplan={planActions.onAnswer}
          onClose={() => setChoosingAt(null)}
        />
      ) : null;
    const reviewCard = !wizardOn ? null : wizardStage === "does" ? (
      <>
        {ask(
          "does",
          <StepDoes
            key={`does:${reviewKey}`}
            piece={wp.wizard.piece}
            providers={wp.providers}
            readOnly={answering}
            onNext={chooseDoes}
            onBack={() => setChoosingAt(wp.wizard.index)}
          />,
        )}
        {providerDialog}
      </>
    ) : wizardStage === "looks" ? (
      ask(
        "looks",
        <StepLooks
          key={`looks:${reviewKey}`}
          piece={wp.wizard.piece}
          preview={previewRead(wp.wizard.piece, wp.providers)}
          look={wp.choices.look || null}
          readOnly={answering}
          onPick={(look) => wp.choose("look", look)}
          onNext={chooseLook}
          onBack={() => toWizardStep("talks")}
          onDescribe={() => api.focusReply()}
        />,
      )
    ) : wizardStage === "talks" ? (
      ask(
        "talks",
        <StepTalks
          key={`talks:${reviewKey}`}
          plannedPiece={wp.plannedPiece}
          piece={wp.wizard.piece}
          eventsOff={wp.choices.eventsOff || []}
          botEmitters={wp.hasDashboard ? wp.botEmitters : []}
          hasDashboard={wp.hasDashboard}
          dashboardName={wizardDashboard}
          readsFrom={wizardWords.reads}
          readOnly={answering}
          onNext={chooseTalks}
          onBack={() => toWizardStep("does")}
          onDescribe={() => api.focusReply()}
        />,
      )
    ) : (
      <>
        {ask(
          "review",
          <StepReview
            plan={wp.plan}
            piece={wp.wizard.piece}
            providers={wp.providers}
            picked={wp.picked}
            reads={wp.wizard.reads}
            where={wizardWords.where}
            edited={chosenParts(wp.choices)}
            readOnly={answering}
            onChoose={() => setChoosingAt(wp.wizard.index)}
            onSettings={editSettings}
            onChat={() => api.focusReply()}
            onStep={toWizardStep}
            footer={
              !wp.build && !api.busy ? (
                <PlanChoices
                  plan={wp.plan}
                  check={wp.check}
                  sent={wp.sent}
                  onSend={api.send}
                  onBuild={starting || walking ? null : buildIt}
                  onChange={api.focusReply}
                  onAnswer={planActions.onAnswer}
                  onDecide={planActions.onDecide}
                  onFix={planActions.onFix}
                  onPicked={planActions.onPicked}
                  yesTitle="Yes, build it"
                  yesDisabled={!reviewSet}
                />
              ) : null
            }
          />,
        )}
        {buildError ? (
          <span
            className={`text-xs ${muted}`}
            data-testid="workspace-build-error"
          >
            {buildError}
          </span>
        ) : null}
        {providerDialog}
      </>
    );
    // A widget the user already has: its own steps, asked the same way.
    const reuseQs = !reuseOn
      ? {}
      : {
          which: reuseQuestion("which", {
            count: reuseIds.length,
            pkgLabel: reusePkgLabel,
            installed: reuseInstalled,
          }),
          settings: reuseQuestion("settings", { name: reuseName }),
          review: reuseQuestion("review", { name: reuseName }),
        };
    const reuseSaid = {
      which: reuseName,
      settings: settingsLine(reuseFields),
    };
    const reuseStep = (id) =>
      `Step ${reuseOrder.indexOf(id) + 1} of ${reuseOrder.length}`;
    const reuseAsk = (stage, answer) => (
      <>
        {reuseOrder.slice(0, reuseOrder.indexOf(stage)).map((id) => (
          <React.Fragment key={id}>
            <ChatMessage role="reply" label="Planner" meta={reuseStep(id)}>
              {reuseQs[id].question}
            </ChatMessage>
            <ChatMessage role="you">{reuseSaid[id]}</ChatMessage>
          </React.Fragment>
        ))}
        <ChatMessage
          role="reply"
          label="Planner"
          meta={reuseStep(stage)}
          testId="reuse-ask"
          footer={answer}
        >
          <StepQuestion
            question={reuseQs[stage].question}
            why={reuseQs[stage].why}
          />
        </ChatMessage>
      </>
    );
    const pieceName = reuseOn ? wp.reuse.piece.name : "";
    const reuseCard = !reuseOn
      ? null
      : reuseStage === "which"
        ? reuseAsk(
            "which",
            <ReuseWhich
              key={`which:${reviewKey}`}
              ids={reuseIds}
              configOf={reuseConfig}
              packageId={wp.reuse.piece.package}
              installed={reuseInstalled}
              picked={reusePicked}
              suggested={reuseSuggested}
              settings={wp.reuse.planned.settings || {}}
              readOnly={answering}
              onNext={(id) => {
                const c = reuseConfig(id) || {};
                wp.choose(
                  "component",
                  id,
                  id === wp.choices.component
                    ? null
                    : `the user picked ${c.displayName || id} (component ${id}) for ${pieceName} — keep it`,
                );
                wp.setWizardStage("settings");
              }}
              onBuildNew={() =>
                planActions.onAnswer(
                  `None of the ${reusePkgLabel} widgets fit. Plan a new widget for this cell instead (source "new").`,
                  "Build a new one instead",
                )
              }
            />,
          )
        : reuseStage === "settings"
          ? reuseAsk(
              "settings",
              <ReuseSettings
                key={`settings:${reviewKey}:${reuseComponent || ""}`}
                fields={reuseFields}
                readsFrom={reuseNeeds.filter((n) => n.options.length > 1)}
                readOnly={answering}
                onBack={
                  reuseIds.length > 1 ? () => wp.setWizardStage("which") : null
                }
                onNext={(values, reads = {}) => {
                  // What it reads from: picked here, or the only one.
                  const pins = {
                    ...Object.fromEntries(
                      reuseNeeds
                        .filter((n) => n.selected)
                        .map((n) => [n.type, n.selected]),
                    ),
                    ...reads,
                  };
                  if (
                    Object.keys(pins).length &&
                    JSON.stringify(pins) !==
                      JSON.stringify(wp.choices.provider || null)
                  ) {
                    wp.choose(
                      "provider",
                      pins,
                      `the user picked what ${reuseName} reads from: ${Object.entries(
                        pins,
                      )
                        .map(([t, n]) => `${n} (${t})`)
                        .join(", ")} — keep it`,
                    );
                  }
                  // Picked, as the provider question would have (the
                  // build's checklist counts it).
                  if (Object.keys(pins).length)
                    wp.notePicked(Object.values(pins));
                  const planned = wp.reuse.planned.settings || {};
                  const changed = Object.keys(values).some(
                    (k) =>
                      String(values[k] ?? "") !==
                      String(
                        planned[k] ??
                          reuseFields.find((f) => f.key === k)?.suggested ??
                          "",
                      ),
                  );
                  if (changed || wp.choices.settings) {
                    wp.choose(
                      "settings",
                      values,
                      `the user set ${reuseName}'s settings to: ${Object.keys(
                        values,
                      )
                        .map((k) => `${k} = ${JSON.stringify(values[k])}`)
                        .join("; ")} — keep them`,
                    );
                  }
                  wp.setWizardStage("review");
                }}
              />,
            )
          : reuseAsk(
              "review",
              <ReuseReview
                rows={[
                  {
                    key: "widget",
                    label: "Widget",
                    value: `${reuseName} — ${
                      reuseInstalled
                        ? "yours, already installed"
                        : "from the registry, installed when you say yes"
                    }`,
                    chose: !!reusePicked,
                    change: reuseIds.length > 1 ? "which" : null,
                  },
                  {
                    key: "reads",
                    label: "Reads from",
                    value: reuseNeeds.length
                      ? reuseNeeds
                          .map(
                            (n) =>
                              n.selected ||
                              (n.options.length
                                ? `Choose which ${providerLabel(n.type)}`
                                : `Needs a ${providerLabel(n.type)} provider`),
                          )
                          .join(", ")
                      : "Nothing — it needs no connection",
                    chose: !!wp.choices.provider,
                    change: reuseNeeds.some((n) => n.options.length > 1)
                      ? "settings"
                      : null,
                  },
                  {
                    key: "settings",
                    label: "Settings",
                    value: settingsLine(reuseFields),
                    chose: !!wp.choices.settings,
                    change: "settings",
                  },
                  {
                    key: "where",
                    label: "Where it goes",
                    value: wp.plan.cell
                      ? `${
                          (convCell && convCell.dashboardName) ||
                          (wp.plan.dashboard && wp.plan.dashboard.name) ||
                          "Your dashboard"
                        } — ${cellPlace(wp.plan.cell)}`
                      : "",
                  },
                ]}
                onStep={(stage) => wp.setWizardStage(stage)}
                installed={reuseInstalled}
                blocked={
                  reuseMissing
                    ? `${reuseName} reads from ${providerLabel(
                        reuseMissing.type,
                      )}, and you don't have one yet. Add one on the Providers page, then come back — this conversation keeps your place.`
                    : reuseUnpicked
                      ? `Choose which ${providerLabel(
                          reuseUnpicked.type,
                        )} it reads from first — in Settings.`
                      : null
                }
                readOnly={answering}
                footer={
                  !wp.build && !api.busy ? (
                    <PlanChoices
                      plan={wp.plan}
                      check={wp.check}
                      sent={wp.sent}
                      onSend={api.send}
                      onBuild={starting || walking ? null : buildIt}
                      onChange={api.focusReply}
                      onAnswer={planActions.onAnswer}
                      onDecide={planActions.onDecide}
                      onFix={planActions.onFix}
                      onPicked={planActions.onPicked}
                      yesTitle="Yes, preview it"
                    />
                  ) : null
                }
              />,
            );
    const choices =
      i === choicesAt && pickCard && !api.busy ? (
        pickCard
      ) : i === choicesAt && wizardOn && !api.busy ? (
        reviewCard
      ) : i === choicesAt && reuseOn && !api.busy ? (
        reuseCard
      ) : i === choicesAt && wp.plan && !wp.build && !api.busy ? (
        <>
          <PlanChoices
            plan={wp.plan}
            check={wp.check}
            sent={wp.sent}
            onSend={api.send}
            onBuild={starting || walking ? null : buildIt}
            onChange={api.focusReply}
            onAnswer={planActions.onAnswer}
            onDecide={planActions.onDecide}
            onFix={planActions.onFix}
            onPicked={planActions.onPicked}
          />
          {buildError ? (
            <span
              className={`text-xs ${muted}`}
              data-testid="workspace-build-error"
            >
              {buildError}
            </span>
          ) : null}
        </>
      ) : null;
    if (m.who === "step" && wp.step && m.id === wp.step.id && wp.plan) {
      // Nothing is planned until the user picks: the pick, not the plan.
      if (pickCard) return choicesAt === -1 ? pickCard : choices;
      // The wizard's widget: its review, under the lead's answer.
      if (wizardOn) return choicesAt === -1 ? reviewCard : choices;
      if (reuseOn) return choicesAt === -1 ? reuseCard : choices;
      return (
        <>
          {/* The whole plan, read here — no click to the side to decide. */}
          <div
            className={`dr-chat-card self-start w-full max-w-2xl rounded-xl border p-4 ${hairline}`}
            data-testid="chat-plan"
          >
            <PlanOutput
              wp={wp}
              onReplan={planActions.onAnswer}
              readOnly={answering}
              leadName={contact ? contact.name : undefined}
              onWidgetMode={
                convWidget && convWidget.canInPlace ? setModePick : null
              }
              onSignIn={
                convWidget && convWidget.canSignIn && making && making.widget
                  ? signInToChange
                  : null
              }
            />
          </div>
          {/* Brought by the app's own hand-off: its choices are here. */}
          {choices}
        </>
      );
    }
    // The draft the user was asked to pick at: no plan card — the pick was
    // the answer (frame 1).
    if (m.who === "step" && wp.pickStepId && m.id === wp.pickStepId) {
      return null;
    }
    // An earlier plan keeps its card: the history still opens it.
    if (m.who === "step" && m.plan) {
      return (
        <PlanCard
          plan={m.plan}
          earlier
          onOpen={() => setSideOpen(`plan:${m.id}`)}
        />
      );
    }
    return choices;
  };

  // The Dash team's working roles, in the order they work — under a
  // dashboard lead's bots once it brings them in (release 3c).
  const dashTeamRoles = useMemo(
    () =>
      WORK_ROLES.map((r) =>
        (all.dashTeam || []).find((b) => b && b.role === r),
      ).filter(Boolean),
    [all.dashTeam],
  );
  // The folded Outputs button's dot: something on the right needs you, or
  // one of this conversation's bots waits for an approval (frame 35).
  const askingIds = contact
    ? [contact.botId, ...(contact.members || []).map((m) => m.id)]
    : [];
  const needsYou =
    sideSummary.needsYou ||
    (all.approvals || []).some(
      (a) => a && a.request && askingIds.includes(a.request.botId),
    );
  const isBot = contact && contact.kind === "bot";
  const lone = isBot ? all.bots.find((b) => b.id === contact.botId) : null;
  const start = makingShown
    ? { title: making.title, text: making.greeting, starters: making.starters }
    : startText(contact);
  // The "Making:" line: a page's New, before and after its first question,
  // or what a reopened conversation was saved as.
  const aboutShown =
    makingShown && (!open || open.making)
      ? making
      : open && open.recentId
        ? reopenedAbout
        : null;
  // Making a bot or a dashboard: the way picked, on its own screen.
  const makingBot = !!makingReq && makingReq.kind === "bot";
  const backToWays = () => leaveWay(null);
  const askAiInstead = () => leaveWay("ai");
  const wayErrorLine = wayError ? (
    <span
      className={`text-sm ${muted}`}
      role="status"
      data-testid="make-way-error"
    >
      {wayError}
    </span>
  ) : null;
  const goesOn = makingBot ? (
    <GoesOn
      target={botTarget}
      onChange={installed || installing ? null : changeWhere}
    />
  ) : null;
  let wayView = null;
  if (ways && way && way !== "ai") {
    const screen = (props, children) => (
      <WayScreen
        onBack={backToWays}
        onAskAi={askAiInstead}
        testId={`make-way-${way}`}
        {...props}
      >
        {children}
      </WayScreen>
    );
    if (way === "where") {
      wayView = screen(
        {
          title: "Where should the bot go?",
          footer: (
            <WayActions
              primary="Continue"
              disabled={!wherePick}
              onPrimary={confirmWhere}
            />
          ),
        },
        <WherePicker
          dashboards={savedDashboards}
          picked={wherePick}
          onPick={setWherePick}
        />,
      );
    } else if (installed) {
      const n = installed.bots.length;
      const first = installed.bots[0];
      wayView = screen(
        {
          title: `${installed.name} is installed`,
          goesOn,
          footer: first ? (
            <WayActions
              primary="Open it"
              onPrimary={() => {
                window.dispatchEvent(
                  new CustomEvent("dash:open-bot", {
                    detail: { botId: first.id, tab: "activity" },
                  }),
                );
                onClose();
              }}
            />
          ) : null,
        },
        <div className="flex flex-col gap-2" data-testid="make-installed">
          <span className={`text-sm ${strong}`}>
            {`Added ${n} paused bot${n === 1 ? "" : "s"}. Turn ${
              n === 1 ? "it" : "them"
            } on when you're ready.`}
          </span>
          {installed.skipped && installed.skipped.length ? (
            <div className="flex flex-col gap-1">
              <span className={`text-xs ${muted}`}>Not set up:</span>
              {installed.skipped.map((t) => (
                <span key={t} className={`text-xs ${muted}`}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>,
      );
    } else if (review) {
      wayView = screen(
        {
          title: way === "file" ? "A bot file" : "A bot from the registry",
          goesOn,
        },
        <TeamImportReview
          key={review.previewId || review.fileName || "review"}
          preview={review}
          installing={installing}
          error={wayError}
          noDashboard={!!(botTarget && botTarget.none)}
          onInstall={installReviewed}
          onCancel={() => {
            setWayError(null);
            if (way === "file") backToWays();
            else setReview(null);
          }}
        />,
      );
    } else if (way === "registry" && makingBot) {
      wayView = screen(
        { title: "A bot from the registry", goesOn },
        <>
          {wayErrorLine}
          <RegistryBrowse
            embedded
            onPick={pickRegistryBot}
            onClose={backToWays}
          />
        </>,
      );
    } else if (way === "registry") {
      wayView = screen(
        { title: "A dashboard from the registry" },
        <>
          <span className={`text-sm ${muted}`}>
            Use this turns it into a plan in this conversation — you adjust it
            with the Dash team, and nothing is installed until you say yes.
          </span>
          <RegistryOutput onUse={pickRegistryDashboard} />
        </>,
      );
    } else if (way === "copy" && makingBot) {
      wayView = screen(
        {
          title: "Copy one of your bots",
          goesOn,
          footer: (
            <WayActions
              primary="Copy and open the form"
              disabled={!wayPicked}
              onPrimary={copyPickedBot}
            />
          ),
        },
        <CopyPicker
          intro="Pick one to start from. The copy is its own bot — changing one never changes the other — and you can change anything before it's saved."
          searchLabel="Search your bots"
          query={wayQuery}
          onQuery={setWayQuery}
          groups={botGroups.map((g) => ({
            label: g.label,
            items: g.bots.map((b) => ({
              id: b.id,
              title: b.name,
              meta: botLine(b),
            })),
          }))}
          pickedId={wayPicked}
          onPick={setWayPicked}
          note="Leads and the Dash team aren't listed — each dashboard has its own lead."
          empty="No bots to copy yet."
        />,
      );
    } else if (way === "copy") {
      const q = wayQuery.trim().toLowerCase();
      wayView = screen(
        {
          title: "Copy one of your dashboards",
          footer: (
            <WayActions
              primary={copying ? "Copying…" : "Copy and open it"}
              disabled={!wayPicked || copying || !onDuplicateDashboard}
              onPrimary={copyPickedDashboard}
            />
          ),
        },
        <>
          {wayErrorLine}
          <CopyPicker
            intro="Pick one to start from. The copy is its own dashboard with the same widgets and layout; its bots stay with the original — copy them with Add bot."
            searchLabel="Search your dashboards"
            query={wayQuery}
            onQuery={setWayQuery}
            groups={[
              {
                label: "",
                items: savedDashboards
                  .filter((d) => !q || d.name.toLowerCase().includes(q))
                  .map((d) => ({
                    id: d.id,
                    title: d.name,
                    meta: d.bots
                      ? `${d.bots} bot${d.bots === 1 ? "" : "s"}`
                      : "No bots",
                  })),
              },
            ].filter((g) => g.items.length)}
            pickedId={wayPicked}
            onPick={setWayPicked}
            empty="No dashboards to copy yet."
          />
        </>,
      );
    }
  }
  const title = isBot
    ? `Your conversation with ${contact.name}`
    : open
      ? (threads.find((t) => t.id === selectedId) || {}).title ||
        open.question ||
        "Conversation"
      : "New conversation";

  return (
    <Modal
      isOpen
      setIsOpen={(v) => {
        if (!v) onClose();
      }}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        className={`dr-chat-shell relative flex flex-row h-full w-full rounded-xl overflow-hidden border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="lead-workspace"
      >
        {/* A folded column open over the conversation (frames 35, 36):
            clicking beside it, or Escape, closes it. Under the header, so ☰
            and Outputs still toggle; the window's × waits until it closes. */}
        {drawerOpen ? (
          <button
            type="button"
            aria-label="Close panel"
            tabIndex={-1}
            data-testid="workspace-scrim"
            // Classes the app's prebuilt CSS has (no inset-x-0 / bottom-0 / z-20).
            className="absolute left-0 right-0 z-10 cursor-default"
            style={{ top: headerH, bottom: 0 }}
            onClick={() => {
              setNavOpen(false);
              setOutsOpen(false);
            }}
          />
        ) : null}
        {/* Left: who you're talking to, and their conversations */}
        <nav
          ref={navRef}
          aria-label="Conversations"
          onKeyDown={(e) => {
            // Folded, the window-level Escape handles it (above).
            if (e.key === "Escape" && !narrow) setSwitchOpen(false);
          }}
          className={
            narrow
              ? navOpen
                ? `absolute left-0 z-30 w-64 flex flex-col gap-1 border-r p-3 min-h-0 shadow-lg ${hairline} ${panel.backgroundColor || ""}`
                : "hidden"
              : `dr-chat-shell-side relative w-64 flex-shrink-0 flex flex-col gap-1 border-r p-3 min-h-0 ${hairline}`
          }
          style={
            narrow && navOpen
              ? { top: headerH, bottom: 0, maxWidth: "100%" }
              : undefined
          }
          data-testid="workspace-nav"
        >
          <button
            type="button"
            onClick={() => setSwitchOpen((v) => !v)}
            aria-expanded={switchOpen}
            aria-haspopup="menu"
            className={`flex flex-row items-center gap-3 rounded-lg border p-2 text-left ${raised}`}
            data-testid="workspace-switcher"
          >
            {contact ? (
              <BotAvatar
                bot={{ id: contact.botId, name: contact.name }}
                icon={contact.kind === "dashlead" ? "people-group" : undefined}
              />
            ) : null}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className={`text-sm font-semibold truncate ${strong}`}>
                {contact ? contact.name : "No one to talk to yet"}
              </span>
              <span
                className={`text-xs truncate ${muted}`}
                title={contact ? contact.line || contact.sub : undefined}
              >
                {contact ? contact.line || contact.sub : ""}
              </span>
            </span>
            <FontAwesomeIcon
              icon="chevron-down"
              className={`h-3 w-3 ${muted}`}
            />
          </button>
          {switchOpen ? (
            <div
              role="menu"
              className={`absolute left-1 right-1 z-30 flex flex-col gap-1 rounded-lg border p-2 shadow-lg overflow-y-auto ${hairline} ${panel.backgroundColor || ""}`}
              // Below the switcher, never over it; a long list scrolls
              // inside the window.
              style={{ top: 76, maxHeight: "calc(100% - 88px)" }}
              data-testid="workspace-switcher-menu"
            >
              {groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-0.5">
                  <span className={`px-2 pt-1 text-xs ${muted}`}>
                    {g.label}
                  </span>
                  {g.items.map((c) => {
                    const current = c.key === (contact && contact.key);
                    return (
                      <ListRow
                        key={c.key}
                        testId="workspace-switcher-item"
                        icon={
                          <BotAvatar
                            bot={{ id: c.botId, name: c.name }}
                            icon={
                              c.kind === "dashlead" ? "people-group" : undefined
                            }
                          />
                        }
                        title={
                          <span className="flex flex-row items-center gap-2">
                            <span className="truncate">{c.name}</span>
                            {current ? (
                              <span
                                role="img"
                                aria-label="Current"
                                className="flex-shrink-0"
                              >
                                <FontAwesomeIcon
                                  icon="check"
                                  className="h-3 w-3"
                                />
                              </span>
                            ) : null}
                          </span>
                        }
                        ariaLabel={current ? `${c.name} (current)` : c.name}
                        // One line: its dashboard and its bots.
                        meta={
                          <span
                            className="block truncate"
                            // A long team is cut short: hover for all of it.
                            title={c.menuLine || c.line || c.sub}
                          >
                            {c.menuLine || c.line || c.sub}
                          </span>
                        }
                        // The one you are on, in the theme's colour (the
                        // check mark says so too).
                        className={current ? raised : ""}
                        onClick={() => switchTo(c.key)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}

          {isBot ? null : (
            <>
              <div className="mt-2">
                <Button3
                  size="sm"
                  title="+ New conversation"
                  onClick={startNew}
                />
              </div>
              <span className={`px-2 pt-3 pb-1 text-xs ${muted}`}>Recents</span>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {/* A conversation not started yet is the first one (frame 13). */}
                {open ? null : (
                  <ListRow
                    testId="workspace-thread-new"
                    title="New conversation"
                    selected
                  />
                )}
                {threads.length ? (
                  threads.map((t) => (
                    <ListRow
                      key={t.id}
                      testId="workspace-thread"
                      title={t.title}
                      // Its age; "asked <this lead>" would repeat on every row.
                      meta={[
                        String(t.sub || "").split(" · ")[0],
                        t.fromCreate
                          ? `From Create${
                              BUILT_TAG[t.fromCreate]
                                ? ` · ${BUILT_TAG[t.fromCreate]}`
                                : ""
                            }`
                          : t.id === selectedId && wp.waitingForPick
                            ? "Waiting for you"
                            : t.built
                              ? BUILT_TAG[t.built] || null
                              : t.planned
                                ? "Plan"
                                : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      selected={t.id === selectedId}
                      onClick={() => {
                        setNavOpen(false);
                        if (open && t.id === selectedId) return;
                        // A Create plan being carried on: one at a time.
                        if (carrying.current) return;
                        setSelectedId(t.id);
                        setMessages(EMPTY);
                        setAskBusy(false);
                        setSideOpen(null);
                        setMakingOn(false);
                        moveOn();
                        // A plan from the Create window: carried on as a
                        // conversation (release 6c).
                        if (t.fromCreate) {
                          // The start shows while it's carried (and says
                          // so if it can't be).
                          setOpen(null);
                          carryOverCreatePlan(t.id);
                          return;
                        }
                        setOpen({ key: t.id, recentId: t.id });
                      }}
                    />
                  ))
                ) : open ? (
                  <span className={`px-2 py-2 text-xs ${muted}`}>
                    Your conversations with {contact ? contact.name : "them"}{" "}
                    show here.
                  </span>
                ) : null}
              </div>
            </>
          )}
        </nav>

        {/* Middle: the conversation */}
        <section
          aria-label="Conversation"
          // Lifted above the quiet sides: the conversation is the focus.
          className={`dr-chat-stage flex-1 min-w-0 flex flex-col min-h-0 ${
            narrow ? "" : "my-2 rounded-xl border overflow-hidden"
          } ${hairline} ${panel.backgroundColor || ""}`}
        >
          <header
            ref={headerRef}
            className={`flex-shrink-0 flex flex-row items-center px-6 py-3 border-b ${hairline}`}
          >
            {/* Folded (frame 35): plain bordered toggles — Button3 can't
                say it's open (aria-expanded). */}
            {narrow ? (
              <button
                ref={navBtn}
                type="button"
                aria-label="Conversations and leads"
                aria-expanded={navOpen}
                onClick={() => {
                  setOutsOpen(false);
                  setNavOpen((v) => !v);
                }}
                className={`flex-shrink-0 mr-3 max-w-xs truncate rounded-lg border px-2.5 py-1 text-sm ${hairline} ${strong} ${navOpen ? selectedBg : ""}`}
              >
                {`☰ ${contact ? contact.name : "Conversations"}`}
              </button>
            ) : null}
            <span
              className={`flex-1 min-w-0 text-sm font-semibold truncate ${strong}`}
            >
              {title}
            </span>
            {/* Where the widget's steps are, small (the chat asks them). */}
            {!narrow && (pickCard || wizardOn || reuseOn) ? (
              <span className="flex-shrink-0 ml-3">
                <StepBar
                  compact
                  current={headerStep}
                  done={headerDone}
                  {...(headerSteps ? { steps: headerSteps } : {})}
                />
              </span>
            ) : null}
            {/* Step 4 draws the looks across the window: no side column,
                so the window's × is here. */}
            {!narrow && wizardStage === "looks" ? (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className={`flex-shrink-0 ml-3 flex items-center justify-center h-8 w-8 rounded-lg ${muted}`}
              >
                <FontAwesomeIcon icon="xmark" className="h-4 w-4" />
              </button>
            ) : null}
            {narrow ? (
              <span className="flex-shrink-0 flex flex-row items-center gap-2 ml-3">
                <button
                  ref={outsBtn}
                  type="button"
                  aria-label={`Outputs ${sideSummary.count}${needsYou ? " — something needs you" : ""}`}
                  aria-expanded={outsOpen}
                  onClick={() => {
                    setNavOpen(false);
                    setOutsOpen((v) => !v);
                  }}
                  className={`flex flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm ${hairline} ${strong} ${outsOpen ? selectedBg : ""}`}
                >
                  {`Outputs ${sideSummary.count}`}
                  {/* Something needs you (frame 35). */}
                  {needsYou ? (
                    <span
                      aria-hidden="true"
                      data-testid="workspace-outputs-dot"
                      className={`inline-block h-2 w-2 rounded-full ${statusTokens.warning.solidBg}`}
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className={`flex items-center justify-center h-8 w-8 rounded-lg ${muted}`}
                >
                  <FontAwesomeIcon icon="xmark" className="h-4 w-4" />
                </button>
              </span>
            ) : null}
          </header>
          {/* What this conversation is about (frame 41): a page's New —
              also when it's reopened. */}
          {aboutShown ? (
            <div
              className={`flex-shrink-0 flex flex-row px-6 pt-4 pb-3 border-b ${hairline}`}
            >
              <span
                className={`rounded-full border px-3 py-1 text-sm ${hairline}`}
                data-testid="workspace-about"
              >
                <span className={muted}>{aboutShown.label}:</span>{" "}
                <span className={`font-semibold ${strong}`}>
                  {aboutShown.text}
                </span>
              </span>
            </div>
          ) : null}
          {loading ? (
            <div
              className={`flex-1 flex items-center justify-center text-sm ${muted}`}
              data-testid="workspace-loading"
            >
              Loading…
            </div>
          ) : missing ? (
            <div
              className={`flex-1 flex flex-col items-center justify-center gap-2 px-6 text-sm ${muted}`}
              data-testid="workspace-missing"
            >
              <span>That lead or bot isn&apos;t available any more.</span>
              <span>Pick who to talk to at the top left.</span>
            </div>
          ) : isBot && lone ? (
            <BotChat key={lone.id} bot={lone} />
          ) : !open && ways && way === null ? (
            // Making a bot or a dashboard: its ways (frames 2 and 10).
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 py-6">
              <div className="my-auto">
                <WaysChooser
                  ways={ways}
                  onPick={pickWay}
                  raised={raised}
                  error={wayError}
                />
              </div>
            </div>
          ) : !open && wayView ? (
            wayView
          ) : open && contact ? (
            <StepTailContext.Provider value={stepTail}>
              <AskStep
                // A new lead is a new conversation (never a carried-over one).
                key={`${contact.key}:${open.key}`}
                question={open.question || ""}
                // A page's New: saved with it, and the Dash Lead is told
                // what's being made.
                about={open.making ? makingAbout(making) : null}
                onAbout={setReopenedAbout}
                recentId={open.recentId || null}
                recipient={contact.recipient}
                hideTo
                approvalBots={[
                  { id: contact.botId, name: contact.name },
                  ...contact.members,
                ]}
                onStarted={setSelectedId}
                onMessagesChange={setMessages}
                onBusyChange={setAskBusy}
                renderAfter={renderAfter}
                hideMessage={hideMessage}
                // A typed reply takes the plan (and the changes made to it on
                // the right) along, so a change reaches the Planner whole.
                prepareSend={(t) => withPlanContext(t, wp.plan, wp.takeEdits())}
                // A typed "yes" to a plan that can be built builds it, as Yes;
                // a reply while the plan has questions answers them — straight
                // to the Planner.
                controlRef={askCtl}
                takeReply={(t) => {
                  if (next === "question" || (next === "nothing" && wp.plan))
                    return planActions.onAnswer(t);
                  // The built widget is waiting on a look: a change is a fix
                  // to it, for the Builder — unless the plan is to change.
                  if (planChange) {
                    setPlanChange(false);
                    return false;
                  }
                  if (previewWaiting) {
                    const say = askCtl.current && askCtl.current.say;
                    // "Yes" / "looks good": Looks good.
                    if (isPlainYes(t) || LOOKS_GOOD.test(t)) {
                      if (say) say({ who: "you", text: t, local: true });
                      pb.approve(previewWaiting.id, {});
                      return true;
                    }
                    // "Thanks", "nice": not a change — no rebuild for it.
                    if (PLEASANTRY.test(t)) {
                      if (say) {
                        say({ who: "you", text: t, local: true });
                        say({
                          who: "note",
                          text: "Nothing sent to the Builder. Click Looks good to keep it, or say what to change.",
                        });
                      }
                      return true;
                    }
                    // A widget the user already has: no Builder draft to fix —
                    // a change goes to the Planner.
                    if (!previewBuilt) return false;
                    sendFix(previewWaiting.id, t);
                    return true;
                  }
                  if (
                    !isPlainYes(t) ||
                    // The wizard's yes is its own button: a typed one goes
                    // to the Planner, never lost.
                    reviewHeld.current ||
                    answering ||
                    walking ||
                    starting ||
                    wp.sent ||
                    (wp.build && !removed) ||
                    !canBuild({ plan: wp.plan, check: wp.check })
                  )
                    return false;
                  buildIt();
                  return true;
                }}
                placeholder={
                  planChange
                    ? "Tell the Planner what to change in the plan"
                    : previewWaiting && previewBuilt
                      ? "Tell me what to change — it goes to the Builder as a fix"
                      : "Reply"
                }
                hint={null}
                // While it builds, the reply box says what's going on and Stop
                // stops the build; the chat follows it as it goes.
                working={
                  building
                    ? {
                        text: pb.stopping
                          ? "Stopping after this step…"
                          : workingLine(pb.state),
                        onStop: pb.stop,
                      }
                    : null
                }
                follow={
                  pb.state
                    ? `${pb.state.status}:${(pb.state.steps || []).filter((x) => x.status !== "waiting").length}`
                    : null
                }
              />
            </StepTailContext.Provider>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 py-6">
                <div
                  className="flex flex-col gap-4 max-w-5xl my-auto"
                  data-testid="workspace-start"
                >
                  {ways ? (
                    <div>
                      <Button3 size="sm" title="← Back" onClick={backToWays} />
                    </div>
                  ) : null}
                  <span className={`text-2xl font-semibold ${strong}`}>
                    {start.title}
                  </span>
                  {ways ? goesOn : null}
                  <span className={`text-sm ${muted}`}>{start.text}</span>
                  {seedError ? (
                    <span
                      className={`text-sm ${muted}`}
                      role="status"
                      data-testid="workspace-seed-error"
                    >
                      {seedError}
                    </span>
                  ) : null}
                  {start.starters.length ? (
                    <div className="flex flex-row flex-wrap gap-2">
                      {start.starters.map((s) => (
                        <Button2
                          key={s}
                          size="sm"
                          title={s}
                          onClick={() => ask(s)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {/* What the team can make: its example goes in the box,
                      to change before asking (one place to start, frame 1). */}
                  {start.kinds ? (
                    <div className="flex flex-col gap-2">
                      <div
                        className="flex flex-row flex-wrap gap-3"
                        data-testid="workspace-make-kinds"
                      >
                        {start.kinds.map((k) => (
                          <button
                            key={k.kind}
                            type="button"
                            aria-label={
                              waysFor(k.kind)
                                ? `${k.title}. ${k.hint}`
                                : `${k.title}. ${k.hint}. Example: ${k.example}`
                            }
                            onClick={() => {
                              // A dashboard or a bot: its ways first.
                              if (waysFor(k.kind)) {
                                startMaking(k.kind);
                                return;
                              }
                              setDraft(k.example);
                              if (composer.current) composer.current.focus();
                            }}
                            className={`w-44 flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left ${hairline}`}
                          >
                            <span
                              className={`flex items-center justify-center h-8 w-8 rounded-lg ${fieldBg} dr-role-well ${strong}`}
                              aria-hidden="true"
                            >
                              <FontAwesomeIcon
                                icon={k.icon}
                                className="h-4 w-4"
                              />
                            </span>
                            <span className={`text-sm font-semibold ${strong}`}>
                              {k.title}
                            </span>
                            <span className={`text-xs ${muted}`}>{k.hint}</span>
                            <span className={`text-xs ${link}`}>
                              “{k.example}”
                            </span>
                          </button>
                        ))}
                      </div>
                      <span className={`text-xs ${muted}`}>
                        A dashboard or a bot shows the ways to make it; the
                        others put their example in the box — then change it to
                        what you want.
                      </span>
                    </div>
                  ) : null}
                  {/* Or start from (frame 13, in the middle since one place
                      to start): New Dashboard keeps its own, no widget. */}
                  {startsHere ? (
                    <div
                      className="flex flex-col gap-2 pt-2"
                      data-testid="workspace-start-from"
                    >
                      <span className={`text-xs ${muted}`}>Or start from</span>
                      <div className="flex flex-row flex-wrap gap-3">
                        {START_FROM.map((s) => (
                          <button
                            key={s.kind}
                            type="button"
                            aria-label={`${s.title}. ${s.sub}`}
                            onClick={() => startFrom(s.kind)}
                            className={`w-60 flex flex-row items-start gap-3 rounded-xl border p-3 text-left ${hairline} ${selectedBg}`}
                          >
                            <span
                              className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${fieldBg} dr-role-well ${strong}`}
                              aria-hidden="true"
                            >
                              <FontAwesomeIcon
                                icon={s.icon}
                                className="h-4 w-4"
                              />
                            </span>
                            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <span
                                className={`text-sm font-semibold ${strong}`}
                              >
                                {s.title}
                              </span>
                              <span className={`text-xs ${muted}`}>
                                {s.sub}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {/* Change with AI (release 6c): the Widget Builder, by
                      hand, as Create › Change offered. */}
                  {makingShown && making.widget ? (
                    <div>
                      <Button3
                        size="sm"
                        title="Edit the code yourself"
                        onClick={editByHand}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <ChatComposer
                ref={composer}
                ariaLabel={contact ? `Ask ${contact.name}` : "Ask"}
                value={draft}
                onChange={(v) => setDraft(v)}
                onSend={() => ask()}
                placeholder="Reply"
                hint={null}
                sendLabel="Ask"
                className="flex-shrink-0"
              />
            </>
          )}
        </section>

        {/* Right: outputs and the team, resizable */}
        {narrow || wizardStage === "looks" ? null : (
          <ResizeHandle {...handleProps} ariaLabel="Resize outputs" />
        )}
        <aside
          ref={asideRef}
          aria-label="Outputs"
          // Folded (frame 36): it slides over the conversation; closed, it
          // stays mounted (hidden) so its button keeps count.
          className={
            narrow
              ? outsOpen
                ? `absolute right-0 z-30 flex flex-col min-h-0 border-l shadow-lg ${hairline} ${panel.backgroundColor || ""}`
                : "hidden"
              : wizardStage === "looks"
                ? // Step 4 draws the looks across the window: no strip left
                  // over (mounted, so the Outputs count holds).
                  "hidden"
                : `dr-chat-shell-side flex-shrink-0 flex flex-col min-h-0 border-l ${hairline}`
          }
          style={
            narrow
              ? // Frame 36: 380 wide, under the header, never past the window.
                { width: 380, maxWidth: "100%", top: headerH, bottom: 0 }
              : wizardStage === "looks"
                ? // Step 4 draws the looks across the window (the mockup):
                  // only the window's close stays.
                  {}
                : {
                    // Expanded (frame 37): 760 wide, and never more than half the
                    // screen, so the conversation keeps room.
                    width: wide
                      ? Math.min(
                          WIDE,
                          Math.round(
                            (typeof window !== "undefined"
                              ? window.innerWidth
                              : 1600) * 0.5,
                          ),
                        )
                      : sideWidth,
                  }
          }
        >
          {/* The window's close, in its own row above the column. */}
          <div
            className={`flex-shrink-0 flex flex-row items-center justify-end px-3 py-2 border-b ${hairline}`}
          >
            {/* A plain ×, quiet until it's wanted (frame 1). Folded, it
                closes the outputs; the window's × is in the header. */}
            <button
              type="button"
              aria-label={narrow ? "Close outputs" : "Close"}
              onClick={narrow ? () => setOutsOpen(false) : onClose}
              className={`flex items-center justify-center h-8 w-8 rounded-lg ${muted}`}
            >
              <FontAwesomeIcon icon="xmark" className="h-4 w-4" />
            </button>
          </div>
          {contact && !(wizardStage === "looks" && !narrow) ? (
            <WorkspaceSide
              contact={contact}
              // The plan card's next step (plan → build).
              next={next}
              planActions={planActions}
              reviewInChat={wizardOn || reuseOn}
              reuseInChat={reuseOn}
              sketchHidden={wizardStage === "looks"}
              buildNext={
                wp.build ? (
                  <BuildNext
                    build={wp.build}
                    state={pb.state}
                    actions={buildActions}
                    restored={pb.restored}
                    change={buildChange(wp.build)}
                    cell={buildCell(wp.build)}
                    onStop={pb.stop}
                    stopping={pb.stopping}
                    actionError={pb.actionError || buildError}
                  />
                ) : null
              }
              // A change to one widget (release 6c): in place or new, and
              // signing in to change it in place.
              onWidgetMode={
                convWidget && convWidget.canInPlace ? setModePick : null
              }
              onSignIn={
                convWidget && convWidget.canSignIn && making && making.widget
                  ? signInToChange
                  : null
              }
              messages={messages}
              statusOf={all.statusOf}
              wp={wp}
              planReadOnly={answering}
              onBuild={starting || walking ? null : buildIt}
              build={wp.build}
              // A fix from the preview shows in the chat too.
              pb={pb ? { ...pb, revise: sendFix } : pb}
              dashTeam={dashTeamRoles}
              open={sideOpen}
              onOpen={setSideOpen}
              wide={wide}
              // No Expand in a small window: the column already covers it.
              onToggleWide={narrow ? null : () => setWide((v) => !v)}
              onSummary={setSideSummary}
            />
          ) : null}
        </aside>
      </div>
      {walking ? (
        <BuildWalk
          wp={wp}
          onReady={(checks) => {
            setWalking(false);
            startBuild({ checks });
          }}
          onCancel={() => setWalking(false)}
        />
      ) : null}
      {authGate}
    </Modal>
  );
};

export default LeadWorkspace;
