import React, { useMemo, useState } from "react";
import {
  ButtonIcon,
  Caption2,
  FormLabel,
  InputText,
  Switch,
  useStatusTokens,
} from "@trops/dash-react";

/**
 * ProviderSettingField
 *
 * One renderer for a provider's settings (its catalog `credentialSchema`
 * fields, as returned by deriveFormFields): text / password, file,
 * directory-list, and — for built-in providers like Web Fetch
 * (bot-capabilities FR-C02a) — number, toggle and text-list.
 *
 * Values keep the shapes the main process already reads: numbers as typed
 * strings, toggles as booleans, lists as comma-joined strings.
 */

/** True when a setting has a value (booleans and 0 count). */
export function hasSettingValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function toBool(value, dflt) {
  if (typeof value === "boolean") return value;
  if (!hasSettingValue(value)) return dflt === undefined ? false : !!dflt;
  return !/^(false|0|no|off)$/i.test(String(value).trim());
}

/** An error message for this field's value, or null when it's valid. */
export function validateSettingField(field, value) {
  if (field.type === "toggle") return null;
  if (!hasSettingValue(value)) {
    return field.required ? `${field.displayName} is required` : null;
  }
  if (field.type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return `${field.displayName} must be a number`;
    const hasMin = typeof field.min === "number";
    const hasMax = typeof field.max === "number";
    if ((hasMin && n < field.min) || (hasMax && n > field.max)) {
      if (hasMin && hasMax) {
        return `${field.displayName} must be between ${field.min} and ${field.max}`;
      }
      return hasMin
        ? `${field.displayName} must be at least ${field.min}`
        : `${field.displayName} must be at most ${field.max}`;
    }
  }
  // `~` isn't expanded when the server process starts, so a tilde path
  // would never match a real one.
  if (field.type === "directory-list") {
    const bad = String(value)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .find((p) => !p.startsWith("/"));
    if (bad) {
      return `"${bad}" must be an absolute path (no \`~\`, use /Users/you/...)`;
    }
  }
  return null;
}

/**
 * Repeating rows for list settings. Keeps in-progress rows locally so a new
 * empty row shows immediately, even though empty rows are dropped from the
 * comma-joined value passed to `onChange`.
 */
const ListRows = ({ value, onChange, placeholder, chooseFolder }) => {
  const initialRows = useMemo(() => {
    const items = String(value || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return items.length ? items : [""];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState(initialRows);

  const update = (next) => {
    setRows(next);
    onChange(
      next
        .map((p) => p.trim())
        .filter(Boolean)
        .join(","),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((rowValue, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <div className="flex-1">
            <InputText
              type="text"
              value={rowValue}
              onChange={(v) => {
                const next = [...rows];
                next[idx] = v;
                update(next);
              }}
              placeholder={placeholder}
            />
          </div>
          {chooseFolder && (
            <ButtonIcon
              icon="folder-open"
              text="Choose folder…"
              onClick={async () => {
                const picked = await window.mainApi.dialog.chooseFile(
                  false,
                  [],
                );
                if (picked) {
                  const next = [...rows];
                  next[idx] = picked;
                  update(next);
                }
              }}
            />
          )}
          {rows.length > 1 && (
            <ButtonIcon
              icon="xmark"
              ariaLabel="Remove"
              onClick={() => {
                const next = rows.filter((_, i) => i !== idx);
                update(next.length ? next : [""]);
              }}
            />
          )}
        </div>
      ))}
      <div>
        <ButtonIcon
          icon="plus"
          text="Add"
          onClick={() => setRows([...rows, ""])}
        />
      </div>
    </div>
  );
};

export const ProviderSettingField = ({ field, value, onChange, error }) => {
  const statusTokens = useStatusTokens();

  const label = (
    <FormLabel title={field.displayName} required={field.required} />
  );
  const instructions = field.instructions ? (
    <Caption2 block>{field.instructions}</Caption2>
  ) : null;
  const errorText = error ? (
    <p className={`text-sm ${statusTokens.error.icon}`}>{error}</p>
  ) : null;

  let control;
  if (field.type === "toggle") {
    control = (
      <Switch
        label={field.displayName}
        checked={toBool(value, field.default)}
        onChange={(checked) => onChange(checked)}
      />
    );
    return (
      <div className="flex flex-col gap-2">
        {control}
        {instructions}
        {errorText}
      </div>
    );
  }

  if (field.type === "number") {
    control = (
      <div className="flex gap-2 items-center">
        <div className="w-40">
          <InputText
            type="number"
            min={field.min}
            max={field.max}
            step="any"
            value={hasSettingValue(value) ? String(value) : ""}
            onChange={(v) => onChange(v)}
            placeholder={
              field.default !== undefined ? String(field.default) : undefined
            }
          />
        </div>
        {(field.unit ||
          typeof field.min === "number" ||
          typeof field.max === "number") && (
          <Caption2>
            {[
              field.unit,
              typeof field.min === "number" && typeof field.max === "number"
                ? `(${field.min}–${field.max})`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Caption2>
        )}
      </div>
    );
  } else if (field.type === "text-list" || field.type === "directory-list") {
    control = (
      <ListRows
        value={value}
        onChange={onChange}
        chooseFolder={field.type === "directory-list"}
        placeholder={
          field.placeholder ||
          (field.type === "directory-list" ? "/Users/you/some/folder" : "")
        }
      />
    );
  } else {
    control = (
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <InputText
            type={field.secret ? "password" : "text"}
            value={hasSettingValue(value) ? String(value) : ""}
            onChange={(v) => onChange(v)}
            placeholder={
              field.placeholder ||
              (field.type === "file"
                ? "Select a file..."
                : `Enter ${String(field.displayName || "").toLowerCase()}`)
            }
          />
        </div>
        {field.type === "file" && (
          <ButtonIcon
            icon="file"
            text="Browse"
            onClick={async () => {
              const filepath = await window.mainApi.dialog.chooseFile(true, [
                "json",
              ]);
              if (filepath) onChange(filepath);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {label}
      {instructions}
      {control}
      {errorText}
    </div>
  );
};

export default ProviderSettingField;
