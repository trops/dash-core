import { useState, useEffect, useCallback, useContext } from "react";
import {
  SelectMenu,
  InputText,
  SubHeading3,
  FormLabel,
  Switch,
} from "@trops/dash-react";
import { replaceItemInLayout } from "../../../../../utils/layout";
import { LayoutModel, WorkspaceModel } from "../../../../../Models";
import deepEqual from "deep-equal";
import { ComponentManager } from "../../../../../ComponentManager";
import { AppContext } from "../../../../../Context/App/AppContext";

export const PanelEditItem = ({ workspace, onUpdate, item = null }) => {
  const appContext = useContext(AppContext);
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [, updateState] = useState();
  const forceUpdate = useCallback(() => updateState({}), []);

  const allProviders = appContext?.providers || {};
  const widgetConfig = itemSelected
    ? ComponentManager.config(itemSelected.component, itemSelected)
    : null;
  const providerRequirements = widgetConfig?.providers || [];
  const selectedProviders = itemSelected?.selectedProviders || {};
  const notificationDefs = widgetConfig?.notifications || [];

  // Notification preferences for this widget instance
  const [notifPrefs, setNotifPrefs] = useState({});
  const widgetUuid = itemSelected?.uuid || itemSelected?.uuidString;

  useEffect(() => {
    if (notificationDefs.length > 0 && widgetUuid && window.mainApi?.notifications?.getPreferences) {
      window.mainApi.notifications.getPreferences().then((result) => {
        setNotifPrefs(result.instances?.[widgetUuid] || {});
      });
    }
  }, [widgetUuid, notificationDefs.length]);

  function handleNotifToggle(typeKey, value) {
    const updated = { ...notifPrefs, [typeKey]: value };
    setNotifPrefs(updated);
    if (window.mainApi?.notifications?.setPreferences && widgetUuid) {
      window.mainApi.notifications.setPreferences(widgetUuid, { [typeKey]: value });
    }
  }

  function getNotifEnabled(typeKey, defaultEnabled) {
    if (typeof notifPrefs[typeKey] === "boolean") return notifPrefs[typeKey];
    return defaultEnabled;
  }

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

  function handleUpdate(e, data) {
    const workspaceTemp = WorkspaceModel(workspaceSelected);
    const newLayout = replaceItemInLayout(
      workspaceTemp.layout,
      data["id"],
      data,
    );
    workspaceTemp.layout = newLayout;
    onUpdate(data, workspaceTemp);
    forceUpdate();
  }

  function handleProviderChange(providerType, providerId) {
    const newItem = JSON.parse(JSON.stringify(itemSelected));
    newItem.selectedProviders = newItem.selectedProviders || {};
    newItem.selectedProviders[providerType] = providerId;

    const workspaceTemp = WorkspaceModel(workspaceSelected);
    const newLayout = replaceItemInLayout(
      workspaceTemp.layout,
      newItem["id"],
      newItem,
    );
    workspaceTemp.layout = newLayout;

    // Also update workspace-level selectedProviders
    const uuid = newItem.uuid || newItem.uuidString;
    if (uuid) {
      workspaceTemp.selectedProviders = workspaceTemp.selectedProviders || {};
      workspaceTemp.selectedProviders[uuid] = {
        ...(workspaceTemp.selectedProviders[uuid] || {}),
        [providerType]: providerId,
      };
    }

    onUpdate(newItem, workspaceTemp);
    forceUpdate();
  }

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
        const layoutItem = LayoutModel(itemSelected, workspaceSelected);
        const userPrefs = layoutItem.userPrefs;

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
    handleUpdate(null, newItem);
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

        {providerRequirements.length > 0 && (
          <div className="flex flex-col space-y-3">
            <SubHeading3 title="Providers" padding={false} />
            {providerRequirements.map((req) => {
              const providerType = req.type;
              const currentSelection = selectedProviders[providerType] || "";

              const availableProviders = Object.entries(allProviders)
                .filter(([, p]) => p.type === providerType)
                .map(([name, p]) => ({ name, ...p }));

              return (
                <div key={providerType} className="flex flex-col space-y-1">
                  <div className="flex items-center gap-1">
                    <FormLabel title={providerType} textSize="text-sm" />
                    {req.required && (
                      <span className="text-red-500 text-sm">*</span>
                    )}
                  </div>
                  <SelectMenu
                    name={`provider-${providerType}`}
                    textSize="text-sm"
                    selectedValue={currentSelection}
                    onChange={(e) =>
                      handleProviderChange(providerType, e.target.value)
                    }
                  >
                    <option value="">-- Select Provider --</option>
                    {availableProviders.map((provider) => (
                      <option key={provider.name} value={provider.name}>
                        {provider.name}
                      </option>
                    ))}
                  </SelectMenu>
                  {availableProviders.length === 0 && (
                    <span className="text-xs opacity-40">
                      No {providerType} providers configured
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {notificationDefs.length > 0 && (
          <div className="flex flex-col space-y-3">
            <SubHeading3 title="Notifications" padding={false} />
            {notificationDefs.map((notif) => (
              <div
                key={notif.key}
                className="flex flex-row items-center justify-between py-1"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{notif.displayName}</span>
                  {notif.description && (
                    <span className="text-xs opacity-50">
                      {notif.description}
                    </span>
                  )}
                </div>
                <Switch
                  checked={getNotifEnabled(notif.key, notif.defaultEnabled)}
                  onChange={(value) => handleNotifToggle(notif.key, value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  );
};

export default PanelEditItem;
