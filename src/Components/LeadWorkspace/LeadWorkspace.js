import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button2,
  Button3,
  ChatComposer,
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
} from "./workspaceStart";
import { useDashboard } from "./useDashboard";
import { useWidgetTarget } from "./useWidgetTarget";
import { useRegistryAuthGate } from "../../hooks/useRegistryAuthGate";
import { useWorkspacePlan } from "./useWorkspacePlan";
import { PlanCard, PlanChoices } from "./PlanViews";
import { BuildInChat, BuildWalk, PastBuild } from "./BuildViews";
import { usePlanBuild } from "./usePlanBuild";
import {
  choicesIndex,
  seedConversation,
  stillAnswering,
  withPlanContext,
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
import { normalizeType } from "../Create/planChecklist";
import { dirtyDashboardId } from "../Create/CreatePlanStep";
import { planTarget } from "../../utils/teamPlan";

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
  if (contact.kind === "dashlead") {
    return {
      title: "What should we make?",
      text: "Describe it in your own words — a dashboard, a widget, a bot, or a change to one you have. The team plans it with you, and nothing is made until you say yes.",
      starters: [
        "A dashboard for my smart home",
        "A widget that shows my calendar",
        "A bot that sums up my email each morning",
        "Change one of my dashboards",
      ],
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
 *   in the workspace's place (release 3b)
 */
export const LeadWorkspace = ({
  request = null,
  onClose,
  onOpenPage = null,
  onOpenDashboard = null,
}) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const composer = useRef(null);
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
  const making = useMemo(
    () =>
      makingStart(request && request.making) ||
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
    [request, cellReq, widgetReq, found, cellDashboardName, contactName],
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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(EMPTY);
  // What's open on the right: "plan", a step's id, or the overview (null).
  const [sideOpen, setSideOpen] = useState(null);
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
  };
  const switchTo = (next) => {
    setSwitchOpen(false);
    setNavOpen(false);
    if (next === key) return;
    moveOn();
    setKey(next);
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
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
  // Start from › A dashboard from the registry (frame 42): the picked one,
  // as a plan the Dash Lead sets up with you. Its row says when it
  // couldn't be opened.
  const pickRegistryDashboard = (dashboard, config) =>
    startSeeded(registrySeed(dashboard, config)).then((ok) =>
      ok
        ? null
        : {
            error: `${dashboard.name} didn't come over. Pick it again, or describe what you want in the box.`,
          },
    );
  const startNew = () => {
    moveOn();
    setNavOpen(false);
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
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
  const buildIt = () => {
    if (!wp.plan || walking || starting || (wp.build && !removed)) return;
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
    if (!resumeKey || resumed.current === resumeKey) return;
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
    open: setSideOpen,
  };
  // The lead is still answering: the plan isn't changed meanwhile.
  const answering = stillAnswering(messages);

  // Start from (frame 13). Describing it is the box; the registry's
  // dashboards open on the right (frame 42); copying a dashboard and editing
  // a widget are on their pages.
  const startFrom = (kind) => {
    if (kind === "describe") {
      if (composer.current) composer.current.focus();
      return;
    }
    if (kind === "registry") {
      setSideOpen("registry");
      return;
    }
    const page = kind === "copy" ? "dashboards" : "widgets";
    if (onOpenPage) onOpenPage(page);
    else onClose();
  };

  // After a message: the plan's card under the step that brought it, and
  // the reply choices under the lead's answer to it.
  const choicesAt = choicesIndex(messages);
  const leadName = contact ? contact.name : "Dash Lead";
  const renderAfter = (m, i, api) => {
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
                yes={yesLabel(wp.plan)}
                actions={buildActions}
                change={
                  b.kind === "edit" || b.kind === "settings"
                    ? {
                        displayName: convWidget ? convWidget.displayName : "",
                        mode: convWidget ? convWidget.mode : null,
                        dashboardName: convWidget
                          ? convWidget.dashboardName
                          : "",
                        onDashboard: !!(convWidget && convWidget.onDashboard),
                        settingLabels: convWidget
                          ? convWidget.settingLabels
                          : null,
                        placed: placements[b.buildId],
                        canPlace: canSwap,
                      }
                    : null
                }
                cell={
                  b.kind === "cell"
                    ? {
                        dashboardName: convCell ? convCell.dashboardName : "",
                        placed: placements[b.buildId],
                        canPlace,
                      }
                    : null
                }
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
    if (m.who === "step" && wp.step && m.id === wp.step.id && wp.plan) {
      return <PlanCard plan={wp.plan} onOpen={() => setSideOpen("plan")} />;
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
    if (i === choicesAt && wp.plan && !wp.build && !api.busy) {
      return (
        <>
          <PlanChoices
            plan={wp.plan}
            check={wp.check}
            sent={wp.sent}
            onSend={api.send}
            onBuild={starting || walking ? null : buildIt}
            onChange={api.focusReply}
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
      );
    }
    return null;
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
        className={`relative flex flex-row h-full w-full rounded-xl overflow-hidden border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
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
              : `relative w-64 flex-shrink-0 flex flex-col gap-1 border-r p-3 min-h-0 ${hairline}`
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
            className={`flex flex-row items-center gap-3 rounded-lg border p-2 text-left ${hairline} ${selectedBg}`}
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
              <span className={`text-xs truncate ${muted}`}>
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
                        ariaLabel={c.name}
                        // One line: a long dashboard name never strands "· 0 bots".
                        meta={<span className="block truncate">{c.sub}</span>}
                        selected={current}
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
                        t.built
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
                        setSelectedId(t.id);
                        setMessages(EMPTY);
                        setSideOpen(null);
                        setMakingOn(false);
                        moveOn();
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
          className="flex-1 min-w-0 flex flex-col min-h-0"
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
            <div className="flex-shrink-0 flex flex-row px-6 pt-4">
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
          ) : open && contact ? (
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
              renderAfter={renderAfter}
              // A typed reply takes the plan (and the changes made to it on
              // the right) along, so a change reaches the Planner whole.
              prepareSend={(t) => withPlanContext(t, wp.plan, wp.takeEdits())}
              placeholder="Reply"
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
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center px-6">
                <div
                  className="flex flex-col gap-4 max-w-xl"
                  data-testid="workspace-start"
                >
                  <span className={`text-2xl font-semibold ${strong}`}>
                    {start.title}
                  </span>
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
        {narrow ? null : (
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
              : `flex-shrink-0 flex flex-col min-h-0 border-l ${hairline}`
          }
          style={
            narrow
              ? // Frame 36: 380 wide, under the header, never past the window.
                { width: 380, maxWidth: "100%", top: headerH, bottom: 0 }
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
          {contact ? (
            <WorkspaceSide
              contact={contact}
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
              pb={pb}
              dashTeam={dashTeamRoles}
              open={sideOpen}
              onOpen={setSideOpen}
              wide={wide}
              // No Expand in a small window: the column already covers it.
              onToggleWide={narrow ? null : () => setWide((v) => !v)}
              onSummary={setSideSummary}
              // A page's New already says what's made: no Start from.
              isNew={!open && !isBot && !makingShown}
              onStartFrom={startFrom}
              onUseRegistry={pickRegistryDashboard}
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
