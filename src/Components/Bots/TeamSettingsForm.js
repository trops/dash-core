/**
 * TeamSettingsForm — a team's settings as one form (DASH-57, Code Factory
 * G6): the repo URL, base branch, work folder, … its package declares.
 * Its bots use each as {name}; the values are filled in when they run.
 *
 * Used when a team or dashboard package is installed (the values go in with
 * it) and on the dashboard's Team settings, to change them later.
 *
 *   TeamSettingsForm   the fields, controlled: values + onChange(name, v)
 *   TeamSettingsPanel  a dashboard's settings, loaded and saved
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  InputText,
  SectionLabel,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** The value a field shows: its own, else "" (the default is the hint). */
function shown(values, s) {
  if (!has(values, s.name)) return s.type === "boolean" ? !!s.default : "";
  const v = values[s.name];
  return s.type === "boolean"
    ? !!v
    : v === null || v === undefined
      ? ""
      : String(v);
}

/** Settings with no value and no default: runs that use them fail. */
export function emptySettings(settings, values) {
  return (Array.isArray(settings) ? settings : []).filter((s) => {
    if (s.type === "boolean") return false;
    const v = has(values, s.name) ? values[s.name] : s.default;
    return v === undefined || v === null || v === "";
  });
}

/**
 * The fields.
 * @param {object[]} settings   declared: { name, label, type, default?, description? }
 * @param {object} values       { [name]: value }
 * @param {(name, value) => void} onChange
 * @param {object} [usedBy]     { [name]: [botName] }
 * @param {object} [errors]     not used per field; shown by the caller
 */
export const TeamSettingsForm = ({
  settings = [],
  values = {},
  onChange,
  usedBy = null,
  disabled = false,
}) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  if (!settings.length) return null;
  const empty = new Set(emptySettings(settings, values).map((s) => s.name));
  return (
    <div className="flex flex-col gap-3" data-testid="team-settings-form">
      {settings.map((s) => {
        const hint = [
          s.description || null,
          usedBy && usedBy[s.name] && usedBy[s.name].length
            ? `Used by ${usedBy[s.name].join(", ")} as {${s.name}}`
            : `Bots use it as {${s.name}}`,
        ]
          .filter(Boolean)
          .join(" · ");
        if (s.type === "boolean") {
          return (
            <div
              key={s.name}
              className="flex flex-col gap-0.5"
              data-testid={`team-setting-${s.name}`}
            >
              <Checkbox
                label={s.label || s.name}
                checked={shown(values, s)}
                disabled={disabled}
                onChange={(on) => onChange && onChange(s.name, !!on)}
              />
              <span className={`text-xs ${muted}`}>{hint}</span>
            </div>
          );
        }
        const placeholder =
          s.default !== undefined && s.default !== ""
            ? `${s.default} (the default)`
            : s.type === "folder"
              ? "/Users/you/Factory or ~/Factory"
              : s.type === "url"
                ? "https://github.com/you/repo.git"
                : "";
        return (
          <div
            key={s.name}
            className="flex flex-col gap-1 max-w-xl"
            data-testid={`team-setting-${s.name}`}
          >
            <span className="text-sm font-medium">{s.label || s.name}</span>
            <div className="flex flex-row gap-2 items-center">
              <div className="flex-1 min-w-0">
                <InputText
                  ariaLabel={s.label || s.name}
                  value={shown(values, s)}
                  placeholder={placeholder}
                  disabled={disabled}
                  onChange={(v) => onChange && onChange(s.name, v)}
                />
              </div>
              {s.type === "folder" ? (
                <Button3
                  title="Choose…"
                  size="sm"
                  disabled={disabled}
                  onClick={async () => {
                    const api = window.mainApi && window.mainApi.flows;
                    const r =
                      api && api.pickFolder
                        ? await api.pickFolder({ title: s.label || s.name })
                        : null;
                    if (r && r.path && onChange) onChange(s.name, r.path);
                  }}
                />
              ) : null}
            </div>
            <span className={`text-xs ${muted}`}>{hint}</span>
            {empty.has(s.name) ? (
              <span className={`text-xs ${status.warning.text}`}>
                No value yet: bots that use it can't run until it has one.
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/**
 * A dashboard's team settings, loaded and saved (Bots › Team settings).
 * Nothing shows when the team declares none.
 */
export const TeamSettingsPanel = ({ workspaceId }) => {
  const { hairline, muted } = useConfigTokens();
  const status = useStatusTokens();
  const [team, setTeam] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const api = window.mainApi && window.mainApi.bots;
  const load = useCallback(async () => {
    if (!api || workspaceId === null || workspaceId === undefined) return;
    let t = null;
    try {
      if (api.getTeamValues) t = await api.getTeamValues(workspaceId);
      else if (api.getTeamSettings) t = await api.getTeamSettings(workspaceId);
    } catch (_e) {
      t = null;
    }
    const declared = (t && Array.isArray(t.declared) && t.declared) || [];
    const values = (t && t.values) || {};
    setTeam({ declared, values, usedBy: (t && t.usedBy) || null });
    setDraft(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!team || !team.declared.length) return null;

  const changed = team.declared.some(
    (s) =>
      JSON.stringify(draft[s.name]) !== JSON.stringify(team.values[s.name]),
  );
  const save = async () => {
    if (!api || !api.setTeamValues) {
      setErrors(["Changing team settings needs a newer Dash."]);
      return;
    }
    setSaving(true);
    setErrors([]);
    setSaved(false);
    const patch = {};
    for (const s of team.declared) {
      patch[s.name] = has(draft, s.name) ? draft[s.name] : "";
    }
    try {
      const r = await api.setTeamValues(workspaceId, { values: patch });
      if (r && r.errors && r.errors.length) setErrors(r.errors);
      else {
        setSaved(true);
        await load();
      }
    } catch (e) {
      setErrors([(e && e.message) || String(e)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Team settings"
      data-testid="team-settings-panel"
      className={`rounded-xl border p-4 flex flex-col gap-3 ${hairline}`}
    >
      <div className="flex flex-col gap-0.5">
        <SectionLabel text="Team settings" />
        <span className={`text-xs ${muted}`}>
          This team's bots use these as {"{name}"} in their instructions, checks
          and folders. A change reaches every bot on its next run.
        </span>
      </div>
      <TeamSettingsForm
        settings={team.declared}
        values={draft}
        usedBy={team.usedBy}
        disabled={saving}
        onChange={(name, v) => {
          setSaved(false);
          setDraft((d) => ({ ...d, [name]: v }));
        }}
      />
      {errors.length ? (
        <div
          className="flex flex-col gap-0.5"
          data-testid="team-settings-errors"
        >
          {errors.map((e, i) => (
            <span key={i} className={`text-xs ${status.error.text}`}>
              {e}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-row gap-2 items-center">
        <Button
          title={saving ? "Saving…" : "Save settings"}
          size="sm"
          disabled={saving || !changed}
          onClick={save}
        />
        {saved && !changed ? (
          <span className={`text-xs ${status.success.text}`}>Saved.</span>
        ) : null}
      </div>
    </section>
  );
};

export default TeamSettingsForm;
