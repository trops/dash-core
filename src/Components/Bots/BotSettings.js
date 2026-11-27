/**
 * BotSettings — the settings a bot owns (DASH-136): the ones for its own
 * job, declared and kept on the bot (src/utils/botSettings.js).
 *
 *   BotOwnSettings     a bot's Settings tab: fill them in, declare more,
 *                      take one away (controlled: the bot form saves them)
 *   BotSettingsInstall the install form's "Bots that need something from
 *                      you": one card per bot, the same fields. Shared by
 *                      the registry dashboard install and the team / bot
 *                      import review, so the two can't drift apart.
 *
 * Install values are { [role]: { [name]: value } }; they travel inside the
 * team values under BOT_VALUES_KEY ("@bots").
 */
import React, { useState } from "react";
import {
  Button3,
  Checkbox,
  InputText,
  SectionLabel,
  SelectInput,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { TeamSettingsForm, emptySettings } from "./TeamSettingsForm";
import { BOT_VALUES_KEY } from "../../utils/botSettings";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const COLUMN_TYPES = ["text", "url", "folder", "command", "boolean", "number"];
const TYPES = [...COLUMN_TYPES, "table", "tracker"];
const TYPE_LABELS = {
  text: "Text",
  url: "Web or git address",
  folder: "Folder",
  command: "Command",
  boolean: "Yes / no",
  number: "Number",
  table: "Table (rows)",
  tracker: "Where tickets come from (Jira, GitHub Issues, Linear or none)",
};

/** Required settings of these that are still empty. */
export function missingRequired(settings, values) {
  return emptySettings(settings, values).filter((s) => s && s.required);
}

/**
 * A setting from the "Add a setting" fields: { setting } or { error }.
 * Columns (a table's) are written "url:url, baseBranch:text".
 */
export function settingFromDraft(draft, existing = []) {
  const name = String((draft && draft.name) || "").trim();
  if (!NAME_RE.test(name)) {
    return {
      error:
        "Its name is letters, digits and underscores, starting with a letter (like workFolder).",
    };
  }
  if ((existing || []).some((s) => s && s.name === name)) {
    return { error: `This bot already has a setting called ${name}.` };
  }
  const type = TYPES.includes(draft.type) ? draft.type : "text";
  const setting = {
    name,
    label: String(draft.label || "").trim() || name,
    type,
  };
  if (draft.required) setting.required = true;
  const description = String(draft.description || "").trim();
  if (description) setting.description = description;
  if (type === "table") {
    const columns = String(draft.columns || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [n, t] = c.split(":").map((x) => (x || "").trim());
        return {
          name: n,
          label: n,
          type: COLUMN_TYPES.includes(t) ? t : "text",
        };
      });
    if (!columns.length || columns.some((c) => !NAME_RE.test(c.name))) {
      return {
        error:
          'A table needs its columns, like "url:url, baseBranch:text" (each a name, then a type).',
      };
    }
    setting.columns = columns;
  } else if (type === "tracker") {
    // Picked on the form, never a typed default (DASH-135).
  } else {
    const d = String(draft.default || "").trim();
    if (d)
      setting.default = type === "boolean" ? /^(yes|true|1|on)$/i.test(d) : d;
  }
  return { setting };
}

const EMPTY_DRAFT = {
  name: "",
  label: "",
  type: "text",
  required: false,
  default: "",
  columns: "",
  description: "",
};

/**
 * A bot's own settings on its Settings tab. Controlled: `settings`
 * (declared) and `values`; onChange({ settings, values }).
 */
