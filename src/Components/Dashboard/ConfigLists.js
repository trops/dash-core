import React from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "./ConfigListRow";
import { humanizeName } from "./widgetPanelText";

/**
 * Dashboard Config's whole-dashboard lists (consolidation Phase 3P): one
 * widget is edited in the edit panel, so these show what's set across the
 * dashboard and hand a widget to the panel with "Edit in panel".
 */

/**
 * Which widget listens to which. Rows: who sends what, and the widget that
 * listens; widgets that can listen but don't yet say "Nothing yet".
 * @param {Array} emitters   getEmitters()  — { component, itemId, label }
 * @param {Array} receivers  getReceivers() — { component, itemId, label, key }
 * @param {Array} wiring     { receiverComponent, receiverItemId, handlerName,
 *                             sourceComponent, sourceItemId, eventName }
 * @param {(target: object) => void} onEditInPanel
 */
export const ListenersMap = ({
  emitters = [],
  receivers = [],
  wiring = [],
  botNames = {},
  onEditInPanel,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const labelOf = (list, component, itemId) => {
    const hit = list.find(
      (e) => e.component === component && String(e.itemId) === String(itemId),
    );
    return (
      (hit && hit.label) ||
      botNames[component] ||
      humanizeName(
        String(component || "")
          .split(".")
          .pop(),
      )
    );
  };
  const wired = new Set(
    wiring.map((w) => `${w.receiverComponent}|${w.receiverItemId}`),
  );
  const rows = [
    ...wiring.map((w) => ({
      key: `${w.receiverComponent}|${w.receiverItemId}|${w.handlerName}|${w.sourceComponent}|${w.sourceItemId}|${w.eventName}`,
      from: labelOf(emitters, w.sourceComponent, w.sourceItemId),
      sends: humanizeName(w.eventName),
      to: labelOf(receivers, w.receiverComponent, w.receiverItemId),
      target: {
        component: w.receiverComponent,
        itemId: w.receiverItemId,
        section: "handlers",
      },
    })),
    ...receivers
      .filter((r) => !wired.has(`${r.component}|${r.itemId}`))
      .map((r) => ({
        key: `idle|${r.key}`,
        from: null,
        sends: null,
        to: r.label,
        target: {
          component: r.component,
          itemId: r.itemId,
          section: "handlers",
        },
      })),
  ];

  return (
    <div
      className="flex flex-col gap-3 h-full min-h-0"
      data-testid="listeners-map"
    >
      <span className={`text-sm ${muted}`}>
        Which widget listens to which, across the whole dashboard. To change
        one, open it in the panel.
      </span>
      {rows.length === 0 ? (
        <span className={`text-sm ${muted}`}>
          No widget on this dashboard can listen for events yet.
        </span>
      ) : (
        <div
          className={`flex flex-col border rounded-lg overflow-y-auto ${hairline}`}
        >
          <div
            className={`grid grid-cols-4 gap-3 px-4 py-2 border-b ${hairline}`}
            aria-hidden="true"
          >
            <SectionLabel>When this widget</SectionLabel>
            <SectionLabel>sends</SectionLabel>
            <SectionLabel>this one</SectionLabel>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.key}
              className={`grid grid-cols-4 gap-3 items-center px-4 py-2 border-b ${hairline}`}
            >
              <span className={`text-sm ${row.from ? strong : muted}`}>
                {row.from || "Nothing yet"}
              </span>
              <span className={`text-sm ${muted}`}>{row.sends || "—"}</span>
              <span className={`text-sm ${strong}`}>{row.to}</span>
              <div>
                <Button3
                  title="Edit in panel"
                  size="sm"
                  ariaLabel={`Edit ${row.to} in panel`}
                  onClick={() => onEditInPanel && onEditInPanel(row.target)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The widgets that have notifications, each with what it can notify about
 * and "Edit in panel" (its switches are in the panel, and wait for Save).
 * @param {Array} widgets  { uuid, component, itemId, title, notifications }
 */
export const NotificationsList = ({ widgets = [], onEditInPanel }) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <div className="flex flex-col gap-3" data-testid="notifications-list">
      <span className={`text-sm ${muted}`}>
        The widgets on this dashboard that can notify you. Each one's
        notifications are in the panel.
      </span>
      {widgets.length === 0 ? (
        <span className={`text-sm ${muted}`}>
          No widget on this dashboard sends notifications.
        </span>
      ) : (
        widgets.map((w) => (
          <div
            key={`${w.component}|${w.uuid || w.itemId}`}
            className={`flex flex-row items-center gap-3 border rounded-lg px-4 py-3 ${hairline}`}
          >
            <div className="flex flex-col flex-1 min-w-0">
              <span className={`text-sm font-medium ${strong}`}>{w.title}</span>
              <span className={`text-xs ${muted}`}>
                {(w.notifications || [])
                  .map((n) => n.displayName || n.key)
                  .join(" · ")}
              </span>
            </div>
            <Button3
              title="Edit in panel"
              size="sm"
              ariaLabel={`Edit ${w.title} in panel`}
              onClick={() =>
                onEditInPanel &&
                onEditInPanel({
                  uuid: w.uuid,
                  component: w.component,
                  itemId: w.itemId,
                  section: "notifications",
                })
              }
            />
          </div>
        ))
      )}
    </div>
  );
};
