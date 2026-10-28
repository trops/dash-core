import React, { useEffect, useState } from "react";
import { AlertBanner, InputText, SelectInput } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { savedWhenText } from "./SaveProfileModal";

const MODES = [
  { value: "manual", label: "Manually" },
  { value: "changes", label: "When I make changes" },
  { value: "daily", label: "Every day at…" },
];

/** What a mode does, in a sentence. */
export function autoSaveText(mode) {
  if (mode === "changes") {
    return "Saves to your account a moment after you change something. Nothing is published, and a newer copy from another computer is never overwritten.";
  }
  if (mode === "daily") {
    return "Saves at this time if anything changed — or the next time Dash opens, if it was closed then. A newer copy from another computer is never overwritten.";
  }
  return "Saves only when you choose Save to my account.";
}

/**
 * How a profile kept in the account saves itself (dash-profiles v3, Slice
 * 3): Manually (default), When I make changes, or Every day at a time —
 * with when it was last saved and, when the last try didn't save, why.
 */
export const AutoSaveSetting = ({ appId, profile, onChanged }) => {
  const { muted } = useConfigTokens();
  const current = profile.autoSave || { mode: "manual", time: "09:00" };
  const [mode, setMode] = useState(current.mode);
  const [time, setTime] = useState(current.time || "09:00");
  const [error, setError] = useState(null);

  useEffect(() => {
    setMode(current.mode);
    setTime(current.time || "09:00");
  }, [profile.id, current.mode, current.time]);

  async function apply(nextMode, nextTime) {
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.setAutoSave?.(appId, profile.id, {
        mode: nextMode,
        time: nextTime,
      });
    } catch (e) {
      res = { success: false, error: e?.message };
    }
    if (res && res.success) {
      if (onChanged) onChanged(res.autoSave);
      return;
    }
    // Not changed: show what it still is.
    setMode(current.mode);
    setTime(current.time || "09:00");
    setError(res?.error || "Couldn't change how it saves.");
  }

  const last = current.last;
  const saved = savedWhenText(profile.account || {});

  return (
    <div
      className="flex flex-col gap-2 max-w-md"
      data-testid="profile-auto-save"
    >
      <SelectInput
        label="Auto-save to your account"
        value={mode}
        onChange={(v) => {
          setMode(v);
          apply(v, time);
        }}
        options={MODES}
      />
      {mode === "daily" ? (
        <InputText
          label="Time"
          type="time"
          value={time}
          onChange={(v) => {
            setTime(v);
            if (/^\d{2}:\d{2}$/.test(String(v || ""))) apply("daily", v);
          }}
          ariaLabel="Time"
        />
      ) : null}
      <span className={`text-xs ${muted}`}>{autoSaveText(mode)}</span>
      {saved ? (
        <span className={`text-xs ${muted}`} data-testid="profile-last-saved">
          {`Last saved to your account: ${saved}`}
        </span>
      ) : null}
      {last && !last.ok && last.error && mode !== "manual" ? (
        <AlertBanner
          variant="warning"
          size="compact"
          message={`The last auto-save didn't save: ${last.error}`}
        />
      ) : null}
      {error ? (
        <AlertBanner variant="error" size="compact" message={error} />
      ) : null}
    </div>
  );
};
