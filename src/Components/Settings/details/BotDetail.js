import React, { useState, useEffect, useMemo, useContext } from "react";
import {
  Button,
  Button3,
  InputText,
  TextArea,
  SelectInput,
  Checkbox,
  ThemeContext,
} from "@trops/dash-react";
import {
  FREQUENCIES,
  DAYS_OF_WEEK,
  DAYS_OF_MONTH,
  TIME_OPTIONS,
  DEFAULT_SCHEDULE,
  buildCron,
  parseCron,
} from "./cronBuilder";
import {
  buildWidgetEventCatalog,
  widgetSubscription,
  describeSubscription,
  buildBotEventCatalog,
  botSubscription,
} from "./eventCatalog";
import { dashboardOptions, offTeamSubscriptions } from "../../Bots/teamUtils";

// "Run on events" sources: a dashboard widget, or another bot.
const EVENT_FROM_OPTIONS = [
  { value: "widget", label: "A dashboard widget" },
  { value: "bot", label: "Another bot" },
];

/**
 * BotDetail — create/edit form for a Bot Factory bot (Settings → Bots).
 *
 * Built for a non-technical user: Providers (the user's Dash MCP providers —
 * what the bot can use), the AI model, and the schedule are all
 * pick-from-a-list, never free text. "Provider" always means a Dash provider;
 * the LLM choice is labelled "Model source". The raw cron lives behind an "Advanced"
 * toggle for power users. All inputs are @trops/dash-react primitives.
 */

// Friendly, Title-case provider labels for the dropdown.
const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
};
const AI_PROVIDER_TYPES = Object.keys(PROVIDER_LABELS);

function presentProviderTypes(providers) {
  const present = [];
  for (const p of Object.values(providers || {})) {
    if (p && AI_PROVIDER_TYPES.includes(p.type) && !present.includes(p.type)) {
      present.push(p.type);
    }
  }
  return present;
}

function providerOptionsFrom(providers) {
  return [
    ...presentProviderTypes(providers).map((t) => ({
      value: t,
      label: PROVIDER_LABELS[t] || t,
    })),
    // Auth via the logged-in Claude Code CLI — no API key needed. Runs on the
    // Claude Agent engine (native tools).
    { value: "claude-code", label: "Claude Code (CLI) — no API key" },
  ];
}

/**
 * The provider to pre-select for a new bot: the user's configured default AI
 * (its `isDefaultForType`, else the first configured). If none is configured,
 * fall back to the always-available Claude Code (CLI) — it's the only option in
 * that case and needs no API key.
 */
function defaultProviderId(providers) {
  const list = Object.values(providers || {}).filter(
    (p) => p && AI_PROVIDER_TYPES.includes(p.type),
  );
  const def = list.find((p) => p.isDefaultForType) || list[0];
  return def ? def.type : "claude-code";
}

const APPROVAL_OPTIONS = [
  { value: "ask", label: "Ask before external actions" },
  { value: "allow", label: "Allow without prompting" },
];

// "" → derive the engine from the provider (tool-loop). The Claude Agent engine
// gives the bot native file/shell/code tools.
const ENGINE_OPTIONS = [
  { value: "", label: "Standard (default)" },
  { value: "claude-agent", label: "Claude Agent (native tools)" },
];

