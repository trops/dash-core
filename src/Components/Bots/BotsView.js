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
  Button2,
  Button3,
  ConfirmationModal,
  SectionLabel,
  SelectInput,
  ThemeContext,
} from "@trops/dash-react";
import { BotChat } from "./BotChat";
import { BotRunHistory } from "./BotRunHistory";
import { BotDetail } from "../Settings/details/BotDetail";
import { DraftBanner } from "./DraftBanner";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { STATUS_DOT, triggerSummary } from "./teamUtils";

/**
 * BotsView — a dashboard's team, full stage (bot-teams PRD TEAM-011).
 *
 * Left: the team (lead pinned, then members, status dots, + Add bot).
 * Right: the selected bot — header with Run now / Pause / ⋯, and tabs
 * Conversation (Ask the lead) / Activity / Settings. Settings is the bot form
 * inline; leaving it with unsaved changes asks first. Narrow windows swap the
 * team list for a bot picker.
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
// A lead's drafted bot (TEAM-005) is selected as "draft:<id>".
const DRAFT_PREFIX = "draft:";
const isDraftId = (id) => typeof id === "string" && id.startsWith(DRAFT_PREFIX);
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

const TABS = ["conversation", "activity", "settings"];

export const BotsView = ({
  workspace,
  workspaces = [],
  team,
  narrow,
  focus = null,
  onDirtyChange = null,
  onOpenSettings = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
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

  const lead = team ? team.lead : null;
  const members = team ? team.members : [];
  const all = [lead, ...members].filter(Boolean);
  const drafts = (team && team.drafts) || [];

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
      : "conversation",
  );
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Fall back to the lead when the selection disappears (deleted elsewhere).
  useEffect(() => {
    if (selectedId === NEW_BOT) return;
    // A draft saved or discarded elsewhere → back to the lead.
    if (isDraftId(selectedId)) {
      if (!drafts.some((d) => DRAFT_PREFIX + d.id === selectedId)) {
        setSelectedId(
          (lead && lead.id) || (members[0] && members[0].id) || null,
        );
        setTab("conversation");
      }
      return;
    }
    if (!all.some((b) => b.id === selectedId)) {
      setSelectedId((lead && lead.id) || (members[0] && members[0].id) || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team && team.bots, team && team.drafts]);

  const selectedDraft = isDraftId(selectedId)
    ? drafts.find((d) => DRAFT_PREFIX + d.id === selectedId) || null
    : null;
  const selected =
    selectedId === NEW_BOT || isDraftId(selectedId)
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
      setTab(id === NEW_BOT || isDraftId(id) ? "settings" : "conversation");
      setMenuOpen(false);
    });

  const switchTab = (next) =>
    guarded(() => {
      setDirty(false);
      setTab(next);
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
      setTab(TABS.includes(focus.tab) ? focus.tab : "conversation");
      setMenuOpen(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.seq, focus && focus.botId, team && team.bots]);

  const afterChange = () => team && team.refresh && team.refresh();

  const runNow = () => {
    const bots = api();
    if (bots && selected) bots.run(selected.id, "", false);
  };

  const status = selected && team ? team.statusOf(selected.id) : "Idle";
  const statusDot = DOT[status] || DOT.Idle;

  const togglePause = async () => {
    const bots = api();
    if (!bots || !selected) return;
    if (status === "Paused") await bots.resumeBot(selected.id);
    else await bots.pauseBot(selected.id);
    afterChange();
  };

  const saveBot = async (definition) => {
    const bots = api();
    const saved = await bots.save(definition);
    setDirty(false);
    afterChange();
    // Saving a lead's draft makes it a real bot — the draft goes away.
    if (selectedDraft && team && team.dismissDraft) {
      await team.dismissDraft(selectedDraft.id);
    }
    if (
      (selectedId === NEW_BOT || isDraftId(selectedId)) &&
      saved &&
      saved.id
    ) {
      setSelectedId(saved.id);
      setTab("conversation");
    }
    return saved;
  };

  const discardDraft = async () => {
    if (!selectedDraft || !team || !team.dismissDraft) return;
    await team.dismissDraft(selectedDraft.id);
    setDirty(false);
    setSelectedId((lead && lead.id) || (members[0] && members[0].id) || null);
    setTab("conversation");
  };

  const draftRow = (d) => {
    const id = DRAFT_PREFIX + d.id;
    const active = id === selectedId;
    return (
      <button
        key={id}
        type="button"
        onClick={() => select(id)}
        aria-current={active ? "true" : undefined}
        className={`w-full text-left rounded-lg px-3 py-2 flex flex-col border ${
          active ? `${selectedBg} ${selectedBorder}` : "border-transparent"
        }`}
      >
        <span className="text-sm font-medium truncate">
          {d.definition && d.definition.name}
        </span>
        <span className={`text-xs ${muted}`}>
          Drafted by the lead · not created yet
        </span>
      </button>
    );
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

  const teamList = (
    <nav
      aria-label="Team"
      className={`w-72 flex-shrink-0 flex flex-col gap-1 rounded-xl border p-2 ${hairline}`}
    >
      <div className="px-2 pt-1 pb-2">
        <SectionLabel
          text={`Team · ${all.length} bot${all.length === 1 ? "" : "s"}`}
        />
      </div>
      {lead ? (
        row(lead)
      ) : (
        <div
          className={`flex flex-row items-center justify-between px-3 py-2 text-xs ${muted}`}
        >
          <span>Team lead is off</span>
          <Button3 title="Turn on" size="xs" onClick={turnOnLead} />
        </div>
      )}
      <div className={`border-t my-1 ${hairline}`} />
      {members.map(row)}
      {!members.length ? (
        <div className={`px-3 py-2 text-xs ${muted}`}>
          No bots on this dashboard yet.
        </div>
      ) : null}
      {drafts.length ? (
        <>
          <div className="px-2 pt-3 pb-1">
            <SectionLabel text="Drafts" />
          </div>
          {drafts.map(draftRow)}
        </>
      ) : null}
      <div className="flex-1" />
      <Button title="+ Add bot" size="sm" onClick={() => select(NEW_BOT)} />
    </nav>
  );

  const picker = (
    <div className="flex flex-row items-end gap-2">
      <div className="flex-1">
        <SelectInput
          label="Bot"
          value={selectedId || ""}
          onChange={(v) => select(v)}
          options={[
            ...all.map((b) => ({ value: b.id, label: b.name })),
            ...drafts.map((d) => ({
              value: DRAFT_PREFIX + d.id,
              label: `${d.definition && d.definition.name} (draft)`,
            })),
            { value: NEW_BOT, label: "+ Add bot" },
          ]}
        />
      </div>
    </div>
  );

  const tabs = selected
    ? [
        ["conversation", isLead ? "Ask the lead" : "Conversation"],
        ["activity", "Activity"],
        ["settings", "Settings"],
      ]
    : selectedDraft
      ? [["settings", "Review draft"]]
      : [["settings", "New bot"]];

  return (
    <div
      ref={rootRef}
      className={`flex flex-1 min-h-0 gap-4 p-4 ${strong} ${isNarrow ? "flex-col" : "flex-row"}`}
    >
      {isNarrow ? picker : teamList}

      <section
        aria-label="Selected bot"
        className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-xl border ${hairline}`}
      >
        <div className="flex flex-row items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            <div className="flex flex-row items-center gap-2">
              <h2 className="text-lg font-semibold truncate">
                {selected
                  ? selected.name
                  : selectedDraft
                    ? selectedDraft.definition.name
                    : "New bot"}
              </h2>
              {selected ? (
                <span
                  className={`flex flex-row items-center gap-1.5 text-xs ${muted}`}
                >
                  <span className={`h-2 w-2 rounded-full ${statusDot}`} />
                  {status}
                </span>
              ) : null}
            </div>
            <div className={`text-sm ${muted}`}>
              {selected
                ? isLead
                  ? "Answers questions about this team · costs nothing until asked"
                  : [
                      (selected.mcpServers || []).join(", "),
                      triggerSummary(selected),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                : `Joins the ${workspace ? workspace.name : "dashboard"} team`}
            </div>
          </div>
          {selected ? (
            <div className="flex flex-row items-center gap-2 flex-shrink-0">
              {!isLead ? (
                <Button2 title="Run now" size="sm" onClick={runNow} />
              ) : null}
              {!isLead ? (
                <Button3
                  title={status === "Paused" ? "Resume" : "Pause"}
                  size="sm"
                  onClick={togglePause}
                />
              ) : null}
              <Button3
                title="⋯"
                size="sm"
                ariaLabel="More actions"
                onClick={() => setMenuOpen((v) => !v)}
              />
            </div>
          ) : null}
        </div>
        {menuOpen && selected ? (
          <div className="flex flex-row justify-end gap-2 px-5 pt-2">
            {isLead ? (
              <Button3 title="Turn off lead" size="xs" onClick={turnOffLead} />
            ) : (
              <>
                <Button3
                  title="Remove from team"
                  size="xs"
                  onClick={removeFromTeam}
                />
                <Button3
                  title="Delete"
                  size="xs"
                  onClick={() => setConfirmDelete(true)}
                />
              </>
            )}
          </div>
        ) : null}

        <div
          role="tablist"
          className={`flex flex-row gap-6 px-5 mt-3 border-b ${hairline}`}
        >
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => switchTab(id)}
              className={`py-2.5 text-sm font-medium -mb-px border-b-2 ${
                tab === id ? "border-indigo-400" : `border-transparent ${muted}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {tab === "conversation" && selected ? (
            <BotChat
              bot={selected}
              isLead={isLead}
              approvals={team ? team.approvalsFor(selected.id) : []}
              onApprove={team ? team.approve : null}
              nameOf={nameOf}
              onOpenSettings={onOpenSettings}
              onChangeModel={() => switchTab("settings")}
              drafts={isLead ? drafts : undefined}
              onOpenDraft={isLead ? (id) => select(DRAFT_PREFIX + id) : null}
            />
          ) : null}
          {tab === "activity" && selected ? (
            <BotRunHistory
              bot={selected}
              isLead={isLead}
              nameOf={nameOf}
              onOpenSettings={onOpenSettings}
              onChangeModel={() => switchTab("settings")}
            />
          ) : null}
          {tab === "settings" ? (
            <div className="flex-1 min-h-0 flex flex-col">
              {selectedDraft ? (
                <DraftBanner
                  draft={selectedDraft}
                  onDiscard={discardDraft}
                  onOpenSettings={onOpenSettings}
                />
              ) : null}
              <BotDetail
                key={`${selected ? selected.id : selectedId || NEW_BOT}-${formKey}`}
                bot={
                  selected ||
                  (selectedDraft && selectedDraft.definition) ||
                  null
                }
                isCreating={!selected}
                suggestions={selectedDraft ? selectedDraft.suggestions : null}
                defaultWorkspaceId={workspace ? workspace.id : null}
                providers={providers}
                workspaces={workspaces}
                getWidgetConfig={getWidgetConfig}
                bots={allBots}
                onSave={saveBot}
                onDirtyChange={setDirty}
                onDiscard={() => {
                  setDirty(false);
                  setFormKey((k) => k + 1);
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

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
    </div>
  );
};
