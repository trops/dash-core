import React, { useEffect, useMemo, useState } from "react";
import { Button, Button3, ButtonIcon3, SelectInput } from "@trops/dash-react";
import deepEqual from "deep-equal";
import { ComponentManager } from "../../ComponentManager";
import { forEachWidget } from "../../utils/providerResolution";
import {
  applyWiringChanges,
  formatEventString,
  parseEventString,
} from "../../utils/listenerResolution";
import { pickWidgetDisplayName } from "../../utils/widgetIdentity";
import { useBotEmitters } from "../Settings/details/useBotEmitters";
import { useConfigTokens } from "./ConfigListRow";
import { humanizeName, listenerRows } from "./widgetPanelText";

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * ListensFor — the widget panel's "Listens for" section (consolidation
 * Phase 3P): what this widget does when another widget or a bot sends an
 * event, one row each, with × to stop and "+ Listen for another widget" to
 * add one. Same wiring as the old Listeners editor (item.listeners,
 * applyWiringChanges); changes go to onUpdate(item, workspace) and wait for
 * the dashboard's Save.
 *
 * @param {object} item       the widget's layout item
 * @param {object} workspace  its page's workspace ({ ...dashboard, layout })
 * @param {string} name       the widget's name, for the empty lines
 * @param {(item: object, workspace: object) => void} onUpdate
 */
export const ListensFor = ({ item, workspace, name, onUpdate }) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [adding, setAdding] = useState(false);
  const [pickEvent, setPickEvent] = useState("");
  const [pickHandler, setPickHandler] = useState("");

  useEffect(() => {
    if (!deepEqual(item, itemSelected)) setItemSelected(item);
    if (!deepEqual(workspace, workspaceSelected))
      setWorkspaceSelected(workspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, workspace]);

  const handlers = Array.isArray(itemSelected?.eventHandlers)
    ? itemSelected.eventHandlers.filter((h, i, a) => h && a.indexOf(h) === i)
    : [];

  // Widgets on this dashboard that send events (not this one), and its bots.
  const widgetSources = useMemo(() => {
    const list = [];
    const seen = new Set();
    forEachWidget(workspaceSelected, (li) => {
      if (!li || !li.component) return;
      if (
        li.id === itemSelected?.id &&
        li.component === itemSelected?.component
      )
        return;
      if (!Array.isArray(li.events) || li.events.length === 0) return;
      const key = `${li.component}|${li.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(li);
    });
    return list;
  }, [workspaceSelected, itemSelected]);
  const botSources = useBotEmitters(workspaceSelected?.id) || [];

  const nameOf = (component, itemId) => {
    const bot = botSources.find(
      (b) => b.component === component && String(b.itemId) === String(itemId),
    );
    if (bot) return bot.name;
    const li = widgetSources.find(
      (w) => w.component === component && String(w.id) === String(itemId),
    );
    return li
      ? pickWidgetDisplayName(li, ComponentManager.config(li.component, li))
      : "";
  };

  const rows = listenerRows(itemSelected, nameOf);

  // Every event a source sends, for the picker.
  const eventOptions = [
    ...widgetSources.flatMap((li) =>
      li.events.map((event) => ({
        value: formatEventString(li.component, li.id, event),
        label: `${nameOf(li.component, li.id) || li.component} — ${humanizeName(event)}`,
      })),
    ),
    ...botSources.flatMap((bot) =>
      (bot.events || []).map((event) => ({
        value: formatEventString(bot.component, bot.itemId, event),
        label: `${bot.name} — ${
          (bot.eventLabels && bot.eventLabels[event]) || humanizeName(event)
        }`,
      })),
    ),
  ];

  const commit = ({ adds = [], removes = [] }) => {
    const nextWorkspace = applyWiringChanges(workspaceSelected, {
      adds,
      removes,
    });
    let nextItem = itemSelected;
    forEachWidget(nextWorkspace, (li) => {
      if (li?.id === itemSelected.id && li.component === itemSelected.component)
        nextItem = li;
    });
    setWorkspaceSelected(nextWorkspace);
    setItemSelected(nextItem);
    if (onUpdate) onUpdate(nextItem, nextWorkspace);
  };

  const wiring = (handler, eventString) => {
    const parsed = parseEventString(eventString);
    return parsed
      ? {
          receiverItemId: itemSelected.id,
          handlerName: handler,
          sourceComponent: parsed.component,
          sourceItemId: parsed.itemId,
          eventName: parsed.event,
          raw: eventString,
        }
      : null;
  };

  const add = () => {
    const handler = pickHandler || handlers[0];
    const change = handler && pickEvent ? wiring(handler, pickEvent) : null;
    if (!change) return;
    commit({ adds: [change] });
    setAdding(false);
    setPickEvent("");
    setPickHandler("");
  };

  if (handlers.length === 0) {
    return (
      <span className={`text-sm ${muted}`}>
        {name} doesn't react to other widgets or bots.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="listens-for">
      {rows.length === 0 && !adding ? (
        <span className={`text-sm ${muted}`}>Nothing yet.</span>
      ) : null}
      {rows.map((r) => (
        <div
          key={`${r.handler}|${r.eventString}`}
          className={`flex flex-row items-center gap-2 rounded-md border px-3 py-2 ${hairline} ${selectedBg}`}
        >
          <div className="flex flex-col flex-1 min-w-0">
            <span className={`text-sm font-medium ${strong}`}>
              {capitalize(humanizeName(r.event))}
            </span>
            <span className={`text-xs ${muted}`}>
              From {r.source}
              {handlers.length > 1
                ? ` → ${humanizeName(r.handler, { handler: true })}`
                : ""}
            </span>
          </div>
          <ButtonIcon3
            icon="xmark"
            ariaLabel={`Stop listening to ${r.source}`}
            onClick={() => {
              const change = wiring(r.handler, r.eventString);
              if (change) commit({ removes: [change] });
            }}
          />
        </div>
      ))}
      {adding ? (
        <div
          className={`flex flex-col gap-2 rounded-md border p-3 ${hairline}`}
        >
          {eventOptions.length === 0 ? (
            <span className={`text-sm ${muted}`}>
              No other widget or bot on this dashboard sends events yet.
            </span>
          ) : (
            <>
              <SelectInput
                label="When"
                value={pickEvent}
                onChange={setPickEvent}
                options={eventOptions}
                placeholder="Pick a widget or bot and what it sends"
              />
              {handlers.length > 1 ? (
                <SelectInput
                  label={`${name} should`}
                  value={pickHandler}
                  onChange={setPickHandler}
                  options={handlers.map((h) => ({
                    value: h,
                    label: capitalize(humanizeName(h, { handler: true })),
                  }))}
                  placeholder="Pick what it does"
                />
              ) : null}
            </>
          )}
          <div className="flex flex-row gap-2">
            {eventOptions.length > 0 ? (
              <Button
                title="Add"
                size="sm"
                onClick={add}
                disabled={!pickEvent || (handlers.length > 1 && !pickHandler)}
              />
            ) : null}
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => {
                setAdding(false);
                setPickEvent("");
                setPickHandler("");
              }}
            />
          </div>
        </div>
      ) : (
        <div>
          <Button3
            title="+ Listen for another widget"
            size="sm"
            onClick={() => setAdding(true)}
          />
        </div>
      )}
    </div>
  );
};