// Server ids are lower-case; show a friendlier label without changing the value
// the runner resolves against.
const SERVER_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  openai: "OpenAI",
  gmail: "Gmail",
  slack: "Slack",
  notion: "Notion",
  linear: "Linear",
};
function prettyServer(name) {
  if (SERVER_LABELS[name]) return SERVER_LABELS[name];
  return String(name || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// "search_emails" / "list-calendars" → "Search emails" / "List calendars".
function prettyTool(name) {
  const words = String(name || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Stable default so the event-catalog memo doesn't recompute every render.
const EMPTY_LIST = [];

function getMainApi() {
  return typeof window !== "undefined" ? window.mainApi : null;
}

export const BotDetail = ({
  bot = null,
  isCreating = false,
  providers = {},
  // Dashboards + widget-config lookup → the "Run on events" picker.
  workspaces = EMPTY_LIST,
  getWidgetConfig = null,
  // All bots → "Another bot" events (completed / failed / tool.*).
  bots = EMPTY_LIST,
  // A new bot created from a dashboard joins that dashboard's team.
  defaultWorkspaceId = null,
  onSave,
  onCancel,
  onDelete,
  // (dirty: boolean) — unsaved-changes signal for hosts that guard leaving
  // the form (the Bots view's inline Settings tab).
  onDirtyChange = null,
}) => {
  const [name, setName] = useState(bot?.name || "");
  const [instructions, setInstructions] = useState(bot?.instructions || "");
  const [provider, setProvider] = useState(
    bot?.provider || defaultProviderId(providers),
  );
  const [model, setModel] = useState(bot?.model || "");
  const [engine, setEngine] = useState(bot?.engine || "");
  const [approvalPolicy, setApprovalPolicy] = useState(
    bot?.approvalPolicy || "ask",
  );

  // --- Providers: the user's Dash MCP providers (Settings → Providers) ---
  const [selectedServers, setSelectedServers] = useState(bot?.mcpServers || []);
  // Per-provider narrowing within the provider's declared tools:
  // { [providerName]: string[] }. No entry → every tool the provider allows.
  const [toolSelections, setToolSelections] = useState(
    bot?.toolSelections || {},
  );
  const [toolSources, setToolSources] = useState([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  // Remembered approvals ("Always allow") for a saved bot:
  // { [provider]: { tools: string[], folders: string[] } }.
  const [grants, setGrants] = useState({});

  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!bot?.id || !api?.bots?.getGrants) return undefined;
    Promise.resolve(api.bots.getGrants(bot.id))
      .then((g) => {
        if (alive && g && typeof g === "object") setGrants(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot?.id]);

  const isRemembered = (serverName, tool) =>
    !!(grants[serverName] && (grants[serverName].tools || []).includes(tool));

  const revokeRemembered = async (serverName, tool) => {
    const api = getMainApi();
    if (!bot?.id || !api?.bots?.revokeGrant) return;
    try {
      const next = await api.bots.revokeGrant(bot.id, serverName, tool);
      setGrants(next && typeof next === "object" ? next : {});
    } catch (_e) {
      // Leave the badge as-is; the revoke can be retried.
    }
  };

  // --- Model options (fetched per provider) ---
  const [modelOptions, setModelOptions] = useState([]);

  // --- Schedule (friendly dropdowns; raw cron behind Advanced) ---
  const initialCron = bot?.schedules?.[0]?.cron || "";
  const parsed = parseCron(initialCron);
  const [frequency, setFrequency] = useState(
    parsed.frequency === "custom" ? "off" : parsed.frequency,
  );
  const [time, setTime] = useState(parsed.time || DEFAULT_SCHEDULE.time);
  const [dayOfWeek, setDayOfWeek] = useState(
    parsed.dayOfWeek || DEFAULT_SCHEDULE.dayOfWeek,
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    parsed.dayOfMonth || DEFAULT_SCHEDULE.dayOfMonth,
  );
  const [advanced, setAdvanced] = useState(parsed.frequency === "custom");
  const [advancedCron, setAdvancedCron] = useState(initialCron);
  const [schedulePrompt, setSchedulePrompt] = useState(
    bot?.schedules?.[0]?.prompt || "",
  );

  // --- Run-on-events (subscriptions) ---
  // Picked, never typed: Dashboard › Widget › Event from the widgets' declared
  // events. Each saved subscription keeps its runtime eventType plus a
  // structured source (see eventCatalog.js).
  const [subscriptions, setSubscriptions] = useState(
    (bot?.subscriptions || []).filter((s) => s && s.eventType),
  );
  const eventCatalog = useMemo(
    () => buildWidgetEventCatalog(workspaces, getWidgetConfig),
    [workspaces, getWidgetConfig],
  );
  const [pickFrom, setPickFrom] = useState("widget");
  // Team = the dashboard this bot belongs to ("" = Unassigned). A bot on a
  // team only hears its own dashboard's events (bot-teams TEAM-001).
  const [team, setTeam] = useState(() => {
    const id = bot ? bot.workspaceId : defaultWorkspaceId;
    return id === undefined || id === null || id === "" ? "" : String(id);
  });
  const teamOptions = useMemo(
    () => [{ value: "", label: "Unassigned" }, ...dashboardOptions(workspaces)],
    [workspaces],
  );
  const offTeam = offTeamSubscriptions(subscriptions, team);
  // The event picker opens on the bot's own dashboard.
  const [pickWorkspace, setPickWorkspace] = useState(team);
  const [pickWidget, setPickWidget] = useState("");
  const [pickBot, setPickBot] = useState("");
  const [pickEvent, setPickEvent] = useState("");

  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Unsaved changes: the editable fields now vs. when the form opened (or
  // last saved).
  const snapshot = JSON.stringify({
    name,
    instructions,
    provider,
    model,
    engine,
    approvalPolicy,
    selectedServers,
    toolSelections,
    frequency,
    time,
    dayOfWeek,
    dayOfMonth,
    advanced,
    advancedCron,
    schedulePrompt,
    subscriptions,
    team,
  });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  useEffect(() => {
    if (typeof onDirtyChange === "function") onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Discover the user's configured MCP providers — running or not. The bot
  // starts any that aren't running when it runs.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.bots?.listToolSources) {
      setSourcesLoaded(true);
      return undefined;
    }
    Promise.resolve(api.bots.listToolSources(bot?.workspaceId || null))
      .then((sources) => {
        if (alive && Array.isArray(sources)) setToolSources(sources);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setSourcesLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [bot?.workspaceId]);

  // Fetch the model list for the chosen provider.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.llm?.listModels) {
      setModelOptions([]);
      return undefined;
    }
    api.llm
      .listModels(provider || "anthropic")
      .then((res) => {
        if (alive) setModelOptions((res && res.models) || []);
      })
      .catch(() => {
        if (alive) setModelOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  // Configured providers + any the bot already has (so a provider that was
  // since removed still shows, checked, and isn't silently dropped on save).
  const availableServers = [
    ...toolSources.map((s) => ({ ...s, missing: false })),
    ...(selectedServers || [])
      .filter((name) => !toolSources.some((s) => s.name === name))
      .map((name) => ({
        name,
        running: false,
        toolCount: null,
        missing: true,
      })),
  ].map((s) => ({
    serverName: s.name,
    label: prettyServer(s.name),
    // The provider's declared tools (or live tools if undeclared + running);
    // null → every tool, list not known yet.
    tools: Array.isArray(s.tools) ? s.tools : null,
    status: s.missing
      ? "No longer set up under Settings → Providers"
      : s.running
        ? `Running · ${s.toolCount ?? 0} tools`
        : "Starts when the bot runs",
  }));

  const modelSelectOptions = [
    { value: "", label: "Recommended (default)" },
    ...(model && !modelOptions.some((m) => m.value === model)
      ? [{ value: model, label: model }]
      : []),
    ...modelOptions,
  ];

  const toggleServer = (serverName) => {
    setSelectedServers((prev) =>
      prev.includes(serverName)
        ? prev.filter((s) => s !== serverName)
        : [...prev, serverName],
    );
  };

  // Is `tool` allowed for this bot on `serverName`? No stored selection → yes.
  const isToolOn = (serverName, tool) => {
    const sel = toolSelections[serverName];
    return Array.isArray(sel) ? sel.includes(tool) : true;
  };

  // Toggle one tool. Selecting every tool again clears the entry (= all), so
  // a later provider-side addition is picked up automatically.
  const toggleTool = (serverName, allTools, tool) => {
    setToolSelections((prev) => {
      const current = Array.isArray(prev[serverName])
        ? prev[serverName]
        : [...allTools];
      const next = current.includes(tool)
        ? current.filter((t) => t !== tool)
        : allTools.filter((t) => t === tool || current.includes(t));
      const copy = { ...prev };
      if (next.length === allTools.length) delete copy[serverName];
      else copy[serverName] = next;
      return copy;
    });
  };

  const setAllTools = (serverName, on) => {
    setToolSelections((prev) => {
      const copy = { ...prev };
      if (on) delete copy[serverName];
      else copy[serverName] = [];
      return copy;
    });
  };

  // Cascading picker options. A widget's option value is "ref|instanceId".
  const pickedWs = eventCatalog.find((w) => w.workspaceId === pickWorkspace);
  const pickedWidget = pickedWs
    ? pickedWs.widgets.find((w) => `${w.ref}|${w.instanceId}` === pickWidget)
    : null;

  // Other bots' events, derived from their providers + tools (this bot
  // excluded — it can't trigger itself).
  const botCatalog = useMemo(
    () => buildBotEventCatalog(bots, toolSources, bot?.id || null),
    [bots, toolSources, bot?.id],
  );
  const pickedBot = botCatalog.find((b) => b.botId === pickBot) || null;
  const pickedBotEvent = pickedBot
    ? pickedBot.events.find((e) => e.event === pickEvent) || null
    : null;
  const canAddEvent =
    pickFrom === "bot" ? !!pickedBotEvent : !!(pickedWidget && pickEvent);

  const addSubscription = () => {
    if (!canAddEvent) return;
    const sub =
      pickFrom === "bot"
        ? botSubscription(pickedBot, pickedBotEvent)
        : widgetSubscription(pickedWs, pickedWidget, pickEvent);
    setSubscriptions((prev) =>
      prev.some((s) => s.eventType === sub.eventType) ? prev : [...prev, sub],
    );
    setPickEvent("");
  };

  const removeSubscription = (eventType) => {
    setSubscriptions((prev) => prev.filter((s) => s.eventType !== eventType));
  };

  const canSave = name.trim() && instructions.trim() && !saving;

  const handleSave = async () => {
    setError(null);
    const cron = advanced
      ? advancedCron.trim()
      : buildCron({ frequency, time, dayOfWeek, dayOfMonth });
    const schedules = cron ? [{ cron, prompt: schedulePrompt.trim() }] : [];
    const definition = {
      ...(bot?.id ? { id: bot.id } : {}),
      name: name.trim(),
      instructions: instructions.trim(),
      provider: provider || null,
      model: model.trim() || null,
      engine: engine || null,
      approvalPolicy,
      workspaceId: team || null,
      mcpServers: selectedServers,
      // Only keep narrowing for providers the bot still uses.
      toolSelections: Object.fromEntries(
        Object.entries(toolSelections).filter(([server]) =>
          selectedServers.includes(server),
        ),
      ),
      schedules,
      subscriptions,
    };
    setSaving(true);
    try {
      await onSave(definition);
      setBaseline(snapshot);
    } catch (e) {
      setError((e && e.message) || "Failed to save bot");
    } finally {
      setSaving(false);
    }
  };

  const scheduleOn = advanced || frequency !== "off";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Name</span>
          <InputText
            value={name}
            onChange={setName}
            placeholder="e.g. PR Digest"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Instructions</span>
          <TextArea
            value={instructions}
            onChange={setInstructions}
            placeholder="What should this bot do?"
            rows={5}
          />
        </div>

        <div className="flex flex-col gap-2">
          <SelectInput
            label="Team"
            value={team}
            onChange={setTeam}
            options={teamOptions}
          />
          <span className="text-xs opacity-50">
            The dashboard this bot works for. A bot on a team only runs on its
            own dashboard&apos;s events; Unassigned bots hear every dashboard.
          </span>
          {offTeam.length ? (
            <span className="text-xs opacity-70">
              {offTeam.length === 1
                ? "1 event this bot runs on comes"
                : `${offTeam.length} events this bot runs on come`}{" "}
              from another dashboard and won&apos;t fire while it&apos;s on this
              team.
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Providers</span>
          <span className="text-xs opacity-50">
            What this bot can use — your MCP providers from Settings →
            Providers. The bot starts any that aren&apos;t running when it runs.
          </span>
          {availableServers.length ? (
            <div className="flex flex-col gap-1">
              {availableServers.map((s) => {
                const on = selectedServers.includes(s.serverName);
                return (
                  <div key={s.serverName} className="flex flex-col gap-1">
                    <div className="flex flex-row items-center justify-between gap-3">
                      <Checkbox
                        label={s.label}
                        checked={on}
                        onChange={() => toggleServer(s.serverName)}
                      />
                      <span className="text-xs opacity-50">{s.status}</span>
                    </div>
                    {on ? (
                      <div className="flex flex-col gap-1 pl-7 pb-2">
                        {s.tools && s.tools.length ? (
                          <>
                            <div className="flex flex-row items-center gap-2">
                              <span className="text-xs opacity-50">
                                Tools this bot may use (from the provider&apos;s
                                allowed tools):
                              </span>
                              <Button3
                                title="All"
                                size="xs"
                                onClick={() => setAllTools(s.serverName, true)}
                              />
                              <Button3
                                title="None"
                                size="xs"
                                onClick={() => setAllTools(s.serverName, false)}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {s.tools.map((tool) => (
                                <div
                                  key={tool}
                                  className="flex flex-row items-center gap-2"
                                >
                                  <Checkbox
                                    label={prettyTool(tool)}
                                    checked={isToolOn(s.serverName, tool)}
                                    onChange={() =>
                                      toggleTool(s.serverName, s.tools, tool)
                                    }
                                  />
                                  {isRemembered(s.serverName, tool) ? (
                                    <>
                                      <span className="text-xs opacity-60">
                                        Always allowed
                                      </span>
                                      <Button3
                                        title="Revoke"
                                        size="xs"
                                        ariaLabel={`Revoke always-allow for ${prettyTool(tool)}`}
                                        tooltip="Ask again before this tool runs"
                                        onClick={() =>
                                          revokeRemembered(s.serverName, tool)
                                        }
                                      />
                                    </>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            {grants[s.serverName] &&
                            (grants[s.serverName].folders || []).length ? (
                              <span className="text-xs opacity-50">
                                Always-allowed folders:{" "}
                                {grants[s.serverName].folders.join(", ")}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs opacity-50">
                            All tools this provider offers — it has no tool
                            limit set in Settings → Providers.
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : sourcesLoaded ? (
            <span className="text-xs opacity-50">
              You haven&apos;t set up any MCP providers yet. Add one under
              Settings → Providers, then it will appear here.
            </span>
          ) : null}
          <span className="text-xs opacity-50">
            Each tool call follows the approval policy below.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">AI model</span>
          <div className="flex flex-col gap-1">
            <SelectInput
              label="Model source"
              value={provider}
              onChange={setProvider}
              options={providerOptionsFrom(providers)}
            />
            <span className="text-xs opacity-50">
              Which AI powers the bot — an API key from your Anthropic, OpenAI
              or xAI providers, or &quot;Claude Code (CLI)&quot;, which uses
              your Claude login with no API key.
            </span>
          </div>

          <SelectInput
            label="Model"
            value={model}
            onChange={setModel}
            options={modelSelectOptions}
            placeholder="Recommended (default)"
          />

          <SelectInput
            label="Engine"
            value={engine}
            onChange={setEngine}
            options={ENGINE_OPTIONS}
            placeholder="Standard (default)"
          />
        </div>

        <SelectInput
          label="Approval policy"
          value={approvalPolicy}
          onChange={setApprovalPolicy}
          options={APPROVAL_OPTIONS}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Schedule</span>

          {!advanced ? (
            <>
              <SelectInput
                label="Runs"
                value={frequency}
                onChange={setFrequency}
                options={FREQUENCIES}
              />
              {frequency !== "off" && frequency !== "hourly" ? (
                <SelectInput
                  label="Time"
                  value={time}
                  onChange={setTime}
                  options={TIME_OPTIONS}
                />
              ) : null}
              {frequency === "weekly" ? (
                <SelectInput
                  label="Day of week"
                  value={dayOfWeek}
                  onChange={setDayOfWeek}
                  options={DAYS_OF_WEEK}
                />
              ) : null}
              {frequency === "monthly" ? (
                <SelectInput
                  label="Day of month"
                  value={dayOfMonth}
                  onChange={setDayOfMonth}
                  options={DAYS_OF_MONTH}
                />
              ) : null}
            </>
          ) : (
            <InputText
              label="Cron expression"
              value={advancedCron}
              onChange={setAdvancedCron}
              placeholder="Cron, e.g. 0 7 * * 1-5"
            />
          )}

          {scheduleOn ? (
            <InputText
              value={schedulePrompt}
              onChange={setSchedulePrompt}
              placeholder="Task prompt for the scheduled run"
            />
          ) : null}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs opacity-60 hover:opacity-100 self-start"
          >
            {advanced ? "Use simple schedule" : "Advanced (cron)"}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Run on events</span>
          {subscriptions.length ? (
            <div className="flex flex-col gap-1">
              {subscriptions.map((sub) => {
                const { label, missing, kind } = describeSubscription(
                  sub,
                  eventCatalog,
                  botCatalog,
                );
                return (
                  <div
                    key={sub.eventType}
                    className="flex flex-row items-center justify-between gap-2"
                  >
                    <span className="text-sm">
                      {label}
                      {missing ? (
                        <span className="text-xs opacity-60">
                          {" "}
                          ({kind === "bot" ? "bot" : "widget"} missing)
                        </span>
                      ) : null}
                    </span>
                    <Button3
                      title="Remove"
                      size="xs"
                      ariaLabel={`Remove ${label}`}
                      onClick={() => removeSubscription(sub.eventType)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-xs opacity-50">
              This bot doesn&apos;t run on any events yet.
            </span>
          )}
          <SelectInput
            label="From"
            value={pickFrom}
            onChange={(v) => {
              setPickFrom(v);
              setPickEvent("");
            }}
            options={EVENT_FROM_OPTIONS}
          />
          {pickFrom === "bot" ? (
            botCatalog.length ? (
              <div className="flex flex-col gap-2">
                <SelectInput
                  label="Bot"
                  value={pickBot}
                  onChange={(v) => {
                    setPickBot(v);
                    setPickEvent("");
                  }}
                  placeholder="Choose a bot…"
                  options={botCatalog.map((b) => ({
                    value: b.botId,
                    label: b.name,
                  }))}
                />
                <SelectInput
                  label="Event"
                  value={pickEvent}
                  onChange={setPickEvent}
                  placeholder="Choose an event…"
                  options={(pickedBot ? pickedBot.events : []).map((e) => ({
                    value: e.event,
                    label: e.label,
                  }))}
                />
                <Button
                  title="Add event"
                  onClick={addSubscription}
                  size="sm"
                  disabled={!canAddEvent}
                />
              </div>
            ) : (
              <span className="text-xs opacity-50">
                No other bots yet. Create another bot to trigger this one when
                it finishes or uses a tool.
              </span>
            )
          ) : eventCatalog.length ? (
            <div className="flex flex-col gap-2">
              <SelectInput
                label="Dashboard"
                value={pickWorkspace}
                onChange={(v) => {
                  setPickWorkspace(v);
                  setPickWidget("");
                  setPickEvent("");
                }}
                placeholder="Choose a dashboard…"
                options={eventCatalog.map((w) => ({
                  value: w.workspaceId,
                  label: w.name,
                }))}
              />
              <SelectInput
                label="Widget"
                value={pickWidget}
                onChange={(v) => {
                  setPickWidget(v);
                  setPickEvent("");
                }}
                placeholder="Choose a widget…"
                options={(pickedWs ? pickedWs.widgets : []).map((w) => ({
                  value: `${w.ref}|${w.instanceId}`,
                  label: w.label,
                }))}
              />
              <SelectInput
                label="Event"
                value={pickEvent}
                onChange={setPickEvent}
                placeholder="Choose an event…"
                options={(pickedWidget ? pickedWidget.events : []).map(
                  (ev) => ({ value: ev, label: ev }),
                )}
              />
              <Button
                title="Add event"
                onClick={addSubscription}
                size="sm"
                disabled={!pickedWidget || !pickEvent}
              />
            </div>
          ) : (
            <span className="text-xs opacity-50">
              No widgets on your dashboards publish events yet. Add a widget
              that publishes events to a dashboard to trigger this bot from it.
            </span>
          )}
          <span className="text-xs opacity-50">
            The bot runs automatically when one of these events fires.
          </span>
        </div>

        {error ? <span className="text-sm text-red-400">{error}</span> : null}
      </div>

      <div
        className={`flex-shrink-0 flex flex-row justify-between gap-2 px-6 py-4 border-t ${hairline}`}
      >
        <div>
          {!isCreating && onDelete ? (
            <Button title="Delete" onClick={onDelete} size="sm" />
          ) : null}
        </div>
        <div className="flex flex-row gap-2">
          {isCreating && onCancel ? (
            <Button title="Cancel" onClick={onCancel} size="sm" />
          ) : null}
          <Button
            title={isCreating ? "Create" : "Save"}
            onClick={handleSave}
            size="sm"
            disabled={!canSave}
          />
        </div>
      </div>
    </div>
  );
};