export const BotOwnSettings = ({
  botName = "",
  settings = [],
  values = {},
  onChange,
  disabled = false,
  // Its dashboard, for the providers a tracker setting lists from.
  workspaceId = null,
}) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState(null);
  const who = botName || "This bot";
  const change = (next) => onChange && onChange({ settings, values, ...next });

  const add = () => {
    const r = settingFromDraft(draft, settings);
    if (r.error) {
      setError(r.error);
      return;
    }
    setError(null);
    change({ settings: [...settings, r.setting] });
    setDraft(EMPTY_DRAFT);
    setAdding(false);
  };
  const remove = (name) => {
    const { [name]: _gone, ...rest } = values || {};
    change({
      settings: settings.filter((s) => s.name !== name),
      values: rest,
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="bot-own-settings">
      <SectionLabel text="Settings for its job" />
      <span className={`text-xs ${muted}`}>
        {`What ${who} needs to do its own job, like the folder it works in. Use one as {name} in its instructions, folders or checks; it's filled in when it runs. What it decides goes to the next bot in its handoff. What it may do (push, merge…) is its access, never a setting.`}
      </span>
      {settings.length ? (
        <TeamSettingsForm
          settings={settings}
          values={values}
          botName={who}
          workspaceId={workspaceId}
          disabled={disabled}
          onChange={(name, v) => change({ values: { ...values, [name]: v } })}
        />
      ) : (
        <span className={`text-xs ${muted}`}>
          It has no settings of its own.
        </span>
      )}
      {settings.length ? (
        <div
          className="flex flex-col gap-1"
          data-testid="bot-own-settings-list"
        >
          {settings.map((s) => (
            <div key={s.name} className="flex flex-row gap-2 items-center">
              <span className={`text-xs ${muted}`}>
                {`${s.label || s.name} ({${s.name}}) · ${TYPE_LABELS[s.type] || s.type}${s.required ? " · Required" : ""}`}
              </span>
              <Button3
                title="Remove"
                size="xs"
                ariaLabel={`Remove setting ${s.label || s.name}`}
                disabled={disabled}
                onClick={() => remove(s.name)}
              />
            </div>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
          data-testid="bot-own-settings-add"
        >
          <InputText
            label="Name"
            value={draft.name}
            placeholder="workFolder"
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          />
          <InputText
            label="Label"
            value={draft.label}
            placeholder="Work folder"
            onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
          />
          <SelectInput
            label="Type"
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
            options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
          />
          {draft.type === "table" ? (
            <InputText
              label="Columns"
              value={draft.columns}
              placeholder="url:url, baseBranch:text"
              onChange={(v) => setDraft((d) => ({ ...d, columns: v }))}
            />
          ) : draft.type === "tracker" ? null : (
            <InputText
              label="Default (optional)"
              value={draft.default}
              onChange={(v) => setDraft((d) => ({ ...d, default: v }))}
            />
          )}
          <InputText
            label="Description (optional)"
            value={draft.description}
            onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
          />
          <Checkbox
            label="Required: its team's setup lists it until it has a value"
            checked={!!draft.required}
            onChange={(on) => setDraft((d) => ({ ...d, required: !!on }))}
          />
          {error ? (
            <span className={`text-xs ${status.error.text}`}>{error}</span>
          ) : null}
          <div className="flex flex-row gap-2">
            <Button3 title="Add setting" size="sm" onClick={add} />
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => {
                setAdding(false);
                setError(null);
                setDraft(EMPTY_DRAFT);
              }}
            />
          </div>
        </div>
      ) : (
        <div>
          <Button3
            title="Add a setting"
            size="sm"
            disabled={disabled}
            onClick={() => setAdding(true)}
          />
        </div>
      )}
    </div>
  );
};

/**
 * The bots of a package that declare settings of their own:
 * [{ role, name, settings }], from its members (a manifest's, or a
 * registry summary's).
 */
export function botsWithSettings(members) {
  return (Array.isArray(members) ? members : [])
    .map((m) => {
      const settings =
        (m && m.embedded && m.embedded.settings) || (m && m.settings) || [];
      return {
        role: m && m.role,
        name: (m && ((m.embedded && m.embedded.name) || m.name)) || "",
        settings: Array.isArray(settings) ? settings : [],
      };
    })
    .filter((b) => b.role && b.settings.length);
}

/** Team values with the bots' own put in under "@bots" (when any). */
export function withBotInstallValues(teamValues, botValues) {
  const bots = Object.fromEntries(
    Object.entries(botValues || {}).filter(
      ([, v]) => v && Object.keys(v).length,
    ),
  );
  if (!Object.keys(bots).length) return teamValues;
  return { ...(teamValues || {}), [BOT_VALUES_KEY]: bots };
}

/**
 * "Bots that need something from you" (mockup 8): one card per bot that
 * declares settings, its Required ones marked. Controlled: `values`
 * { [role]: { [name]: value } }, onChange(role, name, value). Nothing
 * shows when no bot declares any.
 */
export const BotSettingsInstall = ({
  bots = [],
  values = {},
  onChange,
  disabled = false,
}) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const list = (Array.isArray(bots) ? bots : []).filter(
    (b) => b && b.settings && b.settings.length,
  );
  if (!list.length) return null;
  const waiting = list.filter(
    (b) => missingRequired(b.settings, values[b.role] || {}).length,
  ).length;
  return (
    <div className="flex flex-col gap-3" data-testid="bot-settings-install">
      <div className="flex flex-col gap-0.5">
        <SectionLabel text="Bots that need something from you" />
        <span className={`text-xs ${muted}`}>
          Fill them in now or later on each bot&apos;s Settings tab. Each is
          saved on its bot.
        </span>
      </div>
      {list.map((b) => {
        const first = b.settings.find((s) => s.required) || b.settings[0];
        return (
          <div
            key={b.role}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
            data-testid={`bot-settings-install-${b.role}`}
          >
            <span className="text-sm font-medium">
              {`${b.name}${first ? ` · ${first.label || first.name}` : ""}`}
            </span>
            <TeamSettingsForm
              settings={b.settings}
              values={values[b.role] || {}}
              botName={b.name}
              disabled={disabled}
              onChange={(name, v) => onChange && onChange(b.role, name, v)}
            />
          </div>
        );
      })}
      {waiting ? (
        <span
          className={`text-xs ${status.warning.text}`}
          data-testid="bot-settings-install-waiting"
        >
          {`${waiting} bot${waiting === 1 ? "" : "s"} still need${waiting === 1 ? "s" : ""} settings. It installs, and ${waiting === 1 ? "that bot waits" : "those bots wait"} until they're filled in.`}
        </span>
      ) : null}
    </div>
  );
};

export default BotOwnSettings;
