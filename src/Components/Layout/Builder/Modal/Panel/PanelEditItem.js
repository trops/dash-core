import { useState, useEffect, useRef, useCallback } from "react";
import {
  SelectMenu,
  InputText,
  SubHeading3,
  FormLabel,
} from "@trops/dash-react";
import { replaceItemInLayout } from "../../../../../utils/layout";
import { WorkspaceModel } from "../../../../../Models";
import deepEqual from "deep-equal";
import { ComponentManager } from "../../../../../ComponentManager";

export const PanelEditItem = ({
  workspace,
  onUpdate,
  item = null,
  flushRef = null,
}) => {
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
    return (
      <div key={`config-item-${key}`} className="flex flex-col space-y-1">
        <div className="flex items-center gap-1">
          <FormLabel title={displayName} textSize="text-sm" />
          {required === true && <span className="text-red-500 text-sm">*</span>}
        </div>
        {instructions && (
          <div className="text-xs opacity-50 pb-1">{instructions}</div>
        )}
        {configItem["type"] === "text" && (
          <InputText
            type="text"
            name={key}
            value={value}
            onChange={(value) => onChange(key, value)}
            inputClassName="text-sm"
          />
        )}
        {configItem["type"] === "secret" && (
          <InputText
            type="password"
            name={key}
            value={value}
            onChange={(value) => onChange(key, value)}
            inputClassName="text-sm"
          />
        )}
        {configItem["type"] === "number" && (
          <InputText
            type="number"
            name={key}
            value={value}
            onChange={(value) => {
              const num = Number(value);
              if (value === "" || isNaN(num)) return;
              if (configItem.min != null && num < configItem.min) return;
              if (configItem.max != null && num > configItem.max) return;
              onChange(key, num);
            }}
            inputClassName="text-sm"
            min={configItem.min}
            max={configItem.max}
            step={configItem.step ?? 1}
          />
        )}
        {configItem["type"] === "select" && (
          <SelectMenu
            name={key}
            selectedValue={value}
            onChange={(e) => onChange(key, e.target.value)}
            textSize="text-xs"
            className="font-normal"
          >
            {"options" in configItem &&
              configItem.options.map((option) => {
                return (
                  <option value={option.value} className={"text-sm"}>
                    {option.displayName}
                  </option>
                );
              })}
            {"optionsValues" in configItem && (
              <option>{configItem["optionsValues"]}</option>
            )}
          </SelectMenu>
        )}
      </div>
    );
  }

  const hasCustomSettings =
    itemSelected &&
    ComponentManager.getComponent(itemSelected.component)?.userConfig;

  return (
    itemSelected &&
    workspaceSelected && (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {hasCustomSettings && (
          <div className="flex flex-col space-y-3">
            <SubHeading3 title="Configuration" padding={false} />
            {renderCustomSettings()}
          </div>
        )}

        {/* Provider bindings used to render here. They now live in
            their own "Providers" sidebar section (PanelEditItemProviders)
            so the Settings panel stays focused on userConfig only. */}
      </div>
    )
  );
};

export default PanelEditItem;
