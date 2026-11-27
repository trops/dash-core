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
 *
 * A table (DASH-84) is rows of the same fields, each with a key: one row
 * per repo. Bots use {repo.url}; each job uses the row it picked.
 *
 * The same form shows one bot's own settings (DASH-136) when `botName` is
 * given. A required setting is marked Required.
 *
 * Its copy is for the person installing the team (DASH-129): each field
 * says what it's for (its description, else who uses it). How bots use it
 * ("Workspace Bot uses it as {workFolder}", a table's row keys) waits
 * behind one "Show how bots use it" under the form.
 *
 * A tracker (DASH-135) is where a bot's tickets come from: a source, then
 * pickers (TrackerSetting.js).
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Button,
  Button3,
  Checkbox,
  InputText,
  SectionLabel,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { noteSetupChanged } from "./teamSetupStore";
import { TrackerSetting } from "./TrackerSetting";
import { trackerEmpty } from "../../utils/trackerSetting";
import { MoreDetail } from "./MoreDetail";

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

/** A table's rows as the form keeps them. */
export function rowsOf(values, s) {
  const v = has(values, s.name) ? values[s.name] : null;
  return Array.isArray(v) ? v : [];
}

/** Settings with no value and no default: runs that use them fail. */
export function emptySettings(settings, values) {
  return (Array.isArray(settings) ? settings : []).filter((s) => {
    if (s.type === "boolean") return false;
    if (s.type === "table") return rowsOf(values, s).length === 0;
    const v = has(values, s.name) ? values[s.name] : s.default;
    // "None" is filled in on purpose; a tracker needs its project too.
    if (s.type === "tracker") return trackerEmpty(v);
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
  // One bot's own settings (DASH-136): whose they are.
  botName = null,
  // Its team's dashboard, for the providers a tracker lists from.
  workspaceId = null,
}) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  // How bots use each one ({name}, DASH-129): behind one toggle.
  const [showHow, setShowHow] = useState(false);
  if (!settings.length) return null;
  const empty = new Set(emptySettings(settings, values).map((s) => s.name));
  const users = (s) =>
    botName
      ? [botName]
      : usedBy && usedBy[s.name] && usedBy[s.name].length
        ? usedBy[s.name]
        : null;
  const title = (s) => (
    <span className="flex flex-row gap-2 items-baseline">
      <span className="text-sm font-medium">{s.label || s.name}</span>
      {s.required ? (
        <span
          className={`text-xs ${status.warning.text}`}
          data-testid={`team-setting-${s.name}-required`}
        >
          Required
        </span>
      ) : null}
    </span>
  );
  const emptyText = (what) =>
    botName
      ? `No ${what} yet: ${botName} can't do its job until it has one.`
      : `No ${what} yet: bots that use it can't run until it has one.`;
  return (
    <div className="flex flex-col gap-3" data-testid="team-settings-form">
      {settings.map((s) => {
        // What it's for first; how bots use it only when asked.
        const hint = [
          s.description || null,
          !botName && users(s) ? `Used by ${users(s).join(", ")}.` : null,
          showHow ? howText(s, botName, users(s)) : null,
        ]
          .filter(Boolean)
          .join(" ");
        if (s.type === "table") {
          return (
            <TableSetting
              key={s.name}
              setting={s}
              rows={rowsOf(values, s)}
              usedBy={users(s)}
              showHow={showHow}
              empty={empty.has(s.name)}
              emptyText={emptyText("rows")}
              title={title(s)}
              disabled={disabled}
              onChange={(rows) => onChange && onChange(s.name, rows)}
            />
          );
        }
        if (s.type === "tracker") {
          return (
            <TrackerSetting
              key={s.name}
              setting={s}
              value={has(values, s.name) ? values[s.name] : s.default || null}
              botName={botName}
              workspaceId={workspaceId}
              showHow={showHow}
              title={title(s)}
              disabled={disabled}
              onChange={(v) => onChange && onChange(s.name, v)}
            />
          );
        }
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
              {hint ? <span className={`text-xs ${muted}`}>{hint}</span> : null}
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
            {title(s)}
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
            {hint ? <span className={`text-xs ${muted}`}>{hint}</span> : null}
            {empty.has(s.name) ? (
              <span className={`text-xs ${status.warning.text}`}>
                {emptyText("value")}
              </span>
            ) : null}
          </div>
        );
      })}
      <MoreDetail
        open={showHow}
        onToggle={setShowHow}
        testId="team-settings-how"
      />
    </div>
  );
};

/** How bots use a setting (DASH-129's "Show how bots use it"). */
export function howText(s, botName = null, usedBy = null) {
  const who = botName
    ? `${botName} uses it`
    : usedBy && usedBy.length
      ? `${usedBy.join(", ")} ${usedBy.length === 1 ? "uses" : "use"} it`
      : "Bots use it";
  return `${who} as {${s.name}} in instructions, folders and checks; Dash fills in the value when they run.`;
}

/**
 * A table setting (DASH-84): its rows, each a key and its columns; rows can
 * be added and removed. Controlled: rows + onChange(rows).
 */
