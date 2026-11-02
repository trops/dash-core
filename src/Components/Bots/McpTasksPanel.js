import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Button3,
  SegmentedControl,
  StatusBadge,
  Switch,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { approvalText } from "../AppPages/botSummary";
import { RunDetails } from "./BotRunHistory";
import { toPlainText } from "./botConversation";
import {
  approvalForTasks,
  leadTimeline,
  routeRow,
  taskSettingLine,
  taskTimesText,
} from "./mcpTaskText";

/**
 * Tasks via MCP on a team lead's page (bot-teams TEAM-016, round 2).
 *
 * McpTaskSettings — the lead's Settings tab: "Takes tasks via MCP" (off by
 * default) and "Ask for a passphrase first" (off by default). They're the
 * team's settings, so they apply right away, apart from the bot form's Save.
 *
 * LeadActivity — the lead's Activity: one list, newest first, of every run
 * and every task via MCP (tagged), with All / via MCP / Asked / Scheduled.
 * A row opens in place: the task (times, an approval to Allow / Deny, a bot
 * that didn't run) and the run's details.
 *
 * McpRoutingLog — the Dash Lead: the tasks it routed (no team named).
 */

const EMPTY = [];

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** Reload on every task change (the main process broadcasts it). */
function useTaskChanges(load) {
  useEffect(() => {
    const bots = botsApi();
    load();
    if (!bots || !bots.onMcpTasksChanged) return undefined;
    const id = bots.onMcpTasksChanged(load);
    return () => {
      if (id !== null && id !== undefined && bots.removeListener) {
        bots.removeListener(id);
      }
    };
  }, [load]);
}

/**
 * The value now, for a reply to check it's still wanted: a reply for a
 * lead or team the view has moved on from is dropped.
 */
