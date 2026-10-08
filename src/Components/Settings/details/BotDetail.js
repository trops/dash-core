import React, { useState, useEffect, useMemo, useContext, useRef } from "react";
import { keepLatest } from "./botFormMerge";
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
  describeSubscription,
  buildBotEventCatalog,
  buildTriggerOptions,
} from "./eventCatalog";
import { dashboardOptions, offTeamSubscriptions } from "../../Bots/teamUtils";
import { DraftGaps } from "../../Bots/DraftGaps";

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

// Model source of a saved bot with no AI model of its own (provider: null):
// it runs on the AI provider marked default, else its runs fail.
const USE_DEFAULT_PROVIDER = "default";

/** The AI provider type marked default, else null — never a first-found pick. */
function markedDefaultProviderType(providers) {
  const def = Object.values(providers || {}).find(
    (p) => p && AI_PROVIDER_TYPES.includes(p.type) && p.isDefaultForType,
  );
  return def ? def.type : null;
}

function useDefaultOption(providers) {
  const type = markedDefaultProviderType(providers);
  return {
    value: USE_DEFAULT_PROVIDER,
    label: type
      ? `Default AI provider (${PROVIDER_LABELS[type] || type})`
      : "Default AI provider — none set",
  };
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

const APPROVAL_HINTS = {
  ask: "Read-only tools run without asking; anything that sends, changes or deletes asks first, unless you chose Always allow.",
  "ask-every":
    "Asks before every tool, reads included, unless you chose Always allow.",
  allow: "Runs every tool without asking.",
};

const APPROVAL_OPTIONS = [
  { value: "ask", label: "Ask before external actions" },
  { value: "ask-every", label: "Ask before every tool" },
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
  // Optional "Discard changes" (the Bots view's inline Settings tab): the
  // host resets the form; enabled only with unsaved changes.
  onDiscard = null,
  // A lead's draft being reviewed: "Discard draft" beside Create (the host
  // asks first and removes the draft).
  onDiscardDraft = null,
  // A team lead's suggested providers/tools for a drafted bot (TEAM-005):
  // [{ provider, tools, toolsChecked }]. Nothing is selected until the user
  // accepts a suggestion (or ticks it themselves).
  suggestions = null,
  // Capabilities the draft lacks, with providers the lead's find_providers
  // suggested (bot-capabilities CAP-004/005): [{ need, suggestions }].
  gaps = null,
  // In a dashboard's Bots view: a new bot can show its results on that
  // dashboard (TEAM-012). Passed to onSave as { showOnDashboard }.
  canShowOnDashboard = false,
  // Optional content at the top of the form's scroll area (e.g. a lead's
  // draft banner) — scrolls with the form instead of staying pinned above it.
  header = null,
}) => {
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  const [name, setName] = useState(bot?.name || "");
  const [instructions, setInstructions] = useState(bot?.instructions || "");
  // A saved bot without its own AI model shows (and keeps) "Default AI
  // provider"; a new bot pre-selects the user's default.
  const followsDefault = !!bot?.id && !bot?.provider;
  const [provider, setProvider] = useState(
    bot?.provider ||
      (bot?.id ? USE_DEFAULT_PROVIDER : defaultProviderId(providers)),
  );
  const usesDefault = provider === USE_DEFAULT_PROVIDER;
  const effectiveProvider = usesDefault
    ? markedDefaultProviderType(providers)
    : provider;
  const [model, setModel] = useState(bot?.model || "");
  const [engine, setEngine] = useState(bot?.engine || "");
  const [approvalPolicy, setApprovalPolicy] = useState(
    bot?.approvalPolicy || "ask",
  );
  const approvalHint = APPROVAL_HINTS[approvalPolicy] || null;

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
  // "Runs when…" (TEAM-012): one picker of everything that can trigger the
  // bot; a just-added trigger reminds the user to Save.
  const [pickTrigger, setPickTrigger] = useState("");
  const [triggerAdded, setTriggerAdded] = useState(false);

  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // "Saved" shows after a successful save until the next edit.
  const [justSaved, setJustSaved] = useState(false);

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
    if (dirty) setJustSaved(false);
  }, [dirty]);
  useEffect(() => {
    if (typeof onDirtyChange === "function") onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Reload the provider list when one is added (a draft's gap installed
  // from here, or any provider saved) — the form keeps its edits.
  const [sourcesNonce, setSourcesNonce] = useState(0);
  useEffect(() => {
    const reload = () => setSourcesNonce((n) => n + 1);
    window.addEventListener("dash:provider-installed", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("dash:provider-installed", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

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
  }, [bot?.workspaceId, sourcesNonce]);

  // Fetch the model list for the chosen provider.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.llm?.listModels) {
      setModelOptions([]);
      return undefined;
    }
    if (!effectiveProvider) {
      setModelOptions([]);
      return undefined;
    }
    api.llm
      .listModels(effectiveProvider)
      .then((res) => {
        if (alive) setModelOptions((res && res.models) || []);
      })
      .catch(() => {
        if (alive) setModelOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [effectiveProvider]);

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

  // Accept a lead's suggestion: turn the provider on with exactly the
  // suggested tools — or every tool when they couldn't be checked.
  const acceptSuggestion = (sug) => {
    if (!sug || !sug.provider) return;
    setSelectedServers((prev) =>
      prev.includes(sug.provider) ? prev : [...prev, sug.provider],
    );
    const src = availableServers.find((x) => x.serverName === sug.provider);
    const known = src && Array.isArray(src.tools) ? src.tools : null;
    const picked =
      sug.toolsChecked && known && Array.isArray(sug.tools)
        ? sug.tools.filter((t) => known.includes(t))
        : null;
    setToolSelections((prev) => {
      const copy = { ...prev };
      if (picked && picked.length && picked.length < known.length) {
        copy[sug.provider] = picked;
      } else {
        delete copy[sug.provider];
      }
      return copy;
    });
  };
  const suggestionFor = (serverName) =>
    (suggestions || []).find((x) => x.provider === serverName) || null;
  const pendingSuggestions = (suggestions || []).filter(
    (x) => !selectedServers.includes(x.provider),
  );

  const setAllTools = (serverName, on) => {
    setToolSelections((prev) => {
      const copy = { ...prev };
      if (on) delete copy[serverName];
      else copy[serverName] = [];
      return copy;
    });
  };

  // Other bots' events (this bot excluded — it can't trigger itself), for
  // labelling the triggers already on the bot.
  const botCatalog = useMemo(
    () => buildBotEventCatalog(bots, toolSources, bot?.id || null),
    [bots, toolSources, bot?.id],
  );

  // Everything that can trigger this bot, grouped (TEAM-012).
  const triggerOptions = useMemo(
    () =>
      buildTriggerOptions({
        team: team || null,
        workspaces,
        getWidgetConfig,
        bots,
        toolSources,
        botId: bot?.id || null,
        existing: subscriptions.map((s) => s.eventType),
      }),
    [
      team,
      workspaces,
      getWidgetConfig,
      bots,
      toolSources,
      bot?.id,
      subscriptions,
    ],
  );
  const pickedTrigger =
    triggerOptions.find((o) => o.value === pickTrigger) || null;

  const addSubscription = () => {
    if (!pickedTrigger) return;
    const sub = pickedTrigger.subscription;
    setSubscriptions((prev) =>
      prev.some((s) => s.eventType === sub.eventType) ? prev : [...prev, sub],
    );
    setPickTrigger("");
    setTriggerAdded(true);
  };

  const removeSubscription = (eventType) => {
    setSubscriptions((prev) => prev.filter((s) => s.eventType !== eventType));
  };

  // An existing bot saves only when something changed, so Save visibly does
  // something; a new bot can always be created once it has a name.
  const canSave =
    name.trim() && instructions.trim() && !saving && (isCreating || dirty);

  const handleSave = async () => {
    setError(null);
    setJustSaved(false);
    const edited = formDefinition();
    setSaving(true);
    try {
      // Only what this form changed is saved over the latest copy — a
      // provider switched elsewhere or a trigger added on the team diagram
      // since the form opened isn't put back (keepLatest).
      let definition = edited;
      const api = getMainApi();
      if (bot?.id && api?.bots?.get) {
        const latest = await Promise.resolve(api.bots.get(bot.id)).catch(
          () => null,
        );
        definition = keepLatest(edited, openedRef.current, latest);
      }
      if (isCreating && canShowOnDashboard) {
        await onSave(definition, { showOnDashboard });
      } else {
        await onSave(definition);
      }
      openedRef.current = edited;
      setBaseline(snapshot);
      setJustSaved(true);
    } catch (e) {
      setError((e && e.message) || "Failed to save bot");
    } finally {
      setSaving(false);
    }
  };

  // The definition this form would save, from its fields.
  function formDefinition() {
    const cron = advanced
      ? advancedCron.trim()
      : buildCron({ frequency, time, dayOfWeek, dayOfMonth });
    const schedules = cron ? [{ cron, prompt: schedulePrompt.trim() }] : [];
    return {
      ...(bot?.id ? { id: bot.id } : {}),
      name: name.trim(),
      instructions: instructions.trim(),
      provider: provider && !usesDefault ? provider : null,
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
  }

  // The definition as the form opened (then as last saved) — what keepLatest
  // compares against to tell which fields this form changed.
  const openedRef = useRef(null);
  if (openedRef.current === null) openedRef.current = formDefinition();

  const scheduleOn = advanced || frequency !== "off";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {header}
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
            // Grow with the text — the form already scrolls; no scroll
            // inside a scroll.
            autoGrow
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
          {isCreating && canShowOnDashboard ? (
            <Checkbox
              label="Show results on this dashboard"
              checked={showOnDashboard}
              onChange={(on) => setShowOnDashboard(!!on)}
            />
          ) : null}
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
          {pendingSuggestions.length ? (
            <div>
              <Button3
                title="Accept all suggestions"
                size="xs"
                onClick={() => pendingSuggestions.forEach(acceptSuggestion)}
              />
            </div>
          ) : null}
          {gaps && gaps.length ? (
            <DraftGaps
              gaps={gaps}
              toolSources={toolSources}
              selectedServers={selectedServers}
              onUse={(providerName) =>
                acceptSuggestion({
                  provider: providerName,
                  tools: [],
                  toolsChecked: false,
                })
              }
            />
          ) : null}
          {availableServers.length ? (
            <div className="flex flex-col gap-1">
              {availableServers.map((s) => {
                const on = selectedServers.includes(s.serverName);
                const sug = on ? null : suggestionFor(s.serverName);
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
                    {sug ? (
                      <div className="flex flex-row flex-wrap items-center gap-2 pl-7">
                        <span className="text-xs text-amber-300">
                          Suggested by the lead
                        </span>
                        {sug.tools && sug.tools.length ? (
                          <span className="text-xs opacity-60 font-mono">
                            {sug.tools.join(", ")}
                          </span>
                        ) : null}
                        <Button3
                          title={
                            sug.toolsChecked && sug.tools && sug.tools.length
                              ? "Accept"
                              : "Accept (all tools)"
                          }
                          size="xs"
                          ariaLabel={`Accept ${s.label}`}
                          onClick={() => acceptSuggestion(sug)}
                        />
                      </div>
                    ) : null}
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
              options={
                followsDefault || usesDefault
                  ? [
                      useDefaultOption(providers),
                      ...providerOptionsFrom(providers),
                    ]
                  : providerOptionsFrom(providers)
              }
            />
            {usesDefault && !markedDefaultProviderType(providers) ? (
              <span className="text-xs text-red-400">
                No AI provider is marked default, so this bot&apos;s runs fail
                until you choose one here.
              </span>
            ) : null}
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
        {approvalHint ? (
          <span className="text-xs opacity-50">{approvalHint}</span>
        ) : null}

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
                    <span className="text-sm flex flex-col">
                      <span>
                        {label}
                        {missing ? (
                          <span className="text-xs opacity-60">
                            {" "}
                            ({kind === "bot" ? "bot" : "widget"} missing)
                          </span>
                        ) : null}
                      </span>
                      {/* The owner's note for this trigger (TEAM-014) —
                          edited from the team diagram. */}
                      {sub.note ? (
                        <span
                          data-testid="trigger-note"
                          className="text-xs opacity-60"
                        >
                          {`Then: ${sub.note}`}
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
          {triggerOptions.length ? (
            <div className="flex flex-col gap-2">
              <SelectInput
                label="Runs when…"
                value={pickTrigger}
                onChange={setPickTrigger}
                placeholder="Choose what triggers this bot…"
                options={triggerOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                  group: o.group,
                }))}
              />
              <Button
                title="Add trigger"
                onClick={addSubscription}
                size="sm"
                disabled={!pickedTrigger}
              />
              {triggerAdded && dirty ? (
                <span className="text-xs opacity-70">
                  Save to keep this trigger.
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-xs opacity-50">
              {team
                ? "Nothing can trigger this bot yet. Add a widget that publishes events to this dashboard, or another bot to its team."
                : "Nothing can trigger this bot yet. Add a widget that publishes events to a dashboard, or create another bot."}
            </span>
          )}
          <span className="text-xs opacity-50">
            The bot runs automatically when one of these events fires.
          </span>
        </div>
      </div>

      <div
        data-testid="bot-detail-footer"
        className={`flex-shrink-0 flex flex-row justify-between gap-2 px-6 py-4 border-t ${hairline}`}
      >
        <div>
          {!isCreating && onDelete ? (
            <Button title="Delete" onClick={onDelete} size="sm" />
          ) : null}
        </div>
        <div className="flex flex-row items-center gap-2">
          {error ? (
            <span className="text-sm text-red-400">{error}</span>
          ) : justSaved ? (
            <span className="text-sm opacity-70">Saved</span>
          ) : null}
          {isCreating && onCancel ? (
            <Button title="Cancel" onClick={onCancel} size="sm" />
          ) : null}
          {isCreating && onDiscardDraft ? (
            <Button
              title="Discard draft"
              onClick={onDiscardDraft}
              size="sm"
              disabled={saving}
            />
          ) : null}
          {onDiscard && !isCreating ? (
            <Button
              title="Discard changes"
              onClick={onDiscard}
              size="sm"
              disabled={!dirty || saving}
            />
          ) : null}
          <Button
            title={saving ? "Saving…" : isCreating ? "Create" : "Save"}
            onClick={handleSave}
            size="sm"
            disabled={!canSave}
          />
        </div>
      </div>
    </div>
  );
};
