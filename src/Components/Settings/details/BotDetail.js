import React, { useState, useEffect } from "react";
import {
  Button,
  InputText,
  TextArea,
  SelectInput,
  Checkbox,
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

/**
 * BotDetail — create/edit form for a Bot Factory bot (Settings → Bots).
 *
 * Built for a non-technical user: Provider/Model/Tools/Schedule are all
 * pick-from-a-list, never free text. The raw cron lives behind an "Advanced"
 * toggle for power users. All inputs are @trops/dash-react primitives.
 */

// Friendly, Title-case provider labels for the dropdown.
const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
};
const AI_PROVIDER_TYPES = Object.keys(PROVIDER_LABELS);

function providerOptionsFrom(providers) {
  const present = new Set();
  for (const p of Object.values(providers || {})) {
    if (p && AI_PROVIDER_TYPES.includes(p.type)) present.add(p.type);
  }
  return [
    { value: "", label: "Default provider" },
    ...[...present].map((t) => ({ value: t, label: PROVIDER_LABELS[t] || t })),
  ];
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

function getMainApi() {
  return typeof window !== "undefined" ? window.mainApi : null;
}

export const BotDetail = ({
  bot = null,
  isCreating = false,
  providers = {},
  onSave,
  onCancel,
  onDelete,
}) => {
  const [name, setName] = useState(bot?.name || "");
  const [instructions, setInstructions] = useState(bot?.instructions || "");
  const [provider, setProvider] = useState(bot?.provider || "");
  const [model, setModel] = useState(bot?.model || "");
  const [engine, setEngine] = useState(bot?.engine || "");
  const [approvalPolicy, setApprovalPolicy] = useState(
    bot?.approvalPolicy || "ask",
  );

  // --- Tools & integrations (MCP servers) ---
  const [selectedServers, setSelectedServers] = useState(bot?.mcpServers || []);
  const [connectedServers, setConnectedServers] = useState([]);

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
  const [subscriptions, setSubscriptions] = useState(
    (bot?.subscriptions || []).map((s) => s && s.eventType).filter(Boolean),
  );
  const [newEvent, setNewEvent] = useState("");
  const [knownEvents, setKnownEvents] = useState([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Discover recently-seen widget event types to suggest as subscriptions.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.widgetEvent?.getLastEvents) return undefined;
    Promise.resolve(api.widgetEvent.getLastEvents())
      .then((events) => {
        if (alive && events) setKnownEvents(Object.keys(events).sort());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Discover the user's connected integrations for the picker.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.llm?.listConnectedTools) return undefined;
    api.llm
      .listConnectedTools()
      .then((servers) => {
        if (!alive || !Array.isArray(servers)) return;
        setConnectedServers(servers.map((s) => s.serverName).filter(Boolean));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // Union of connected servers + any the bot already has (so an attached server
  // that isn't currently connected still shows, checked, and isn't dropped).
  const availableServers = [
    ...new Set([...(selectedServers || []), ...connectedServers]),
  ].map((serverName) => ({
    serverName,
    label: prettyServer(serverName),
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

  const addSubscription = (eventType) => {
    const ev = (eventType || "").trim();
    if (!ev) return;
    setSubscriptions((prev) => (prev.includes(ev) ? prev : [...prev, ev]));
    setNewEvent("");
  };

  const removeSubscription = (eventType) => {
    setSubscriptions((prev) => prev.filter((e) => e !== eventType));
  };

  // Recently-seen events not already subscribed — offered as one-click adds.
  const eventSuggestions = knownEvents.filter(
    (ev) => !subscriptions.includes(ev),
  );

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
      mcpServers: selectedServers,
      schedules,
      subscriptions: subscriptions.map((eventType) => ({ eventType })),
    };
    setSaving(true);
    try {
      await onSave(definition);
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

        <SelectInput
          label="Provider"
          value={provider}
          onChange={setProvider}
          options={providerOptionsFrom(providers)}
          placeholder="Default provider"
        />

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

        <SelectInput
          label="Approval policy"
          value={approvalPolicy}
          onChange={setApprovalPolicy}
          options={APPROVAL_OPTIONS}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Tools &amp; integrations</span>
          {availableServers.length ? (
            <div className="flex flex-col gap-1">
              {availableServers.map((s) => (
                <Checkbox
                  key={s.serverName}
                  label={s.label}
                  checked={selectedServers.includes(s.serverName)}
                  onChange={() => toggleServer(s.serverName)}
                />
              ))}
            </div>
          ) : (
            <span className="text-xs opacity-50">
              No connected integrations yet. Add one under Settings → MCP
              Server, then it will appear here.
            </span>
          )}
          <span className="text-xs opacity-50">
            Tools on these integrations route through the approval policy above.
          </span>
        </div>

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
            <div className="flex flex-row flex-wrap gap-2">
              {subscriptions.map((ev) => (
                <span
                  key={ev}
                  className="flex flex-row items-center gap-1 text-xs px-2 py-1 rounded bg-gray-700"
                >
                  {ev}
                  <button
                    type="button"
                    onClick={() => removeSubscription(ev)}
                    className="opacity-60 hover:opacity-100"
                    aria-label={`Remove ${ev}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs opacity-50">
              This bot doesn&apos;t run on any events yet.
            </span>
          )}
          <div className="flex flex-row gap-2">
            <InputText
              value={newEvent}
              onChange={setNewEvent}
              placeholder="Event name, e.g. pr.opened"
            />
            <Button
              title="Add"
              onClick={() => addSubscription(newEvent)}
              size="sm"
              disabled={!newEvent.trim()}
            />
          </div>
          {eventSuggestions.length ? (
            <div className="flex flex-row flex-wrap gap-1 items-center text-xs opacity-60">
              <span>Recently seen:</span>
              {eventSuggestions.slice(0, 8).map((ev) => (
                <button
                  key={ev}
                  type="button"
                  onClick={() => addSubscription(ev)}
                  className="underline hover:opacity-100"
                >
                  {ev}
                </button>
              ))}
            </div>
          ) : null}
          <span className="text-xs opacity-50">
            The bot runs automatically when one of these events fires.
          </span>
        </div>

        {error ? <span className="text-sm text-red-400">{error}</span> : null}
      </div>

      <div className="flex-shrink-0 flex flex-row justify-between gap-2 px-6 py-4 border-t">
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