function useCurrent(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** The team's two task settings, kept current: { takes, asks }. */
function useTaskSettings(workspaceId) {
  const current = useCurrent(workspaceId);
  const [settings, setSettings] = useState({ takes: false, asks: false });
  useEffect(() => {
    setSettings({ takes: false, asks: false });
  }, [workspaceId]);
  const load = useCallback(() => {
    const api = botsApi();
    if (!api || !api.getTeamSettings) return;
    if (workspaceId === null || workspaceId === undefined) return;
    Promise.resolve(api.getTeamSettings(workspaceId))
      .then((s) =>
        current.current !== workspaceId
          ? null
          : setSettings({
              takes: !!(s && s.takesMcpTasks),
              asks: !!(s && s.asksTaskPassphrase),
            }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  useTaskChanges(load);
  return [settings, setSettings];
}

const SectionLabel = ({ children, muted }) => (
  <h4 className={`text-xs font-semibold uppercase tracking-wider ${muted}`}>
    {children}
  </h4>
);

const SettingRow = ({
  title,
  help,
  checked,
  onChange,
  hairline,
  muted,
  top,
}) => (
  <div
    className={`flex flex-row items-center gap-4 px-4 py-3 ${
      top ? "" : `border-t ${hairline}`
    }`}
  >
    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
      <span className="text-sm font-semibold">{title}</span>
      <span className={`text-xs ${muted}`}>{help}</span>
    </span>
    <Switch checked={checked} onChange={onChange} ariaLabel={title} />
  </div>
);

export const McpTaskSettings = ({ workspaceId, onOpenMcpSettings = null }) => {
  const { muted, hairline } = useConfigTokens();
  const [settings, setSettings] = useTaskSettings(workspaceId);
  const [passphraseSet, setPassphraseSet] = useState(true);
  const [error, setError] = useState(null);

  const loadPhrase = useCallback(() => {
    const api = botsApi();
    if (!api || !api.getTaskPassphraseState) return;
    Promise.resolve(api.getTaskPassphraseState())
      .then((s) => setPassphraseSet(!s || !!s.set))
      .catch(() => {});
  }, []);
  useTaskChanges(loadPhrase);

  const change = (key, call) => async (next) => {
    const api = botsApi();
    if (!api || !api[call]) return;
    setError(null);
    setSettings((s) => ({ ...s, [key]: next }));
    try {
      await api[call](workspaceId, next);
    } catch (err) {
      setSettings((s) => ({ ...s, [key]: !next }));
      setError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  return (
    <section
      aria-label="Tasks via MCP"
      className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
      data-testid="mcp-task-settings"
    >
      <SettingRow
        top
        title="Takes tasks via MCP"
        help={
          settings.takes
            ? "Apps and agents connected to Dash's MCP server can give this team tasks. Its bots still ask you before they change anything."
            : "Off: apps and agents connected to Dash's MCP server can't see this team or give it tasks."
        }
        checked={settings.takes}
        onChange={change("takes", "setTakesMcpTasks")}
        hairline={hairline}
        muted={muted}
      />
      {settings.takes ? (
        <SettingRow
          title="Ask for a passphrase first"
          help={
            settings.asks
              ? "A task waits until the app gives your passphrase from Settings › MCP Server — for tasks a person gives by voice."
              : "Off: a task starts as soon as an app gives it."
          }
          checked={settings.asks}
          onChange={change("asks", "setAsksTaskPassphrase")}
          hairline={hairline}
          muted={muted}
        />
      ) : null}
      {settings.takes && settings.asks && !passphraseSet ? (
        <div
          role="alert"
          className={`flex flex-row flex-wrap items-center gap-3 px-4 py-3 border-t text-sm ${hairline}`}
          data-testid="mcp-task-no-passphrase"
        >
          <span className="flex-1 min-w-0">
            No passphrase is set yet, so this team&apos;s tasks can&apos;t
            start.
          </span>
          {onOpenMcpSettings ? (
            <Button3
              title="Set it in Settings › MCP Server"
              size="sm"
              onClick={onOpenMcpSettings}
            />
          ) : null}
        </div>
      ) : null}
      {error ? (
        <span className={`px-4 py-2 border-t text-xs ${hairline}`}>
          {error}
        </span>
      ) : null}
      <span className={`px-4 py-2 border-t text-xs ${hairline} ${muted}`}>
        These apply right away — no Save needed.
      </span>
    </section>
  );
};

/** An opened task's own part: times, an approval, a bot that didn't run. */
const TaskPart = ({ task, approval, muted, onApprove, hasRun }) => {
  const times = taskTimesText(task);
  return (
    <div className="flex flex-col gap-3" data-testid="mcp-task-detail">
      {times ? <span className={`text-xs ${muted}`}>{times}</span> : null}
      {/* With a run, its details below show what was asked. */}
      {hasRun ? null : (
        <div className="flex flex-col gap-1">
          <span className={`text-xs ${muted}`}>The task</span>
          <span className="whitespace-pre-wrap">{task.task}</span>
        </div>
      )}
      {approval ? (
        <div className="flex flex-row flex-wrap items-center gap-3">
          <span className="flex-1 min-w-0">{approval.text}</span>
          {onApprove ? (
            <span className="flex flex-row gap-2">
              <Button
                title="Allow"
                size="sm"
                onClick={() => onApprove(approval.id, true)}
              />
              <Button3
                title="Deny"
                size="sm"
                onClick={() => onApprove(approval.id, false)}
              />
            </span>
          ) : null}
        </div>
      ) : null}
      {task.needsYou ? <span>{task.needsYou}</span> : null}
      {/* With a run, its details below hold the answer. */}
      {!hasRun && task.summary ? (
        <div className="flex flex-col gap-1">
          <span className={`text-xs ${muted}`}>What the team said</span>
          <span className="whitespace-pre-wrap leading-relaxed">
            {toPlainText(task.summary)}
          </span>
        </div>
      ) : null}
      {!hasRun && task.error ? <span>{task.error}</span> : null}
    </div>
  );
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "mcp", label: "via MCP" },
  { value: "asked", label: "Asked" },
  { value: "scheduled", label: "Scheduled" },
];

const EMPTY_TEXT = {
  all: null,
  mcp: "No tasks via MCP.",
  asked: "Nothing asked yet.",
  scheduled: "No scheduled runs.",
};

export const LeadActivity = ({
  lead,
  bots = EMPTY,
  approvals = EMPTY,
  nameOf = undefined,
  onApprove = null,
  onOpenTaskSettings = null,
  onOpenSettings = null,
  onChangeModel = null,
}) => {
  const { muted, hairline, selectedBg } = useConfigTokens();
  const workspaceId = lead ? lead.workspaceId : null;
  const [settings] = useTaskSettings(workspaceId);
  const [runs, setRuns] = useState(null);
  const [tasks, setTasks] = useState(EMPTY);
  const [filter, setFilter] = useState("all");
  const [openKey, setOpenKey] = useState(null);
  const leadId = lead ? lead.id : null;
  const currentLead = useCurrent(leadId);

  // Another lead: none of the last one's rows while this one's load.
  useEffect(() => {
    setRuns(null);
    setTasks(EMPTY);
    setOpenKey(null);
    setFilter("all");
  }, [leadId]);

  const loadRuns = useCallback(() => {
    const api = botsApi();
    if (!api || !api.getRuns || !leadId) return;
    Promise.resolve(api.getRuns(leadId, 50))
      .then((l) => {
        if (currentLead.current !== leadId) return;
        setRuns(Array.isArray(l) ? [...l].reverse() : []);
      })
      .catch(() => {
        if (currentLead.current === leadId) setRuns((prev) => prev || []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);
  const loadTasks = useCallback(() => {
    const api = botsApi();
    if (!api || !api.listMcpTasks) return;
    if (workspaceId === null || workspaceId === undefined) return;
    Promise.resolve(api.listMcpTasks(workspaceId, 50))
      .then((l) => {
        if (currentLead.current !== leadId) return;
        setTasks(Array.isArray(l) ? l : EMPTY);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, leadId]);
  useTaskChanges(loadTasks);

  // Runs: now, and again when one of the lead's runs ends (a run is kept
  // once it ends; until then its task shows as Running).
  useEffect(() => {
    loadRuns();
    const api = botsApi();
    if (!api) return undefined;
    const ids = [];
    if (api.onStream) {
      ids.push(
        api.onStream(({ botId, event } = {}) => {
          const t = event && event.type;
          if (botId !== leadId) return;
          if (t === "done" || t === "error" || t === "skipped") loadRuns();
        }),
      );
    }
    if (api.onRunActive) ids.push(api.onRunActive(loadRuns));
    return () => {
      if (!api.removeListener) return;
      for (const id of ids) api.removeListener(id);
    };
  }, [leadId, loadRuns]);

  // The newest started task shows what a bot on this team waits for.
  const approval = useMemo(() => {
    const team = new Set(
      bots
        .filter((b) => b && String(b.workspaceId) === String(workspaceId))
        .map((b) => b.id),
    );
    const name = (id) => (bots.find((b) => b.id === id) || {}).name || "";
    return approvalForTasks(tasks, approvals, team, (a) => {
      const text = approvalText(a);
      const who = name(a.request.botId);
      return who
        ? `${who} ${text.charAt(0).toLowerCase()}${text.slice(1)}`
        : text;
    });
  }, [tasks, approvals, bots, workspaceId]);

  if (!lead || runs === null) return null;
  const rows = leadTimeline(runs, tasks, { filter, approval, nameOf });
  const anything = runs.length || tasks.length;

  return (
    <section
      aria-label="Activity"
      className="flex flex-col gap-3 pt-1 pb-4"
      data-testid="lead-activity"
    >
      <div className={`flex flex-row items-center gap-3 text-sm ${muted}`}>
        <span className="flex-1 min-w-0" data-testid="lead-task-setting">
          {taskSettingLine(settings)}
        </span>
        {onOpenTaskSettings ? (
          <Button3
            title="Change in Settings"
            size="sm"
            onClick={onOpenTaskSettings}
          />
        ) : null}
      </div>
      {anything ? (
        <div className="flex flex-row flex-wrap items-center gap-3">
          <span className="flex-1">
            <SectionLabel muted={muted}>Activity</SectionLabel>
          </span>
          <SegmentedControl
            ariaLabel="Show"
            size="sm"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setOpenKey(null);
            }}
            options={FILTERS}
          />
        </div>
      ) : null}
      {!anything ? (
        <p className={`text-sm ${muted}`}>{`${lead.name} hasn't run yet.`}</p>
      ) : rows.length ? (
        <ul
          className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
          data-testid="lead-activity-list"
        >
          {rows.map((row, i) => {
            const open = openKey === row.key;
            const toggle = () => setOpenKey(open ? null : row.key);
            const mine =
              row.task && approval && approval.taskId === row.task.id
                ? approval
                : null;
            return (
              <li
                key={row.key}
                className={`flex flex-col ${i ? `border-t ${hairline}` : ""} ${
                  open ? selectedBg : ""
                }`}
                data-testid="lead-activity-row"
              >
                <div className="flex flex-row items-start gap-3 px-4 py-3">
                  {/* A row that opens in place: dash-react has no such
                      row (ListRow keeps its trailing badge for hover), so
                      it's a plain button styled by theme tokens, like
                      BotRunHistory's rows. */}
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className="flex-1 min-w-0 flex flex-col gap-1 text-left"
                  >
                    <span className="flex flex-row items-center gap-2 min-w-0">
                      {row.mcp ? (
                        <StatusBadge state="info" label={row.source} />
                      ) : (
                        <span className={`text-xs ${muted}`}>{row.source}</span>
                      )}
                      <span className={`text-xs ${muted}`}>
                        {row.at
                          ? new Date(row.at).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </span>
                    <span className="text-sm font-semibold truncate">
                      {row.title}
                    </span>
                    {open ? null : (
                      <span className={`text-sm truncate ${muted}`}>
                        {row.line}
                      </span>
                    )}
                  </button>
                  <span className="flex-shrink-0">
                    <StatusBadge state={row.state} label={row.tag} />
                  </span>
                  {row.open && !open ? (
                    <Button3 title="Open" size="sm" onClick={toggle} />
                  ) : null}
                </div>
                {open ? (
                  <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
                    {row.task ? (
                      <TaskPart
                        task={row.task}
                        approval={mine}
                        muted={muted}
                        onApprove={onApprove}
                        hasRun={!!row.run}
                      />
                    ) : null}
                    {row.run ? (
                      <RunDetails
                        run={row.run}
                        bot={lead}
                        isLead
                        nameOf={nameOf}
                        onOpenSettings={onOpenSettings}
                        onChangeModel={onChangeModel}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`text-sm ${muted}`} data-testid="lead-activity-empty">
          {EMPTY_TEXT[filter]}
        </p>
      )}
    </section>
  );
};

export const McpRoutingLog = () => {
  const { muted, hairline } = useConfigTokens();
  const [routes, setRoutes] = useState(EMPTY);
  const load = useCallback(() => {
    const api = botsApi();
    if (!api || !api.listMcpRoutes) return;
    Promise.resolve(api.listMcpRoutes(20))
      .then((l) => setRoutes(Array.isArray(l) ? l : EMPTY))
      .catch(() => {});
  }, []);
  useTaskChanges(load);

  // Nothing routed yet: the Dash Lead's Activity is as before.
  if (!routes.length) return null;
  return (
    <section
      aria-label="Routed via MCP"
      className="flex flex-col gap-3 pt-1 pb-4"
      data-testid="mcp-routing-log"
    >
      <SectionLabel muted={muted}>Routed via MCP</SectionLabel>
      <ul
        className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
      >
        {routes.map((r, i) => {
          const row = routeRow(r);
          return (
            <li
              key={r.id}
              className={`flex flex-row items-start gap-3 px-4 py-3 ${
                i ? `border-t ${hairline}` : ""
              }`}
              data-testid="mcp-route-row"
            >
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-sm font-semibold">{row.title}</span>
                <span className={`text-xs ${muted}`}>{row.meta}</span>
                <span className="text-sm">{row.summary}</span>
              </span>
              <span className="flex-shrink-0">
                <StatusBadge state={row.state} label={row.tag} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
