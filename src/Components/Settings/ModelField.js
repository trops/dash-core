import React from "react";
import { ModelPicker } from "./ModelPicker";
import { useModelList } from "./useModelList";

/**
 * ModelField — a widget setting of type "model" (a Chat widget's Model):
 * the same model list as Settings › AI and a bot's Model, loaded here.
 */
export function ModelField({
  id = null,
  value,
  defaultValue = "",
  onChange,
  ariaLabel = "Model",
}) {
  const { models, status } = useModelList();
  return (
    <div id={id || undefined}>
      <ModelPicker
        ariaLabel={ariaLabel}
        models={models}
        value={value || defaultValue || ""}
        newIds={(status && status.added) || []}
        onChange={onChange}
      />
    </div>
  );
}

export default ModelField;
