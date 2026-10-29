import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  ConfirmationModal,
  ResizeHandle,
  SegmentedControl,
  SelectInput,
  ThemeContext,
  useResizableWidth,
} from "@trops/dash-react";
import { BotAvatar } from "./BotAvatar";
import { TeamChart } from "./TeamChart";
import { BotFlowSummary } from "./BotFlowSummary";
import { BotPage } from "./BotPage";
import { BotDetail } from "../Settings/details/BotDetail";
import { TeamImportReview } from "./TeamImportReview";
import { PublishBotDialog } from "./PublishBotDialog";
import { TeamBudgetDialog } from "./TeamBudgetDialog";
import { RegistryBrowse } from "./RegistryBrowse";
import { useRegistryAuthGate } from "../../hooks/useRegistryAuthGate";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { STATUS_DOT, triggerSummary } from "./teamUtils";
import {
  addTrigger,
  eventChoices,
  removeTrigger,
  updateTrigger,
} from "./teamDiagram";

/**
 * BotsView — a dashboard's team, full stage (bot-teams PRD TEAM-011).
 *
 * Left: the team (lead pinned, then members, status dots, + Add bot).
 * Right: the selected bot's page (BotPage, app-navigation NAV-016 AC6 — the
 * same page as Manage › Bots) with this team's actions under ⋯; a new bot
 * gets the bot form to save it first. A lead asked to make something hands
 * it to the Dash team (its answer's button opens Create, Phase 2c-2). Leaving unsaved
 * Settings edits asks first. Narrow windows swap the team list for a bot
 * picker.
 *
 * @param {object} workspace   the dashboard
 * @param {object[]} workspaces all dashboards (bot form's Team field)
 * @param {object} team        useTeamBots(workspace.id)
 * @param {boolean} [narrow]   force the narrow layout (else measured)
 * @param {(dirty: boolean) => void} [onDirtyChange]  unsaved Settings edits
 *   (the stage guards leaving the Bots view with them)
 * @param {(section: string) => void} [onOpenSettings]  error next steps
 * @param {{ botId: string, tab?: string, seq: number }} [focus]  open on a
 *   bot + tab (the Bot monitor's "Open in Bots view"); a new `seq` re-applies
 *   it, through the unsaved-changes guard.
 */
const NEW_BOT = "__new__";
const NARROW_PX = 900;
const DOT = STATUS_DOT;

const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

function useNarrow(ref, forced) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof forced === "boolean") return undefined;
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, forced]);
  return typeof forced === "boolean" ? forced : narrow;
}

/** The view's content width (px), or 0 until measured. */
function useContentWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// The bot panel beside the diagram (TEAM-014): the user drags its edge.
// Starts at half; the diagram keeps DIAGRAM_MIN, the panel PANEL_MIN.
const PANEL_WIDTH_KEY = "dash:botsView:panelWidth";
const PANEL_GAP = 16; // gap-4 between the diagram and the panel
const PANEL_MIN = 360;
const DIAGRAM_MIN = 320;

// A bot's page has no conversation (lead-workspace release 6b): the lead
// is asked in the lead workspace.
const TABS = ["activity", "log", "spending", "settings"];

// Diagram / List (TEAM-014), remembered per viewer. Storage can be blocked.
const MODE_KEY = "dash:botsView:mode";
const readMode = () => {
  try {
    return window.localStorage.getItem(MODE_KEY) === "list"
      ? "list"
      : "diagram";
  } catch (_e) {
    return "diagram";
  }
};
const writeMode = (mode) => {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch (_e) {
    // Not remembered — fine.
  }
};

