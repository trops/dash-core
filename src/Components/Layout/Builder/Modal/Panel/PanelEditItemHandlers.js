import { useState, useEffect } from "react";
import { FontAwesomeIcon, Sidebar, SubHeading3 } from "@trops/dash-react";
import { forEachWidget } from "../../../../../utils/providerResolution";
import {
  formatEventString,
  parseEventString,
  applyWiringChanges,
} from "../../../../../utils/listenerResolution";
import {
  pickWidgetDisplayName,
  pickWidgetRef,
} from "../../../../../utils/widgetIdentity";
import deepEqual from "deep-equal";
import { SectionLayout } from "../../../../Settings/SectionLayout";

/**
 * PanelEditItemHandlers
 *
 * Per-widget listener editor (opens from a widget's overflow menu).
 * Lets the user wire one widget's event handlers to events emitted by
 * other widgets in the same workspace.
 *
 * Two earlier bugs lived here:
 *   1. The right-hand source list double-counted widgets because
 *      `pages[0].layout === workspace.layout` (shared reference set
 *      by WorkspaceModel when no explicit pages exist). The fix is
 *      `forEachWidget` — same canonical dedup the dashboard-config
 *      Listeners tab uses.
 *   2. Saves silently failed when the receiver widget lived in a page
 *      or the sidebar — `getLayoutItemById` only searched
 *      `workspace.layout`. The fix is `applyWiringChanges`, which
 *      walks every layout location.
 */
