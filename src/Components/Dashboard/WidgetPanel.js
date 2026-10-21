import React, { useEffect, useRef, useState } from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { ComponentManager } from "../../ComponentManager";
import PanelEditItem from "../Layout/Builder/Modal/Panel/PanelEditItem";
import { PanelEditItemProviders } from "../Layout/Builder/Modal/Panel";
import PanelCode from "../Layout/Builder/Modal/Panel/PanelCode";
import PanelEditItemNotifications from "../Layout/Builder/Modal/Panel/PanelEditItemNotifications";
import PanelEditItemSchedule from "../Layout/Builder/Modal/Panel/PanelEditItemSchedule";
import { panelSections } from "../../utils/widgetSections";
import { useConfigTokens } from "./ConfigListRow";
import { ListensFor } from "./ListensFor";

// Which section a request names (the card's menu, a footer badge, Dashboard
// Config's hand-off) — the keys the old Configure sections used.
const SECTION_OF = {
  edit: "settings",
  providers: "connections",
  handlers: "listeners",
  notifications: "notifications",
  schedule: "schedule",
  code: "advanced",
};

/**
 * WidgetPanel — everything about one selected widget, in the edit panel,
 * read top to bottom (consolidation Phase 3P; replaces WidgetConfigPanel's
 * tabs and the Configure dialog): Settings, Connections, Listens for,
 * Notifications and Schedule when the widget has them, then raw settings
 * under Advanced. Each section says so when it's empty, so
 * nothing is hidden. Every change goes to the dashboard through
 * `onCommit(workspace)` and waits for its Save, like every other edit.
 *
 * It keeps a working copy, so the dashboard handing the widget back can't
 * reset what's being typed; it reloads from props only when the page
 * changed some other way (the layout isn't the one it last committed — a
 * move, an undo). Settings holds keystrokes locally and applies them when a
 * field loses focus or the panel changes selection.
 *
 * @param {object} item        the widget's layout item (LayoutModel-refreshed)
 * @param {object} workspace   its page's workspace ({ ...dashboard, layout })
 * @param {string} name        the widget's name, for the empty lines
 * @param {(workspace: object) => void} onCommit
 * @param {{ section: string, request: number }|null} focus
 *   scroll to (and open) a section: "edit" | "providers" | "handlers" | "code"
 */
export const WidgetPanel = ({
  item,
  workspace,
  name = "This widget",
  onCommit,
  focus = null,
}) => {
  const { muted, hairline } = useConfigTokens();
  const [local, setLocal] = useState({ item, workspace });
  const committedLayoutRef = useRef(workspace ? workspace.layout : null);
  const flushRef = useRef(null);
  const [rawOpen, setRawOpen] = useState(false);
  const refs = {
    settings: useRef(null),
    connections: useRef(null),
    listeners: useRef(null),
    notifications: useRef(null),
    schedule: useRef(null),
    advanced: useRef(null),
  };

  // Something else changed this page — start from what the dashboard has.
  useEffect(() => {
    const layout = workspace ? workspace.layout : null;
    if (layout === committedLayoutRef.current) return;
    committedLayoutRef.current = layout;
    setLocal({ item, workspace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace && workspace.layout]);

  // A request for a section: open it if it folds away, then bring it into view.
  useEffect(() => {
    const key = focus && SECTION_OF[focus.section];
    if (!key) return;
    if (key === "advanced") setRawOpen(true);
    const el = refs[key].current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.section, focus && focus.request]);

  const onUpdate = (itemChanged, workspaceChanged) => {
    setLocal({
      item: itemChanged || local.item,
      workspace: workspaceChanged || local.workspace,
    });
    if (workspaceChanged) {
      committedLayoutRef.current = workspaceChanged.layout;
      if (onCommit) onCommit(workspaceChanged);
    }
  };

  const config = local.item
    ? ComponentManager.config(local.item.component, local.item)
    : null;
  const has = panelSections(local.item, config);
  const props = { item: local.item, workspace: local.workspace, onUpdate };
  const empty = (text) => <span className={`text-sm ${muted}`}>{text}</span>;

  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-6 px-4 py-4"
      data-testid="widget-panel"
    >
      <section
        ref={refs.settings}
        aria-label="Settings"
        className="flex flex-col gap-2"
      >
        <SectionLabel>Settings</SectionLabel>
        {has.settings ? (
          <div onBlur={() => flushRef.current && flushRef.current()}>
            <PanelEditItem {...props} flushRef={flushRef} />
          </div>
        ) : (
          empty(`${name} has no settings.`)
        )}
      </section>

      <section
        ref={refs.connections}
        aria-label="Connections"
        className="flex flex-col gap-2"
      >
        <SectionLabel>Connections</SectionLabel>
        {has.connections ? (
          <PanelEditItemProviders {...props} />
        ) : (
          empty(`${name} doesn't use any.`)
        )}
      </section>

      <section
        ref={refs.listeners}
        aria-label="Listens for"
        className="flex flex-col gap-2"
      >
        <SectionLabel>Listens for</SectionLabel>
        <ListensFor
          item={local.item}
          workspace={local.workspace}
          name={name}
          onUpdate={onUpdate}
        />
      </section>

      {/* Only for widgets that have them; they wait for Save too. */}
      {has.notifications ? (
        <section
          ref={refs.notifications}
          aria-label="Notifications"
          className="flex flex-col gap-2"
        >
          <SectionLabel>Notifications</SectionLabel>
          <PanelEditItemNotifications {...props} />
        </section>
      ) : null}

      {has.schedule ? (
        <section
          ref={refs.schedule}
          aria-label="Schedule"
          className="flex flex-col gap-2"
        >
          <SectionLabel>Schedule</SectionLabel>
          <PanelEditItemSchedule {...props} />
        </section>
      ) : null}

      <section
        ref={refs.advanced}
        aria-label="Advanced"
        className={`flex flex-col gap-2 border-t pt-3 ${hairline}`}
      >
        <div>
          <Button3
            title={rawOpen ? "Hide raw settings" : "Advanced: raw settings"}
            size="sm"
            ariaLabel={rawOpen ? "Hide raw settings" : "Show raw settings"}
            onClick={() => setRawOpen((v) => !v)}
          />
        </div>
        {rawOpen ? (
          <div className="flex flex-col h-80">
            <PanelCode {...props} />
          </div>
        ) : null}
      </section>
    </div>
  );
};
