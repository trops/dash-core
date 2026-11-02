/**
 * ProfileKeysOption.js — "Include keys and passwords" in the profile save
 * window, for a file or the account (dash-profiles, 2026-11-02; mockup
 * frames "save-off" / "save-on").
 *
 * Off: providers go with their settings but not their keys. On: the keys
 * and the passwords typed into widgets are locked with a phrase on this Mac
 * before anything leaves it. The phrase goes to the main process on its own
 * channel when the save starts (setKeysPhrase) — never with the save.
 */
import React from "react";
import { Checkbox, InputText, Switch } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "8 provider keys · 3 passwords typed into widgets" */
export function keysCountText(keys) {
  const k = keys || {};
  const parts = [];
  if (k.providers) parts.push(plural(k.providers, "provider key"));
  if (k.widgetSecrets) {
    parts.push(`${plural(k.widgetSecrets, "password")} typed into widgets`);
  }
  return parts.length ? parts.join(" · ") : "No keys or passwords to include.";
}

/**
 * What's wrong with the phrase as typed, or null. A remembered phrase may
 * be left empty (it's used again).
 */
export function phraseProblem({ phrase, again, remembered, remember }) {
  const p = String(phrase || "");
  if (!p && !String(again || "") && remembered) {
    return remember === false
      ? 'Type a phrase, or keep "Remember the phrase" on to use the one this Mac has.'
      : null;
  }
  if (p.trim().length < 12) {
    return "Use at least 12 characters — a few words works well.";
  }
  if (p !== String(again || "")) return "The two phrases don't match.";
  return null;
}

export const ProfileKeysOption = ({
  value,
  onChange,
  keys,
  disabled,
  canRemember = true,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const remembered = canRemember && !!(keys && keys.remembered);
  return (
    <section
      aria-label="Keys and passwords"
      className={`flex flex-col rounded-lg border ${hairline}`}
      data-testid="profile-keys-option"
    >
      <div className="flex flex-row items-center gap-3 p-3">
        <span className="flex-1 flex flex-col gap-1">
          <span className={`font-semibold ${strong}`}>
            Include keys and passwords
          </span>
          <span className={`text-xs ${muted}`}>
            {v.on
              ? "Locked with a phrase only you know. Sign-ins (Google, Slack) stay on this Mac — you sign in again there."
              : "Off: providers come along with their settings but not their keys — you add each key on the other Mac."}
          </span>
        </span>
        <Switch
          checked={!!v.on}
          disabled={disabled}
          ariaLabel="Include keys and passwords"
          onChange={(checked) => set({ on: checked })}
        />
      </div>
      {v.on ? (
        <div className={`flex flex-col gap-3 p-3 border-t ${hairline}`}>
          <span className={`text-xs ${strong}`}>{keysCountText(keys)}</span>
          {remembered ? (
            <span className={`text-xs ${muted}`}>
              A phrase is remembered on this Mac. Leave these empty to use it,
              or type a new one.
            </span>
          ) : null}
          <InputText
            label="Phrase to lock them"
            type="password"
            value={v.phrase || ""}
            disabled={disabled}
            autoComplete="new-password"
            spellCheck={false}
            ariaLabel="Phrase to lock them"
            onChange={(phrase) => set({ phrase })}
          />
          <InputText
            label="Type it again"
            type="password"
            value={v.again || ""}
            disabled={disabled}
            autoComplete="new-password"
            spellCheck={false}
            ariaLabel="Type it again"
            onChange={(again) => set({ again })}
          />
          <span className={`text-xs ${muted}`}>
            They&apos;re locked on this Mac before anything is sent. Dash and
            the registry can&apos;t read them — only this phrase opens them.
            Forget it, and the profile still loads, just without keys.
          </span>
          {canRemember ? (
            <Checkbox
              label="Remember the phrase on this Mac, so auto-save can lock new keys too"
              checked={v.remember === undefined ? remembered : !!v.remember}
              disabled={disabled}
              onChange={(remember) => set({ remember })}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default ProfileKeysOption;