export const PanelEditItemHandlers = ({ workspace, onUpdate, item = null }) => {
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [eventHandlerSelected, setEventHandlerSelected] = useState(null);

  useEffect(() => {
    if (deepEqual(item, itemSelected) === false) {
      setItemSelected(() => item);
    }

    if (deepEqual(workspace, workspaceSelected) === false) {
      setWorkspaceSelected(() => workspace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, item]);

  // Build the deduped list of source widgets — every widget in the
  // workspace that emits at least one event AND isn't the receiver
  // itself. forEachWidget dedupes by `${component}|${id}` so a widget
  // referenced from multiple locations (root layout AND pages) shows
  // up once.
  const sourceWidgets = (() => {
    const list = [];
    const seen = new Set();
    forEachWidget(workspaceSelected, (li) => {
      if (!li || !li.component) return;
      if (li.component === "Container" || li.component === "LayoutContainer") {
        return;
      }
      if (
        li.id === itemSelected?.id &&
        li.component === itemSelected?.component
      ) {
        return;
      }
      if (!Array.isArray(li.events) || li.events.length === 0) return;
      const key = `${li.component}|${li.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(li);
    });
    return list;
  })();

  function handleSelectEventHandler(handler) {
    setEventHandlerSelected(() => handler);
  }

  function commitChange({ adds = [], removes = [] }) {
    if (!workspaceSelected || !itemSelected) return;
    if (adds.length === 0 && removes.length === 0) return;
    const nextWorkspace = applyWiringChanges(workspaceSelected, {
      adds,
      removes,
    });
    // Find the post-change receiver item so the parent's onUpdate
    // gets the updated layout-item shape (some callers cache it).
    let nextItem = itemSelected;
    forEachWidget(nextWorkspace, (li) => {
      if (
        li?.id === itemSelected.id &&
        li.component === itemSelected.component
      ) {
        nextItem = li;
      }
    });
    setWorkspaceSelected(nextWorkspace);
    setItemSelected(nextItem);
    onUpdate(nextItem, nextWorkspace);
  }

  function handleSelectEvent(eventString) {
    if (!eventString || !eventHandlerSelected) return;
    const parsed = parseEventString(eventString);
    if (!parsed) return;
    commitChange({
      adds: [
        {
          receiverItemId: itemSelected.id,
          handlerName: eventHandlerSelected,
          sourceComponent: parsed.component,
          sourceItemId: parsed.itemId,
          eventName: parsed.event,
        },
      ],
    });
  }

  function handleRemoveEvent(eventString) {
    if (!eventString || !eventHandlerSelected) return;
    const parsed = parseEventString(eventString);
    if (!parsed) return;
    commitChange({
      removes: [
        {
          receiverItemId: itemSelected.id,
          handlerName: eventHandlerSelected,
          sourceComponent: parsed.component,
          sourceItemId: parsed.itemId,
          eventName: parsed.event,
          raw: eventString,
        },
      ],
    });
  }

  function isSelectedEvent(event) {
    if (!event || !eventHandlerSelected) return false;
    const itemListeners = itemSelected?.["listeners"] || {};
    const list = itemListeners[eventHandlerSelected];
    return Array.isArray(list) && list.includes(event);
  }

  // Get the event handlers for the current item
  const eventHandlers = Array.isArray(itemSelected?.eventHandlers)
    ? itemSelected.eventHandlers.filter(
        (value, index, array) => array.indexOf(value) === index,
      )
    : [];

  // Build a set of valid event strings so we only count "connected"
  // listeners that still point at a live emitter. Stale references
  // are dropped from the count even before pruneDeadListenerReferences
  // runs on the next save.
  const validEventStrings = new Set();
  sourceWidgets.forEach((li) => {
    if (Array.isArray(li.events)) {
      li.events.forEach((event) => {
        validEventStrings.add(formatEventString(li.component, li.id, event));
      });
    }
  });

  // Get the listeners for the current item, filtering out orphaned references
  const rawListeners = itemSelected ? itemSelected["listeners"] || {} : {};
  const listeners = {};
  Object.keys(rawListeners).forEach((handler) => {
    const events = rawListeners[handler];
    if (Array.isArray(events)) {
      const validEvents = events.filter((e) => validEventStrings.has(e));
      if (validEvents.length > 0) {
        listeners[handler] = validEvents;
      }
    }
  });

  function getConnectedCount(handler) {
    return (listeners[handler] || []).length;
  }

  // Build the list content (left column)
  const listContent = (
    <Sidebar.Content>
      <div className="px-3 py-2 text-xs font-semibold opacity-40 uppercase tracking-wider">
        Event Handlers
      </div>
      {eventHandlers.map((handler) => {
        const count = getConnectedCount(handler);
        const isActive = eventHandlerSelected === handler;
        return (
          <Sidebar.Item
            key={handler}
            icon={<FontAwesomeIcon icon="bolt" className="h-3.5 w-3.5" />}
            active={isActive}
            onClick={() => handleSelectEventHandler(handler)}
            badge={count > 0 ? String(count) : null}
            className={isActive ? "bg-white/10 opacity-100" : ""}
          >
            {handler}
          </Sidebar.Item>
        );
      })}
      {eventHandlers.length === 0 && (
        <span className="text-sm opacity-40 py-8 text-center">
          No handlers available
        </span>
      )}
    </Sidebar.Content>
  );

  // Build the detail content (right column) — when a handler is selected
  const connectedCount = eventHandlerSelected
    ? getConnectedCount(eventHandlerSelected)
    : 0;

  const detailContent = eventHandlerSelected ? (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        <div className="flex flex-col space-y-1">
          <SubHeading3 title={eventHandlerSelected} padding={false} />
          <span className="text-sm opacity-70">
            {connectedCount} event
            {connectedCount !== 1 ? "s" : ""} connected
          </span>
        </div>

        {sourceWidgets.map((layout) => {
          const label = pickWidgetDisplayName(layout, null);
          const ref = pickWidgetRef(layout) || layout.component;
          return (
            <div
              key={`${layout.component}|${layout.id}`}
              className="flex flex-col space-y-2"
            >
              <div className="flex flex-col gap-0.5 mb-1">
                <span className="text-sm font-semibold opacity-90">
                  {label}
                </span>
                <span className="text-[10px] opacity-50 font-mono truncate">
                  {ref}[{layout["id"]}]
                </span>
              </div>
              {layout.events
                .filter((value, index, array) => array.indexOf(value) === index)
                .map((event) => {
                  const eventString = formatEventString(
                    layout.component,
                    layout.id,
                    event,
                  );
                  const selected = isSelectedEvent(eventString);

                  return (
                    <div
                      key={eventString}
                      onClick={() =>
                        selected
                          ? handleRemoveEvent(eventString)
                          : handleSelectEvent(eventString)
                      }
                      className={`flex flex-row items-center gap-3 px-3 py-2 rounded-md cursor-pointer ${
                        selected ? "opacity-100" : "opacity-60 hover:opacity-80"
                      }`}
                    >
                      <FontAwesomeIcon
                        icon={selected ? "square-check" : "square"}
                        className="h-4 w-4 flex-shrink-0"
                      />
                      <span className="text-sm">{event}</span>
                    </div>
                  );
                })}
            </div>
          );
        })}

        {sourceWidgets.length === 0 && (
          <span className="text-sm opacity-40">
            No events available from other widgets
          </span>
        )}
      </div>
    </div>
  ) : null;

  if (!itemSelected || !workspaceSelected) {
    return null;
  }

  return (
    <SectionLayout
      listContent={listContent}
      detailContent={detailContent}
      listWidth="w-72"
      emptyDetailMessage="Select a handler to view available events"
    />
  );
};
