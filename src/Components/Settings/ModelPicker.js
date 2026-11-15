import React from "react";
import { SelectInput, StatusBadge } from "@trops/dash-react";
import { modelOptions } from "./modelChoices";

const badge = (kind, text) => <StatusBadge state={kind} label={text} />;

/**
 * ModelPicker — the one model choice every place shows: anything above the
 * groups (`first`: "Bots default", "Built in"), then Follows the newest
 * (Latest Opus, Sonnet, Haiku, Fable, each with what it is now) and Stays on
 * one version. Models that just came out are tagged New; ones going away,
 * Retiring; older ones are dimmed.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  label = "",
  ariaLabel = null,
  first = [],
  newIds = [],
  className = "",
  disabled = false,
}) {
  return (
    <SelectInput
      label={label}
      ariaLabel={ariaLabel}
      value={value || ""}
      onChange={onChange}
      className={className}
      disabled={disabled}
      options={modelOptions(models, {
        value: value || "",
        first,
        newIds,
        makeBadge: badge,
      })}
    />
  );
}

export default ModelPicker;