export const BotsView = ({
  workspace,
  workspaces = [],
  team,
  narrow,
  focus = null,
  onDirtyChange = null,
  onOpenSettings = null,
}) => {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const selectedBg = currentTheme["bg-neutral-very-dark"] || "bg-gray-800";
  const selectedBorder =
    currentTheme["border-primary-dark"] || "border-gray-600";
  const strong = currentTheme["text-neutral-light"] || "text-gray-200";

  const rootRef = useRef(null);
  const isNarrow = useNarrow(rootRef, narrow);
  const contentWidth = useContentWidth(rootRef);
  const panelRoom = Math.max(0, contentWidth - PANEL_GAP);
  const { width: panelWidth, handleProps: panelHandle } = useResizableWidth({
    defaultWidth: Math.round(panelRoom / 2),
    min: PANEL_MIN,
    max: panelRoom - DIAGRAM_MIN,
    edge: "left",
    storageKey: PANEL_WIDTH_KEY,
  });

  const lead = team ? team.lead : null;
  const members = team ? team.members : [];
  const all = [lead, ...members].filter(Boolean);

  const focusTarget =
    focus && all.some((b) => b.id === focus.botId) ? focus : null;
  const [selectedId, setSelectedId] = useState(
    () =>
      (focusTarget && focusTarget.botId) ||
      (lead && lead.id) ||
      (members[0] && members[0].id) ||
      null,
  );
  const [tab, setTab] = useState(() =>
    focusTarget && TABS.includes(focusTarget.tab)
      ? focusTarget.tab
      : "activity",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  // Team diagram (TEAM-014): the view, and whether the selected bot's
  // Conversation / Activity / Settings is open beside the diagram (else its
  // summary is). A focus request (Open in Bots view) opens it.
  const [mode, setModeState] = useState(readMode);
  const [detailOpen, setDetailOpen] = useState(() => !!focusTarget);
  const setMode = (next) => {
    setModeState(next);
    writeMode(next);
  };
  // Team export/import (TEAM-006/007, slice 1): the review being shown, and
  // the last outcome ({ text, details?: string[] }).
  const [importPreview, setImportPreview] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [importError, setImportError] = useState(null);
  const [teamNote, setTeamNote] = useState(null);
  // Registry install (TEAM-007 slice 3b): the search panel is open.
  const [registryOpen, setRegistryOpen] = useState(false);
  // Registry publish (TEAM-006 slice 3a): what's being published and how
  // it went.
  const { ensureAuthed, authGate } = useRegistryAuthGate();
  const [publishTarget, setPublishTarget] = useState(null);
  const [publishPreview, setPublishPreview] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [allBots, setAllBots] = useState([]);
  const nameOf = useMemo(() => {
    const names = new Map(allBots.map((b) => [b.id, b.name]));
    return (id) => names.get(id) || id;
  }, [allBots]);
  const dirtyRef = useRef(false);
  // Unsaved Settings edits: kept in a ref for the guard, and reported to the
  // host (the stage guards the header's Dashboard switch with it).
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  const setDirty = useCallback((d) => {
    if (dirtyRef.current === d) return;
    dirtyRef.current = d;
    if (onDirtyRef.current) onDirtyRef.current(d);
  }, []);
  // Bumped by "Discard changes" to remount the form from the saved bot.
  const [formKey, setFormKey] = useState(0);
  // Bumped when the view picks a bot or tab (a click, Open in Bots view), so
  // the bot page reopens on it.
  const [pageSeq, setPageSeq] = useState(0);
  const reopenPage = () => setPageSeq((n) => n + 1);
  const [pendingNav, setPendingNav] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // All bots (any dashboard) — the form's "Another bot" event source and
  // names for trigger chains. Reloaded when bots change anywhere.
  useEffect(() => {
    const bots = api();
    if (!bots || !bots.list) return undefined;
    const load = () =>
      Promise.resolve(bots.list())
        .then((l) => setAllBots(Array.isArray(l) ? l : []))
        .catch(() => {});
    load();
    const id = bots.onListChanged ? bots.onListChanged(load) : null;
    return () => {
      if (id !== null && bots.removeListener) bots.removeListener(id);
    };
  }, []);

  // Providers' types and tools (TEAM-014): which tool events a bot can
  // trigger others on, in the diagram's trigger popover.
  const [toolSources, setToolSources] = useState([]);
  const workspaceId = workspace ? workspace.id : null;
  useEffect(() => {
    const bots = api();
    if (!bots || !bots.listToolSources) return undefined;
    let alive = true;
    Promise.resolve(bots.listToolSources(workspaceId))
      .then((l) => alive && setToolSources(Array.isArray(l) ? l : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  // Fall back to the lead when the selection disappears (deleted elsewhere).
  useEffect(() => {
    if (selectedId === NEW_BOT) return;
    if (!all.some((b) => b.id === selectedId)) {
      setSelectedId((lead && lead.id) || (members[0] && members[0].id) || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team && team.bots]);

  const selected =
    selectedId === NEW_BOT
      ? null
      : all.find((b) => b.id === selectedId) || null;
  const isLead = !!(selected && selected.role === "lead");

  // Navigation that would drop unsaved Settings edits asks first.
  const guarded = useCallback((nav) => {
    if (dirtyRef.current) setPendingNav(() => nav);
    else nav();
  }, []);

  const select = (id) =>
    guarded(() => {
      setDirty(false);
      setSelectedId(id);
      setTab(id === NEW_BOT ? "settings" : "activity");
      reopenPage();
      setMenuOpen(false);
      setImportPreview(null);
      setRegistryOpen(false);
      // A new bot has no summary — its form opens (diagram).
      if (id === NEW_BOT) setDetailOpen(true);
    });

  // Diagram: open a bot's tab beside the diagram / back to its summary.
  const openBot = (id, nextTab) => {
    // "Ask the lead": its conversation, in the lead workspace (release 6b).
    const asked = all.find((b) => b.id === id);
    if (nextTab === "conversation" && asked && asked.role === "lead") {
      guarded(() =>
        window.dispatchEvent(
          new CustomEvent("dash:open-workspace", {
            detail: { key: `lead:${id}` },
          }),
        ),
      );
      return;
    }
    guarded(() => {
      setDirty(false);
      setSelectedId(id);
      setTab(TABS.includes(nextTab) ? nextTab : "activity");
      reopenPage();
      setMenuOpen(false);
      setImportPreview(null);
      setRegistryOpen(false);
      setDetailOpen(true);
    });
  };
  const closeDetail = () =>
    guarded(() => {
      setDirty(false);
      setDetailOpen(false);
      // A new bot has no summary — back to the lead (or first bot).
      if (selectedId === NEW_BOT) {
        setSelectedId(
          (lead && lead.id) || (members[0] && members[0].id) || null,
        );
        setTab("activity");
      }
    });

  // A new focus request (seq) from the Bot monitor re-selects its bot.
  // Only a request that found its bot at mount counts as applied; otherwise
  // it applies once the team loads.
  const appliedSeq = useRef(focusTarget ? focus.seq : null);
  useEffect(() => {
    if (!focus || focus.seq === appliedSeq.current) return;
    if (!all.some((b) => b.id === focus.botId)) return;
    appliedSeq.current = focus.seq;
    guarded(() => {
      setDirty(false);
      setSelectedId(focus.botId);
      setTab(TABS.includes(focus.tab) ? focus.tab : "activity");
      reopenPage();
      setMenuOpen(false);
      setDetailOpen(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.seq, focus && focus.botId, team && team.bots]);

  const afterChange = () => team && team.refresh && team.refresh();

  // The summary's Run now: runs it and opens its page on Activity, where the
  // run shows (failed or skipped too).
  const runNow = () => {
    const bots = api();
    if (!bots || !selected) return;
    const id = selected.id;
    openBot(id, "activity");
    Promise.resolve(bots.run(id, "", false)).catch(() => {});
  };

  // Diagram wiring (TEAM-014 slice 2): a trigger is a subscription on the
  // target bot, saved with the bot like the Settings picker does.
  const findBot = (id) => all.find((b) => b.id === id) || null;
  const saveTrigger = async ({
    mode,
    sourceId,
    targetId,
    oldEventType,
    event,
    label,
    note,
  }) => {
    const bots = api();
    const source = findBot(sourceId);
    const target = await latestBot(targetId);
    if (!bots || !source || !target) throw new Error("bot not found");
    const next =
      mode === "edit"
        ? updateTrigger(target, oldEventType, source, event, label, note)
        : addTrigger(target, source, event, label, note);
    // Only the triggers change — the rest of the bot stays as saved.
    await bots.save({ id: target.id, subscriptions: next.subscriptions });
    afterChange();
  };
  const removeTriggerFrom = async ({ targetId, eventType }) => {
    const bots = api();
    const target = await latestBot(targetId);
    if (!bots || !target) throw new Error("bot not found");
    await bots.save({
      id: target.id,
      subscriptions: removeTrigger(target, eventType).subscriptions,
    });
    afterChange();
  };
  // The bot as saved right now (the view's copy can be behind a save made
  // elsewhere); falls back to the view's copy.
  const latestBot = async (id) => {
    const bots = api();
    if (bots && bots.get) {
      const fresh = await Promise.resolve(bots.get(id)).catch(() => null);
      if (fresh) return fresh;
    }
    return findBot(id);
  };

  const status = selected && team ? team.statusOf(selected.id) : "Idle";

  // Place a bot widget on this dashboard (TEAM-012) and say how it went.
  const showOnDashboard = async (kind, bot = null) => {
    const bots = api();
    if (!bots || !bots.addBotWidget || !workspace) return;
    setMenuOpen(false);
    const r =
      (await bots.addBotWidget(
        workspace.id,
        kind === "results" ? { kind, botId: bot.id } : { kind },
      )) || {};
    setTeamNote({
      text: r.error
        ? r.error
        : kind === "results"
          ? `Added ${bot.name}'s results to the dashboard.`
          : "Added Bot activity to the dashboard.",
    });
  };

  const saveBot = async (definition, opts = {}) => {
    const bots = api();
    const saved = await bots.save(definition);
    if (opts.showOnDashboard && saved && saved.id) {
      await showOnDashboard("results", saved);
    }
    setDirty(false);
    afterChange();
    if (selectedId === NEW_BOT && saved && saved.id) {
      setSelectedId(saved.id);
      setTab("activity");
    }
    return saved;
  };

  const removeFromTeam = async () => {
    const bots = api();
    if (!bots || !selected) return;
    await bots.save({ ...selected, workspaceId: null });
    setMenuOpen(false);
    afterChange();
  };

  const deleteBot = async () => {
    const bots = api();
    if (!bots || !selected) return;
    await bots.delete(selected.id);
    setConfirmDelete(false);
    setMenuOpen(false);
    afterChange();
  };

  // ─── Team export/import (TEAM-006/007, slice 1) ───────────────────

  const exportTeam = async () => {
    const bots = api();
    if (!bots || !bots.exportTeam || !workspace) return;
    const r =
      (await bots.exportTeam(workspace.id, { name: workspace.name })) || {};
    if (r.saved) {
      const file = String(r.filePath || "")
        .split(/[\\/]/)
        .pop();
      setTeamNote({
        text: `Saved ${file} (${r.members} bot${r.members === 1 ? "" : "s"}).`,
        details: r.notIncluded || [],
      });
    } else if (r.error) {
      setTeamNote({ text: r.error });
    }
  };

  const importTeam = () =>
    guarded(async () => {
      const bots = api();
      if (!bots || !bots.previewTeamImport || !workspace) return;
      const r = (await bots.previewTeamImport(workspace.id)) || {};
      if (r.canceled) return;
      if (r.error) {
        setTeamNote({
          text: [r.error, ...(r.errors || [])].join(" "),
        });
        return;
      }
      setDirty(false);
      setTeamNote(null);
      setImportError(null);
      setImportPreview(r);
    });

  const openRegistry = () =>
    guarded(() => {
      setDirty(false);
      setTeamNote(null);
      setImportPreview(null);
      setRegistryOpen(true);
    });

  // A registry package was picked: download, verify and check it in the
  // main process, then review it like an imported file.
  const pickRegistryPackage = async (ref) => {
    const bots = api();
    if (!bots || !bots.previewRegistryInstall || !workspace) return;
    let r = (await bots.previewRegistryInstall(workspace.id, ref)) || {};
    if (r.authRequired) {
      const signedIn = await ensureAuthed({
        message: "Sign in to the Dash registry to install.",
      });
      if (!signedIn) return;
      r = (await bots.previewRegistryInstall(workspace.id, ref)) || {};
    }
    if (r.error) {
      setTeamNote({ text: [r.error, ...(r.errors || [])].join(" ") });
      return;
    }
    setTeamNote(null);
    setImportError(null);
    setRegistryOpen(false);
    setImportPreview(r);
  };

  const installTeam = async (choices, roles = null) => {
    const bots = api();
    if (!bots || !importPreview || !workspace) return;
    setInstalling(true);
    try {
      // A registry package installs from the main process's checked copy.
      const r =
        (importPreview.previewId
          ? await bots.installFromRegistry(
              workspace.id,
              importPreview.previewId,
              choices,
              roles,
            )
          : await bots.installTeam(
              workspace.id,
              importPreview.manifest,
              choices,
              roles,
            )) || {};
      if (r.error) {
        setImportError([r.error, ...(r.errors || [])].join(" "));
        return;
      }
      const n = (r.installed || []).length;
      setTeamNote({
        text: `Added ${n} paused bot${n === 1 ? "" : "s"} from ${importPreview.manifest.name}. Turn ${n === 1 ? "it" : "them"} on when you're ready.`,
      });
      setImportPreview(null);
      afterChange();
    } finally {
      setInstalling(false);
    }
  };

  const openPublish = async (kind) => {
    const bots = api();
    if (!bots || !bots.previewPublish || !workspace) return;
    setMenuOpen(false);
    const signedIn = await ensureAuthed({
      message: "Sign in to the Dash registry to publish.",
    });
    if (!signedIn) return;
    const target = {
      kind,
      workspaceId: workspace.id,
      ...(kind === "bot" && selected ? { botId: selected.id } : {}),
      name: workspace.name,
    };
    const preview = (await bots.previewPublish(target)) || {};
    if (preview.error) {
      setTeamNote({ text: preview.error });
      return;
    }
    setPublishTarget(target);
    setPublishResult(null);
    setPublishError(null);
    setPublishPreview(preview);
  };

  const doPublish = async (meta) => {
    const bots = api();
    if (!bots || !publishTarget) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const r = (await bots.publish({ ...publishTarget, meta })) || {};
      if (r.success) {
        setPublishResult(r);
        afterChange();
      } else {
        setPublishError(r.error || "Publish failed.");
      }
    } finally {
      setPublishing(false);
    }
  };

  // Team budget (bot-factory US-019 AC2).
  const [teamBudgetOpen, setTeamBudgetOpen] = useState(false);

  const closePublish = () => {
    setPublishPreview(null);
    setPublishTarget(null);
    setPublishResult(null);
    setPublishError(null);
  };

  const teamActions = (
    <div className="flex flex-col gap-1">
      <div className="flex flex-row flex-wrap gap-2">
        {workspace ? (
          <Button3
            title="Team budget…"
            size="sm"
            onClick={() => setTeamBudgetOpen(true)}
          />
        ) : null}
        <Button3 title="Export team" size="sm" onClick={exportTeam} />
        <Button3 title="Import team" size="sm" onClick={importTeam} />
        <Button3 title="Find in registry" size="sm" onClick={openRegistry} />
        <Button3
          title="Show team activity"
          size="sm"
          onClick={() => showOnDashboard("activity")}
        />
        <Button3
          title="Publish team…"
          size="sm"
          onClick={() => openPublish("team")}
        />
      </div>
      {teamNote ? (
        <div className={`text-xs flex flex-col gap-0.5 ${muted}`}>
          <span>{teamNote.text}</span>
          {teamNote.details && teamNote.details.length ? (
            <>
              <span>Not included:</span>
              {teamNote.details.map((d, i) => (
                <span key={i}>{`· ${d}`}</span>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const turnOffLead = async () => {
    const bots = api();
    if (!bots || !workspace) return;
    await bots.setLeadEnabled(workspace.id, false, workspace.name);
    setMenuOpen(false);
    afterChange();
  };

  const turnOnLead = async () => {
    const bots = api();
    if (!bots || !workspace) return;
    await bots.setLeadEnabled(workspace.id, true, workspace.name);
    afterChange();
  };

  const row = (b) => {
    const s = team ? team.statusOf(b.id) : "Idle";
    const dot = DOT[s] || DOT.Idle;
    const active = b.id === selectedId;
    return (
      <button
        key={b.id}
        type="button"
        onClick={() => select(b.id)}
        aria-current={active ? "true" : undefined}
        className={`w-full text-left rounded-lg px-3 py-2 flex flex-row items-center gap-3 border ${
          active ? `${selectedBg} ${selectedBorder}` : "border-transparent"
        }`}
      >
        <BotAvatar bot={b} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-row items-center gap-2 text-sm font-medium">
            <span className="truncate">{b.name}</span>
            {b.role === "lead" ? (
              <span
                className={`text-xs uppercase tracking-wider font-semibold ${muted}`}
              >
                Lead
              </span>
            ) : null}
          </div>
          <div className={`text-xs truncate ${muted}`}>
            {b.role === "lead"
              ? "Answers questions about this team"
              : triggerSummary(b)}
          </div>
        </div>
        <span
          role="img"
          aria-label={s}
          title={s}
          className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`}
        />
      </button>
    );
  };

  const teamLabel = (
    <h3 className={`text-sm font-semibold ${strong}`}>
      Team{" "}
      <span className={`font-normal ${muted}`}>
        · {all.length} bot{all.length === 1 ? "" : "s"}
      </span>
    </h3>
  );
  const viewSwitch = (
    <SegmentedControl
      ariaLabel="Team view"
      size="sm"
      value={mode}
      onChange={(v) => setMode(v === "list" ? "list" : "diagram")}
      options={[
        { value: "diagram", label: "Diagram" },
        { value: "list", label: "List" },
      ]}
    />
  );

  const teamList = (
    <nav
      aria-label="Team"
      className={`w-72 flex-shrink-0 dr-card flex flex-col gap-1 rounded-xl border p-2 ${hairline}`}
    >
      <div className="flex flex-row items-center justify-between gap-2 px-2 pt-1 pb-2">
        {teamLabel}
        {viewSwitch}
      </div>
      {lead ? (
        row(lead)
      ) : (
        <div
          className={`flex flex-row items-center justify-between px-3 py-2 text-xs ${muted}`}
        >
          <span>Team lead is off</span>
          <Button3 title="Turn on" size="sm" onClick={turnOnLead} />
        </div>
      )}
      <div className={`border-t my-1 ${hairline}`} />
      {members.map(row)}
      {!members.length ? (
        <div className={`px-3 py-2 text-xs ${muted}`}>
          No bots on this dashboard yet.
        </div>
      ) : null}
      <div className="flex-1" />
      {teamActions}
      <Button title="Add bot" size="sm" onClick={() => select(NEW_BOT)} />
    </nav>
  );

  // Diagram mode (TEAM-014): the team as an org chart; team actions
  // and + Add bot stay reachable underneath.
  const teamDiagram = (
    <section
      aria-label="Team"
      className={`dr-card flex-1 min-w-0 min-h-0 flex flex-col rounded-xl border ${hairline}`}
    >
      <div
        className={`flex flex-row items-center justify-between gap-3 px-4 py-3 border-b ${hairline}`}
      >
        {teamLabel}
        <div className="flex flex-row items-center gap-2">
          {viewSwitch}
          <Button
            title="Add bot"
            size="sm"
            onClick={() => openBot(NEW_BOT, "settings")}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {lead ? null : (
          <div
            className={`flex flex-row items-center gap-3 px-3 py-2 text-xs ${muted}`}
          >
            <span>Team lead is off</span>
            <Button3 title="Turn on" size="sm" onClick={turnOnLead} />
          </div>
        )}
        <TeamChart
          lead={lead}
          members={members}
          selectedId={selectedId}
          statusOf={(id) => (team ? team.statusOf(id) : "Idle")}
          approvalsFor={(id) => (team ? team.approvalsFor(id) : [])}
          // A click opens the bot's page; × goes back to its summary.
          onSelect={(id) => openBot(id, "activity")}
          onOpen={openBot}
          // Off while a bot's Settings is open: saving from the diagram
          // would overwrite that form's unsaved edits.
          canWire={!(detailOpen && tab === "settings")}
          choicesFor={(id) => eventChoices(findBot(id), toolSources)}
          onSaveTrigger={saveTrigger}
          onRemoveTrigger={removeTriggerFrom}
        />
      </div>
      <div className={`px-4 py-3 border-t ${hairline}`}>{teamActions}</div>
    </section>
  );
  const diagramMode = mode === "diagram";
  // The diagram with the summary / bot detail beside it (wide windows only;
  // narrow windows keep the bot picker).
  const sideBySide = diagramMode && !isNarrow;
  // Its width is the user's once the view has been measured and has room
  // for both minimums.
  const resizable = sideBySide && panelRoom >= PANEL_MIN + DIAGRAM_MIN;

  const picker = (
    <div className="flex flex-row items-end gap-2">
      <div className="flex-1">
        <SelectInput
          label="Bot"
          value={selectedId || ""}
          onChange={(v) => select(v)}
          options={[
            ...all.map((b) => ({ value: b.id, label: b.name })),
            { value: NEW_BOT, label: "+ Add bot" },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`flex flex-1 min-h-0 gap-4 p-4 ${strong} ${isNarrow ? "flex-col" : "flex-row"}`}
    >
      {isNarrow ? (
        <div className="flex flex-col gap-2">
          {picker}
          {teamActions}
        </div>
      ) : diagramMode ? (
        teamDiagram
      ) : (
        teamList
      )}

      {registryOpen && !importPreview ? (
        <RegistryBrowse
          onPick={pickRegistryPackage}
          onClose={() => setRegistryOpen(false)}
        />
      ) : importPreview ? (
        <TeamImportReview
          key={importPreview.previewId || importPreview.fileName || "import"}
          preview={importPreview}
          installing={installing}
          error={importError}
          onInstall={installTeam}
          onCancel={() => {
            setImportPreview(null);
            setImportError(null);
          }}
        />
      ) : sideBySide && !detailOpen && selected ? (
        <aside
          aria-label="Selected bot"
          className={`w-80 flex-shrink-0 min-h-0 overflow-y-auto rounded-xl border ${hairline}`}
        >
          <BotFlowSummary
            bot={selected}
            team={all}
            nameOf={(id) => {
              const n = nameOf(id);
              return n === id ? null : n;
            }}
            status={status}
            onOpen={(t) => openBot(selected.id, t)}
            onRunNow={runNow}
          />
        </aside>
      ) : (
        <>
          {resizable ? (
            // Sits in the gap: the negative margins keep the gap 16px.
            <div className="flex flex-row" style={{ margin: "0 -12px" }}>
              <ResizeHandle {...panelHandle} ariaLabel="Resize bot panel" />
            </div>
          ) : null}
          <section
            aria-label="Selected bot"
            className={`${
              resizable
                ? "flex-shrink-0"
                : sideBySide
                  ? "w-1/2 flex-shrink-0"
                  : "flex-1"
            } min-w-0 min-h-0 flex flex-col rounded-xl border ${hairline}`}
            style={resizable ? { width: panelWidth } : undefined}
          >
            {selected ? (
              // The same bot page as Manage › Bots (NAV-016 AC6), plus this
              // team's actions under ⋯.
              <BotPage
                key={`${selected.id}-${pageSeq}`}
                botId={selected.id}
                initialTab={tab}
                workspaces={workspaces}
                onChanged={afterChange}
                onDeleted={afterChange}
                onDirtyChange={setDirty}
                onTabChange={setTab}
                onOpenSettings={onOpenSettings}
                onClose={sideBySide ? closeDetail : null}
                actions={
                  <Button3
                    title="⋯"
                    size="sm"
                    ariaLabel="More actions"
                    onClick={() => setMenuOpen((v) => !v)}
                  />
                }
                below={
                  menuOpen ? (
                    <div className="flex flex-row flex-wrap justify-end gap-2 px-5 pt-2">
                      {isLead ? (
                        <Button3
                          title="Turn off lead"
                          size="sm"
                          onClick={turnOffLead}
                        />
                      ) : (
                        <>
                          <Button3
                            title="Show on dashboard"
                            size="sm"
                            onClick={() => showOnDashboard("results", selected)}
                          />
                          <Button3
                            title="Publish bot…"
                            size="sm"
                            onClick={() => openPublish("bot")}
                          />
                          <Button3
                            title="Remove from team"
                            size="sm"
                            onClick={removeFromTeam}
                          />
                          <Button3
                            title="Delete"
                            size="sm"
                            onClick={() => setConfirmDelete(true)}
                          />
                        </>
                      )}
                    </div>
                  ) : null
                }
              />
            ) : selectedId && selectedId !== NEW_BOT ? (
              // Just created: shown once the team has it (not the empty form).
              <p
                className={`p-5 text-sm ${muted}`}
                data-testid="bots-view-loading"
              >
                Loading…
              </p>
            ) : (
              // A new bot: the form, to save it first.
              <>
                <div className="flex flex-row items-start justify-between gap-4 px-5 pt-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">New bot</h2>
                    <div className={`text-sm ${muted}`}>
                      {`Joins the ${workspace ? workspace.name : "dashboard"} team`}
                    </div>
                  </div>
                  {sideBySide ? (
                    <ButtonIcon
                      icon="xmark"
                      size="sm"
                      ariaLabel="Close"
                      onClick={closeDetail}
                    />
                  ) : null}
                </div>
                <div
                  role="tablist"
                  className={`flex flex-row gap-6 px-5 mt-3 border-b ${hairline}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected="true"
                    className="py-2.5 text-sm font-medium -mb-px border-b-2 border-indigo-400"
                  >
                    New bot
                  </button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <BotDetail
                    key={`${selectedId || NEW_BOT}-${formKey}`}
                    bot={null}
                    isCreating
                    defaultWorkspaceId={workspace ? workspace.id : null}
                    providers={providers}
                    workspaces={workspaces}
                    getWidgetConfig={getWidgetConfig}
                    bots={allBots}
                    onSave={saveBot}
                    canShowOnDashboard={!!workspace}
                    onDirtyChange={setDirty}
                    onDiscard={() => {
                      setDirty(false);
                      setFormKey((k) => k + 1);
                    }}
                  />
                </div>
              </>
            )}
          </section>
        </>
      )}

      <ConfirmationModal
        isOpen={!!pendingNav}
        setIsOpen={(open) => !open && setPendingNav(null)}
        title="Discard unsaved changes?"
        message="Your changes to this bot's settings haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          const nav = pendingNav;
          setPendingNav(null);
          setDirty(false);
          if (nav) nav();
        }}
        onCancel={() => setPendingNav(null)}
      />
      <ConfirmationModal
        isOpen={confirmDelete}
        setIsOpen={setConfirmDelete}
        title={`Delete ${selected ? selected.name : "bot"}?`}
        message="This removes the bot, its run history and its remembered approvals."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={deleteBot}
        onCancel={() => setConfirmDelete(false)}
      />
      <TeamBudgetDialog
        open={teamBudgetOpen}
        workspace={workspace}
        onClose={() => setTeamBudgetOpen(false)}
      />
      <PublishBotDialog
        open={!!publishPreview}
        preview={publishPreview}
        publishing={publishing}
        result={publishResult}
        error={publishError}
        onPublish={doPublish}
        onClose={closePublish}
      />
      {/* Last, so the sign-in prompt stacks above the publish dialog. */}
      {authGate}
    </div>
  );
};
