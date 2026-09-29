import React, { useState } from "react";
import { Button, InputText, TextArea, SelectInput } from "@trops/dash-react";

/**
 * BotDetail — create/edit form for a Bot Factory bot (Settings → Bots).
 *
 * The Setup form is the source of truth (PRD US-017 P0). Persists via
 * dashApi.bots.save(definition); the chat co-pilot / Test tab (US-017 P1) and
 * per-tool grant UI come later. All inputs are @trops/dash-react primitives.
 */

// Distinct configured AI-provider types, for the provider dropdown.
const AI_PROVIDER_TYPES = ["anthropic", "openai", "xai"];
function providerOptionsFrom(providers) {
  const present = new Set();
  for (const p of Object.values(providers || {})) {
    if (p && AI_PROVIDER_TYPES.includes(p.type)) present.add(p.type);
  }
  return [
    { value: "", label: "Default provider" },
    ...[...present].map((t) => ({ value: t, label: t })),
  ];
}

const APPROVAL_OPTIONS = [
  { value: "ask", label: "Ask before external actions" },
  { value: "allow", label: "Allow without prompting" },
];

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
  const [approvalPolicy, setApprovalPolicy] = useState(
    bot?.approvalPolicy || "ask",
  );
  const [mcpServers, setMcpServers] = useState(
    (bot?.mcpServers || []).join(", "),
  );
  const [cron, setCron] = useState(bot?.schedules?.[0]?.cron || "");
  const [schedulePrompt, setSchedulePrompt] = useState(
    bot?.schedules?.[0]?.prompt || "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canSave = name.trim() && instructions.trim() && !saving;

  const handleSave = async () => {
    setError(null);
    const servers = mcpServers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const schedules = cron.trim()
      ? [{ cron: cron.trim(), prompt: schedulePrompt.trim() }]
      : [];
    const definition = {
      ...(bot?.id ? { id: bot.id } : {}),
      name: name.trim(),
      instructions: instructions.trim(),
      provider: provider || null,
      model: model.trim() || null,
      approvalPolicy,
      mcpServers: servers,
      schedules,
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

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Model</span>
          <InputText
            value={model}
            onChange={setModel}
            placeholder="Leave blank for the recommended model"
          />
        </div>

        <SelectInput
          label="Approval policy"
          value={approvalPolicy}
          onChange={setApprovalPolicy}
          options={APPROVAL_OPTIONS}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">MCP servers</span>
          <InputText
            value={mcpServers}
            onChange={setMcpServers}
            placeholder="Comma-separated server names, e.g. github, slack"
          />
          <span className="text-xs opacity-50">
            Tools on these servers route through the approval policy above.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Schedule (optional)</span>
          <InputText
            value={cron}
            onChange={setCron}
            placeholder="Cron, e.g. 0 7 * * 1-5"
          />
          {cron.trim() ? (
            <InputText
              value={schedulePrompt}
              onChange={setSchedulePrompt}
              placeholder="Task prompt for the scheduled run"
            />
          ) : null}
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
