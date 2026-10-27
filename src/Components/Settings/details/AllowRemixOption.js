import React from "react";
import { Checkbox } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/**
 * "Allow remixes" in the Publish dialogs (widgets, dashboards, themes,
 * bots). Until the user changes it, it follows the visibility — public may
 * be remixed, private (shared or, later, paid) may not — and nothing is
 * sent, so the package keeps following its visibility (registry 1.9.0).
 *
 * @param {boolean|null} value  the user's choice, or null (follow visibility)
 */
export function AllowRemixOption({ visibility, value, onChange, disabled }) {
  const { muted } = useConfigTokens();
  const checked =
    value === null || value === undefined ? visibility !== "private" : !!value;
  return (
    <div className="flex flex-col gap-1" data-testid="allow-remix-option">
      <Checkbox
        label="Allow remixes"
        checked={checked}
        disabled={disabled}
        onChange={(on) => onChange(!!on)}
      />
      <span className={`text-xs ${muted}`}>
        Others can publish their own version, credited to you.
        {visibility === "private"
          ? " Off by default for private packages, so the people you share it with can't republish it."
          : ""}
      </span>
    </div>
  );
}

/** The publish option to send: only when the user chose. */
export function allowRemixOption(value) {
  return typeof value === "boolean" ? { allowRemix: value } : {};
}