export const TableSetting = ({
  setting: s,
  rows = [],
  usedBy = null,
  empty = false,
  disabled = false,
  onChange,
  emptyText = "No rows yet: bots that use it can't run until it has one.",
  title = null,
  // How bots use it (DASH-129): shown when the form's toggle is open.
  showHow = false,
}) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const cols = Array.isArray(s.columns) ? s.columns : [];
  const field = s.pick || s.name;
  const sample = cols[0] ? `{${s.name}.${cols[0].name}}` : `{${s.name}.key}`;
  const set = (i, name, v) =>
    onChange &&
    onChange(rows.map((r, j) => (j === i ? { ...r, [name]: v } : r)));
  return (
    <div className="flex flex-col gap-2" data-testid={`team-setting-${s.name}`}>
      {title || (
        <span className="text-sm font-medium">{s.label || s.name}</span>
      )}
      <span className={`text-xs ${muted}`}>
        {[
          s.description ||
            "One row each. Each job uses the row a bot picks for it.",
          usedBy && usedBy.length ? `Used by ${usedBy.join(", ")}.` : null,
          showHow
            ? `${
                usedBy && usedBy.length
                  ? `${usedBy.join(", ")} ${usedBy.length === 1 ? "uses" : "use"} it`
                  : "Bots use it"
              } as ${sample} …: each job uses the row a bot names in its answer ("${field}": a row's key).`
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </span>
      {rows.map((r, i) => (
        <div
          key={i}
          className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
          data-testid={`team-setting-${s.name}-row`}
        >
          <div className="flex flex-row gap-2 items-center">
            <div className="flex-1 min-w-0">
              <InputText
                ariaLabel={`${s.label || s.name} row ${i + 1} key`}
                value={r.key || ""}
                placeholder="Its key, e.g. dash-core"
                disabled={disabled}
                onChange={(v) => set(i, "key", v)}
              />
            </div>
            <Button3
              title="Remove"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onChange && onChange(rows.filter((_r, j) => j !== i))
              }
            />
          </div>
          {cols.map((c) =>
            c.type === "boolean" ? (
              <Checkbox
                key={c.name}
                label={c.label || c.name}
                checked={!!r[c.name]}
                disabled={disabled}
                onChange={(on) => set(i, c.name, !!on)}
              />
            ) : (
              <div key={c.name} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{c.label || c.name}</span>
                <InputText
                  ariaLabel={`${s.label || s.name} row ${i + 1} ${c.label || c.name}`}
                  value={
                    r[c.name] === undefined || r[c.name] === null
                      ? ""
                      : String(r[c.name])
                  }
                  disabled={disabled}
                  onChange={(v) => set(i, c.name, v)}
                />
              </div>
            ),
          )}
        </div>
      ))}
      <div>
        <Button3
          title="Add a row"
          size="sm"
          disabled={disabled}
          onClick={() => onChange && onChange([...rows, { key: "" }])}
        />
      </div>
      {empty ? (
        <span className={`text-xs ${status.warning.text}`}>{emptyText}</span>
      ) : null}
    </div>
  );
};

/**
 * A dashboard's team settings, loaded and saved (Bots › Team settings).
 * Nothing shows when the team declares none.
 *
 * On the team page's Set up checklist (DASH-128) it joins the page's one
 * save model: `onDirtyChange(dirty)` says when it has unsaved edits, and
 * with `hideSave` its own Save button is left out and the page's unsaved
 * bar saves or discards it through the ref ({ save() → ok, discard() }).
 */
export const TeamSettingsPanel = forwardRef(function TeamSettingsPanel(
  { workspaceId, onDirtyChange = null, hideSave = false },
  ref,
) {
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

  const changed =
    !!team &&
    team.declared.some(
      (s) =>
        JSON.stringify(draft[s.name]) !== JSON.stringify(team.values[s.name]),
    );
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    if (onDirtyRef.current) onDirtyRef.current(changed);
  }, [changed]);
  useEffect(
    () => () => {
      if (onDirtyRef.current) onDirtyRef.current(false);
    },
    [],
  );

  const save = async () => {
    if (!team || !changed) return true;
    if (!api || !api.setTeamValues) {
      setErrors(["Changing team settings needs a newer Dash."]);
      return false;
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
      if (r && r.errors && r.errors.length) {
        setErrors(r.errors);
        return false;
      }
      setSaved(true);
      noteSetupChanged(workspaceId);
      await load();
      return true;
    } catch (e) {
      setErrors([(e && e.message) || String(e)]);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setErrors([]);
    setSaved(false);
    setDraft((team && team.values) || {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ save, discard }), [team, draft, changed]);

  if (!team || !team.declared.length) return null;

  return (
    <section
      aria-label="Team settings"
      data-testid="team-settings-panel"
      className={`rounded-xl border p-4 flex flex-col gap-3 ${hairline}`}
    >
      <div className="flex flex-col gap-0.5">
        <SectionLabel text="Team settings" />
        <span className={`text-xs ${muted}`}>
          Settings this team's bots share. A change reaches every bot on its
          next run.
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
      {hideSave ? null : (
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
      )}
      {hideSave && saved && !changed ? (
        <span className={`text-xs ${status.success.text}`}>Saved.</span>
      ) : null}
    </section>
  );
});

export default TeamSettingsForm;
