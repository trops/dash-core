import { useState, useEffect, useRef, useCallback } from "react";
import { SelectMenu, InputText, FormField, Button3 } from "@trops/dash-react";
import { replaceItemInLayout } from "../../../../../utils/layout";
import { WorkspaceModel } from "../../../../../Models";
import deepEqual from "deep-equal";
import { ComponentManager } from "../../../../../ComponentManager";
import {
  KNOWN_TYPES,
  validateSetting,
  validateSettings,
} from "../../../../../utils/userConfigValidation";
import { useConfigTokens } from "../../../../Dashboard/ConfigListRow";

/** The id of a setting's field, so a Save that's held back can focus it. */
export const settingFieldId = (key) => `widget-setting-${key}`;

export const PanelEditItem = ({
  workspace,
  onUpdate,
  item = null,
  flushRef = null,
  // Each keystroke's settings ({ key: value }), before they're applied —
  // so the panel's Save bar shows at once (approved mockup frame 1).
  onDraft = null,
  // A Save that was held back: every failing field says why.
  showAllErrors = false,
}) => {
  const { muted } = useConfigTokens();
  const [touched, setTouched] = useState({});
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [, updateState] = useState();
  const forceUpdate = useCallback(() => updateState({}), []);

  // Refs that mirror the latest local state. Used by the unmount
  // cleanup and the flush handler — both run outside the normal
  // render cycle and can't rely on the closed-over state, since
  // closures capture state at the moment the function was created.
  const itemSelectedRef = useRef(itemSelected);
  const workspaceSelectedRef = useRef(workspaceSelected);
  const onUpdateRef = useRef(onUpdate);
  itemSelectedRef.current = itemSelected;
  workspaceSelectedRef.current = workspaceSelected;
  onUpdateRef.current = onUpdate;

  // True when local edits have not yet been propagated to the parent.
  // Set by handleTextChangeCustom, cleared by flushPending. The
  // unmount cleanup (below) consults this so a tab switch or modal
  // close doesn't drop the user's last few keystrokes.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (deepEqual(item, itemSelected) === false) {
      setItemSelected(() => item);
      forceUpdate();
    }

    if (deepEqual(workspace, workspaceSelected) === false) {
      setWorkspaceSelected(() => workspace);
      forceUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, item]);

  // Build the fresh workspace from the latest local item + propagate
  // to the parent. Returns `{item, workspace}` so callers (the
  // modal's Save handler) can read the new workspace synchronously,
  // sidestepping React's async setState — the parent's
  // workspaceSelected state won't reflect this call until the next
  // render, but the caller already has the new value in hand.
  //
  // Returns null when there's nothing to flush.
  function flushPending() {
    if (!dirtyRef.current) return null;
    const latestItem = itemSelectedRef.current;
    const latestWorkspace = workspaceSelectedRef.current;
    if (!latestItem || !latestWorkspace) return null;
    const workspaceTemp = WorkspaceModel(latestWorkspace);
    const newLayout = replaceItemInLayout(
      workspaceTemp.layout,
      latestItem["id"],
      latestItem,
    );
    workspaceTemp.layout = newLayout;
    dirtyRef.current = false;
    onUpdateRef.current(latestItem, workspaceTemp);
    return { item: latestItem, workspace: workspaceTemp };
  }

  // Expose flushPending via the ref the modal passes in. This is how
  // the modal's Save handler triggers one final propagation before
  // calling onSaveWorkspace — without it, the modal would save the
  // workspace as it stood before the user's last typing burst.
  useEffect(() => {
    if (!flushRef) return undefined;
    flushRef.current = flushPending;
    return () => {
      if (flushRef.current === flushPending) flushRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushRef]);

  // Final flush on unmount. Triggers when the user switches sidebar
  // tabs (the modal conditionally renders only the active section,
  // so switching unmounts PanelEditItem) or closes the modal without
  // saving. The parent modal is still mounted at this point, so
  // calling onUpdate from cleanup is safe.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) flushPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderCustomSettings() {
    if (itemSelected) {
      const componentConfig = ComponentManager.getComponent(
        itemSelected.component,
      );
      if (componentConfig === null || componentConfig === undefined) {
        return null;
      }
      if ("userConfig" in componentConfig) {
        const userConfig = componentConfig["userConfig"];
        // Read userPrefs straight off the locally-tracked itemSelected.
        // LayoutModel() resets `userPrefs` to widgetConfig template
        // defaults and only merges back `obj.userConfigValues` (the
        // EnhancedWidgetDropdown add-time field), silently dropping
        // `obj.userPrefs`. Piping through it on every render strips
        // the in-flight typed value and snaps the controlled InputText
        // back to "", which is what made these inputs untypeable —
        // user typing "airports" was seeing only the last char land.
        const userPrefs =
          itemSelected.userPrefs && typeof itemSelected.userPrefs === "object"
            ? itemSelected.userPrefs
            : {};

        return Object.keys(userConfig).map((key) => {
          if (key in userPrefs) {
            const configItem = userConfig[key];
            const { instructions, displayName, required } = configItem;

            return renderFormItem(
              displayName,
              key,
              instructions,
              required,
              userPrefs[key],
              handleTextChangeCustom,
              configItem,
            );
          }
          return null;
        });
      }
    }
    return null;
  }

  // The settings that already failed when the panel opened say so at once.
  const [failedAtOpen] = useState(() => {
    const cfg = item && ComponentManager.getComponent(item.component);
    const prefs = (item && item.userPrefs) || {};
    return cfg && cfg.userConfig
      ? validateSettings(
          cfg.userConfig,
          prefs,
          Object.keys(cfg.userConfig).filter((k) => k in prefs),
        )
      : {};
  });

  function handleTextChangeCustom(key, value) {
    const newItem = JSON.parse(JSON.stringify(itemSelected));
    if ("userPrefs" in itemSelected === false) {
      newItem["userPrefs"] = {};
    }
    newItem["userPrefs"][key] = value;
    // Update LOCAL state synchronously so the controlled InputText
    // reflects the typed character on the very next render. The
    // expensive workspace clone + parent-tree re-render is DEFERRED
    // until Save (via flushRef) or unmount (tab switch). Pre-defer
    // behavior: every keystroke deep-cloned the workspace and
    // re-rendered the whole modal subtree (sidebar + body + footer),
    // which made even short strings feel sluggish — characters
    // landed but the input lagged.
    setItemSelected(() => newItem);
    dirtyRef.current = true;
    if (onDraft) onDraft(newItem.userPrefs);
  }

  // Shown under a field once it was left (blur), when it already failed as
  // the panel opened, or after a Save that it held back (showAllErrors) —
  // never while the first characters are still being typed.
  function errorShown(key) {
    return showAllErrors || touched[key] || failedAtOpen[key];
  }

  function renderFormItem(
    displayName,
    key,
    instructions,
    required,
    value,
    onChange,
    configItem,
  ) {
    const type = configItem["type"] || "text";
    const known = KNOWN_TYPES.includes(type);
    const check = validateSetting(configItem, value, key);
    const error = check.error && errorShown(key) ? check.error : null;
    const fieldId = settingFieldId(key);
    const leave = () => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
    const text = (props = {}) => (
      <InputText
        id={fieldId}
        name={key}
        value={value ?? ""}
        onChange={(v) => onChange(key, v)}
        onBlur={leave}
        inputClassName="text-sm"
        {...props}
      />
    );
    let field = null;
    if (type === "select") {
      field = (
        <SelectMenu
          id={fieldId}
          name={key}
          selectedValue={value}
          onChange={(e) => onChange(key, e.target.value)}
          textSize="text-xs"
          className="font-normal"
        >
          {"options" in configItem &&
            configItem.options.map((option) => (
              <option
                key={String(option.value)}
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
      );
    } else if (type === "secret") {
      field = text({ type: "password" });
    } else if (type === "number") {
      // A number is kept as one when it reads as one; anything else is kept
      // as typed, so the check can say what's wrong (never a dropped key).
      field = text({
        type: "text",
        inputMode: "decimal",
        onChange: (v) => {
          const t = String(v);
          const n = Number(t);
          onChange(key, t.trim() !== "" && Number.isFinite(n) ? n : t);
        },
      });
    } else if (type === "url") {
      field = text({ type: "text", inputMode: "url", autoComplete: "off" });
    } else if (type === "email") {
      field = text({ type: "text", inputMode: "email", autoComplete: "off" });
    } else {
      field = text({ type: "text" });
    }
    return (
      <div
        key={`config-item-${key}`}
        className="flex flex-col gap-1"
        data-setting={key}
      >
        <FormField
          label={displayName || key}
          description={instructions || null}
          required={required === true}
          error={error}
        >
          {field}
        </FormField>
        {error && check.suggestion ? (
          <div className="flex flex-row flex-wrap items-center gap-2 text-xs">
            <span>Did you mean {check.suggestion}?</span>
            <Button3
              title="Use this"
              size="sm"
              onClick={() => {
                onChange(key, check.suggestion);
                setTouched((t) => ({ ...t, [key]: true }));
              }}
            />
          </div>
        ) : null}
        {!known ? (
          <span className={`text-xs ${muted}`}>
            Shown as text: this widget asked for a “{type}” setting, which Dash
            doesn't know.
          </span>
        ) : null}
      </div>
    );
  }

  const hasCustomSettings =
    itemSelected &&
    ComponentManager.getComponent(itemSelected.component)?.userConfig;

  return (
    itemSelected &&
    workspaceSelected && (
      // Under the widget panel's own "Settings" heading (consolidation
      // Phase 3P) — no heading or scroll box of its own.
      <div className="flex flex-col space-y-3">
        {hasCustomSettings && renderCustomSettings()}
      </div>
    )
  );
};

export default PanelEditItem;
