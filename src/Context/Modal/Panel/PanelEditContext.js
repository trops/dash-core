import React, { useState, useEffect, useContext } from "react";
import { Panel, InputText } from "@trops/dash-react";
import deepEqual from "deep-equal";
import { ThemeContext } from "../../";
import { PanelEditForm } from "./PanelEditForm";

/**
 * Build the scoped registry identifier for a widget instance, using
 * whatever identity fields are on the layout item. Prefers the
 * canonical `scope.packageName.component` triple; falls back to
 * `packageName.component` or just the component name when the item
 * lacks scope/package info (e.g. bare built-ins). Returns null when
 * there's nothing meaningful to show.
 */
function buildScopedWidgetId(item) {
  if (!item) return null;
  const component = item.component || null;
  if (!component) return null;
  const scope = item.scope || item.registryScope || item.publishScope || null;
  const pkgName = item.packageName || item.package || null;
  if (scope && pkgName) {
    const bareScope = String(scope).replace(/^@/, "");
    const barePkg = String(pkgName).replace(new RegExp(`^@?${bareScope}/`), "");
    return `${bareScope}.${barePkg}.${component}`;
  }
  if (pkgName) return `${String(pkgName).replace(/^@/, "")}.${component}`;
  return component;
}

export const PanelEditContext = ({ onUpdate, item }) => {
  useContext(ThemeContext);

  const [itemSelected, setItemSelected] = useState(item);
  const [, updateState] = React.useState();
  const forceUpdate = React.useCallback(() => updateState({}), []);

  useEffect(() => {
    console.log("panel edit item", item);
    if (deepEqual(item, itemSelected) === false) {
      console.log("COMPARE CHECK DIFFERENT!");
      setItemSelected(() => item);
      forceUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  function handleSaveChanges(itemData) {
    if (itemData !== null) {
      console.log("handleSaveChanges ", itemData);
      onUpdate(itemData);
      setItemSelected(null);
    }
  }

  // function handleUpdate(e, data) {
  //     console.log("handling update ", e, data);

  //     const workspaceTemp = WorkspaceModel(workspaceSelected);
  //     const newLayout = replaceItemInLayout(
  //         workspaceTemp.layout,
  //         data["id"],
  //         data
  //     );
  //     workspaceTemp.layout = newLayout;

  //     // setWorkspaceSelected(() => workspaceTemp);
  //     // setItemSelected(() => data);
  //     onUpdate(data, workspaceTemp);
  //     forceUpdate();
  // }

  function renderCustomSettings() {
    if (!itemSelected) return null;
    if (!("userConfig" in itemSelected)) return null;
    return (
      <PanelEditForm
        userConfig={itemSelected.userConfig}
        userPrefs={itemSelected.userPrefs || {}}
        onFieldChange={handleTextChangeCustom}
      />
    );
  }

  function handleTextChangeCustom(key, value) {
    // Native <select> onChange fires with the event object; unwrap to
    // the raw string value so userPrefs stores a primitive, not an
    // SyntheticEvent. PanelEditForm normalizes its own text/secret
    // inputs to pass the string directly, so only selects need this.
    const resolvedValue =
      value && typeof value === "object" && "target" in value
        ? value.target.value
        : value;
    const newItem = JSON.parse(JSON.stringify(itemSelected));
    if ("userPrefs" in itemSelected === false) {
      newItem["userPrefs"] = {};
    }
    newItem["userPrefs"][key] = resolvedValue;
    onUpdate(newItem);
  }

  return (
    itemSelected && (
      <Panel padding={false} border={false}>
        <div className={`flex flex-col w-full h-full overflow-clip`}>
          <div className="flex flex-col w-full h-full overflow-clip">
            <div className="flex flex-row w-full h-full overflow-clip space-x-4 justify-between">
              {/* <div className="flex-col h-full rounded font-medium text-gray-400 w-full hidden xl:flex lg:w-1/3">
                        <div className="flex flex-col rounded p-4 py-10 space-y-4">
                            <p
                                className={`text-5xl font-bold ${theme["text-secondary-very-light"]}`}
                            >
                                Settings
                            </p>
                            <p
                                className={`text-xl font-normal ${theme["text-secondary-light"]}`}
                            >
                                Some widgets may have additional configuration settings that you can change here.
                            </p>
                            <p
                                className={`text-xl font-normal ${theme["text-secondary-light"]}`}
                            >
                                You may be required to enter some additional information e.g, API Keys, etc.    
                            </p>
        
                        </div>
                    </div> */}

              <div
                className={`flex flex-col w-full h-full rounded p-2 space-y-2`}
              >
                <div className="flex flex-col w-full space-y-2 h-full overflow-y-auto">
                  <div className="flex flex-col w-full">
                    {/* Scoped identifier — the `scope.packageName.component`
                        string that identifies this widget across the
                        registry. Surfaces the registry identity so users
                        can diagnose install warnings ("why did this
                        widget fail to install from the dashboard?"),
                        debug remix lookups, and verify the published
                        scope after a republish. Hidden when insufficient
                        data is present (e.g. built-ins without a scope). */}
                    {buildScopedWidgetId(itemSelected) && (
                      <div className="rounded flex flex-col px-2 pt-2 pb-1">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">
                          Registry Identifier
                        </span>
                        <code
                          className="text-[11px] text-gray-400 font-mono truncate"
                          title={buildScopedWidgetId(itemSelected)}
                        >
                          {buildScopedWidgetId(itemSelected)}
                        </code>
                      </div>
                    )}

                    {/* name given by the user to identify the context */}
                    <div
                      key={`config-item-name}`}
                      className={`rounded flex flex-col p-2 space-y-1`}
                    >
                      <span className="text-gray-400 font-bold text-sm">
                        {"Name"} <span className="text-red-500">*</span>
                      </span>
                      <div className="text-xs text-gray-400 pb-1">
                        The display name for the context.
                      </div>
                      <InputText
                        type="text"
                        name={"display_name"}
                        value={itemSelected.name || ""}
                        onChange={(value) =>
                          handleSaveChanges({
                            ...itemSelected,
                            name: value,
                          })
                        }
                        inputClassName="text-sm"
                      />
                    </div>

                    {renderCustomSettings()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    )
  );
};

export default PanelEditContext;
