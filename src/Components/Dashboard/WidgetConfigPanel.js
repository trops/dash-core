import React, { useEffect, useRef, useState } from "react";
import { Tabs3, Button3 } from "@trops/dash-react";
import PanelEditItem from "../Layout/Builder/Modal/Panel/PanelEditItem";
import {
  PanelEditItemHandlers,
  PanelEditItemProviders,
} from "../Layout/Builder/Modal/Panel";
import PanelCode from "../Layout/Builder/Modal/Panel/PanelCode";
import { getSections } from "../Layout/Builder/Modal/LayoutBuilderConfigModal";

// The sections the edit panel shows inline (create-entry PRD CRE-006 AC5);
// anything else the widget declares (notifications, schedule) stays in the
// Configure dialog, reached from "More settings…".
const INLINE = ["edit", "handlers", "providers", "code"];

/** Inline sections for a widget, and whether it has others. */
export function widgetConfigSections(item) {
  const all = getSections(item);
  return {
    inline: all.filter((s) => INLINE.includes(s.key)),
    hasMore: all.some((s) => !INLINE.includes(s.key)),
  };
}

/**
 * WidgetConfigPanel — a selected widget's Settings, Listeners, Providers and
 * Code inside the edit panel, instead of the Configure dialog (create-entry
 * PRD CRE-006 AC4/AC5). The sections are the dialog's own components (same
 * { item, workspace, onUpdate } contract), minus its separate Save/Cancel:
 * each change goes to the dashboard right away through `onCommit(workspace)`
 * and waits there for the dashboard's Save, like every other edit.
 *
 * It keeps a working copy like the dialog did, so the dashboard handing the
 * widget back can't reset what's being typed or jump the code editor. It
 * reloads from props only when the page changed some other way (the layout
 * isn't the one it last committed — a move, an undo).
 *
 * Settings holds keystrokes locally; they're applied when the field loses
 * focus (so pressing the dashboard's Save includes them) or when the panel
 * changes selection (PanelEditItem flushes on unmount).
 *
 * @param {object} item        the widget's layout item (LayoutModel-refreshed)
 * @param {object} workspace   its page's workspace ({ ...dashboard, layout })
 * @param {string} section     "edit" | "handlers" | "providers" | "code"
 * @param {(s: string) => void} onSectionChange
 * @param {(workspace: object) => void} onCommit
 * @param {() => void} [onOpenMore]  open the Configure dialog (other sections)
 */
export const WidgetConfigPanel = ({
  item,
  workspace,
  section = "edit",
  onSectionChange = null,
  onCommit,
  onOpenMore = null,
}) => {
  const [local, setLocal] = useState({ item, workspace });
  const committedLayoutRef = useRef(workspace ? workspace.layout : null);
  const flushRef = useRef(null);

  // Something else changed this page — start from what the dashboard has.
  useEffect(() => {
    const layout = workspace ? workspace.layout : null;
    if (layout === committedLayoutRef.current) return;
    committedLayoutRef.current = layout;
    setLocal({ item, workspace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace && workspace.layout]);

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

  const { inline, hasMore } = widgetConfigSections(local.item);
  const active = inline.some((s) => s.key === section) ? section : "edit";
  const props = { item: local.item, workspace: local.workspace, onUpdate };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Tabs3
        value={active}
        onValueChange={(v) => onSectionChange && onSectionChange(v)}
        className="flex flex-col flex-1 min-h-0 border-0"
      >
        <Tabs3.List className="mx-3 self-start">
          {inline.map((s) => (
            <Tabs3.Trigger key={s.key} value={s.key}>
              {s.label}
            </Tabs3.Trigger>
          ))}
        </Tabs3.List>
        <Tabs3.Content value="edit" className="flex flex-col flex-1 min-h-0">
          {active === "edit" && (
            <div
              className="flex flex-col flex-1 min-h-0"
              onBlur={() => flushRef.current && flushRef.current()}
            >
              <PanelEditItem {...props} flushRef={flushRef} />
            </div>
          )}
        </Tabs3.Content>
        <Tabs3.Content
          value="handlers"
          className="flex flex-col flex-1 min-h-0"
        >
          {active === "handlers" && (
            <PanelEditItemHandlers {...props} stacked />
          )}
        </Tabs3.Content>
        <Tabs3.Content
          value="providers"
          className="flex flex-col flex-1 min-h-0"
        >
          {active === "providers" && <PanelEditItemProviders {...props} />}
        </Tabs3.Content>
        <Tabs3.Content value="code" className="flex flex-col flex-1 min-h-0">
          {/* PanelCode fills a flex column itself (its editor is absolutely
              positioned inside it). */}
          {active === "code" && <PanelCode {...props} />}
        </Tabs3.Content>
      </Tabs3>
      {hasMore && onOpenMore && (
        <div className="px-3 py-2">
          <Button3 title="More settings…" size="sm" onClick={onOpenMore} />
        </div>
      )}
    </div>
  );
};
