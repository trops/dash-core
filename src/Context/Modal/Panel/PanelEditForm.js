import React from "react";
import { InputText, SelectMenu } from "@trops/dash-react";

/**
 * PanelEditForm
 *
 * Pure presentational renderer for a widget's userConfig schema.
 * Extracted from PanelEditContext so that both the single-widget
 * settings modal and the new dashboard-level WidgetSettingsModal can
 * render identical form UI from the same source.
 *
 * @param {object}  props.userConfig   The widget's userConfig schema from its .dash.js
 *                                     (map of fieldKey → { type, displayName, instructions, required, options, ... }).
 * @param {object}  props.userPrefs    The widget instance's current values keyed by field name.
 * @param {(key: string, value: any) => void} props.onFieldChange
 *                                     Called when a field value changes. Callers persist by
 *                                     writing `value` into userPrefs[key] and saving.
 */
export const PanelEditForm = ({ userConfig, userPrefs, onFieldChange }) => {
  if (!userConfig || Object.keys(userConfig).length === 0) return null;

  return (
    <>
      {Object.keys(userConfig).map((key) => {
        const configItem = userConfig[key];
        const { instructions, displayName, required } = configItem;
        const value = userPrefs?.[key] ?? "";
        return renderFormItem(
          displayName,
          key,
          instructions,
          required,
          value,
          onFieldChange,
          configItem,
        );
      })}
    </>
  );
};

function renderFormItem(
  displayName,
  key,
  instructions,
  required,
  value,
  onChange,
  configItem,
) {
  return (
    <div
      key={`config-item-${key}`}
      className={`rounded flex flex-col p-2 space-y-1`}
    >
      <span className="text-gray-400 font-bold text-sm">
        {displayName}{" "}
        {required === true && <span className="text-red-500">*</span>}
      </span>
      {instructions && (
        <div className="text-xs text-gray-400 pb-1">{instructions}</div>
      )}
      {configItem["type"] === "text" && (
        <InputText
          type="text"
          name={key}
          value={value}
          onChange={(v) => onChange(key, v)}
          inputClassName="text-sm"
        />
      )}
      {configItem["type"] === "secret" && (
        <InputText
          type="password"
          name={key}
          value={value}
          onChange={(v) => onChange(key, v)}
          inputClassName="text-sm"
        />
      )}
      {configItem["type"] === "select" && (
        <SelectMenu
          name={key}
          selectedValue={value}
          onChange={(e) => onChange(key, e)}
          textSize="text-xs"
          className="font-normal"
        >
          {"options" in configItem &&
            configItem.options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className={"text-sm"}
              >
                {option.displayName}
              </option>
            ))}
          {"optionsValues" in configItem && (
            <option>{configItem["optionsValues"]}</option>
          )}
        </SelectMenu>
      )}
    </div>
  );
}

export default PanelEditForm;
