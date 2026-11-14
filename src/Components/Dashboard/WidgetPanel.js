import React, { useContext, useEffect, useRef, useState } from "react";
import deepEqual from "deep-equal";
import {
  Button,
  Button2,
  Button3,
  Modal,
  SectionLabel,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { ComponentManager } from "../../ComponentManager";
import PanelEditItem, {
  settingFieldId,
} from "../Layout/Builder/Modal/Panel/PanelEditItem";
import { PanelEditItemProviders } from "../Layout/Builder/Modal/Panel";
import PanelCode from "../Layout/Builder/Modal/Panel/PanelCode";
import PanelEditItemNotifications from "../Layout/Builder/Modal/Panel/PanelEditItemNotifications";
import PanelEditItemSchedule from "../Layout/Builder/Modal/Panel/PanelEditItemSchedule";
import { panelSections } from "../../utils/widgetSections";
import { replaceItemInLayout } from "../../utils/layout";
import { WorkspaceModel } from "../../Models";
import {
  settingType,
  validateSettings,
  fixFirstText,
  unsavedText,
} from "../../utils/userConfigValidation";
import {
  clearPictureProblems,
  pictureProblemsFor,
  pictureReasonText,
  subscribePictures,
} from "../../Widget/pictureProblems";
import { widgetKey } from "../../Widget/widgetGuard";
import { useConfigTokens } from "./ConfigListRow";
import { ListensFor } from "./ListensFor";
import { WidgetCodeModal } from "./WidgetCodeModal";
import { versionLine } from "./useWidgetSources";
import { useWidgetIssues, useWidgetMutedIssues } from "../../hooks/useIssues";
import { widgetItemId } from "../../utils/issues";
import { MutedList, WidgetProblems } from "../Issues/IssueParts";

// Which section a request names (the card's menu, a footer badge, Dashboard
// Config's hand-off) — the keys the old Configure sections used.
const SECTION_OF = {
  edit: "settings",
  providers: "connections",
  handlers: "listeners",
  notifications: "notifications",
  schedule: "schedule",
  code: "advanced",
  // Its open issues (issues PRD): the card's problems chip.
  problems: "problems",
};

const MODAL_NAV = [
  ["settings", "Settings"],
  ["connections", "Connections"],
  ["listeners", "Listens for"],
  ["advanced", "Advanced"],
];

/**
 * How many things changed on this widget since it was selected: each
 * setting, its connections, what it listens for.
 */
export function changeCount(opened, current) {
  if (!opened || !current) return 0;
  const a = opened.userPrefs || {};
  const b = current.userPrefs || {};
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!deepEqual(a[k], b[k])) n += 1;
  }
  if (
    !deepEqual(opened.selectedProviders || {}, current.selectedProviders || {})
  )
    n += 1;
  if (!deepEqual(opened.listeners || {}, current.listeners || {})) n += 1;
  return n;
}

/** The keys the panel shows (PanelEditItem shows the ones the copy has). */
function shownKeys(userConfig, prefs) {
  return Object.keys(userConfig || {}).filter((k) => k in (prefs || {}));
}

/**
 * WidgetPanel — everything about one selected widget, in the edit panel,
 * read top to bottom (consolidation Phase 3P; replaces WidgetConfigPanel's
 * tabs and the Configure dialog): Settings, Connections, Listens for,
 * Notifications and Schedule when the widget has them, then raw settings
 * under Advanced. Each section says so when it's empty, so
 * nothing is hidden. Every change goes to the dashboard through
 * `onCommit(workspace)` and waits for its Save, like every other edit.
 *
 * Widget side panel (approved mockup, frames 1-5):
 *   - a Save bar the moment anything changes ("1 unsaved change", Cancel /
 *     Save) — no Tab needed; Save is the dashboard's own Save (`onSave`)
 *   - settings checked as they're set (userConfigValidation): Save waits
 *     ("Fix 1 setting first") and takes you to the field
 *   - a picture it couldn't show, with the exact address and why
 *   - View code (WidgetCodeModal) and Open larger (the same sections in a
 *     roomy modal, with the same Save bar)
 *
 * It keeps a working copy, so the dashboard handing the widget back can't
 * reset what's being typed; it reloads from props only when the page
 * changed some other way (the layout isn't the one it last committed — a
 * move, an undo). Settings holds keystrokes locally and applies them when a
 * field loses focus, the panel changes selection, or Save.
 *
 * @param {object} item        the widget's layout item (LayoutModel-refreshed)
 * @param {object} workspace   its page's workspace ({ ...dashboard, layout })
 * @param {string} name        the widget's name, for the empty lines
 * @param {(workspace: object) => void} onCommit
 * @param {{ section: string, request: number }|null} focus
 *   scroll to (and open) a section: "edit" | "providers" | "handlers" | "code"
 * @param {{ current: Function|null }} flushRef
 *   the dashboard's Save calls flushRef.current() first, so a setting typed
 *   but not yet applied (the field still has focus) is saved too
 * @param {() => void} onSave   the dashboard's Save
 * @param {{ current: Function|null }} checkRef
 *   the dashboard's Save asks checkRef.current() first: the number of
 *   settings that fail (it shows them and goes to the first), 0 to save
 * @param {object} sources   useWidgetSources(…): its code, version, built
 */
export const WidgetPanel = ({
  item,
  workspace,
  name = "This widget",
  onCommit,
  focus = null,
  flushRef: outerFlushRef = null,
  onSave = null,
  checkRef = null,
  sources = null,
  // Bumped when the dashboard saves: what's on screen is the new baseline.
  savedAt = 0,
}) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const [local, setLocal] = useState({ item, workspace });
  const committedLayoutRef = useRef(workspace ? workspace.layout : null);
  const openedRef = useRef(item);
  const ownFlushRef = useRef(null);
  const flushRef = outerFlushRef || ownFlushRef;
  const [rawOpen, setRawOpen] = useState(false);
  // Settings as typed, before they're applied (PanelEditItem's onDraft).
  const [draftPrefs, setDraftPrefs] = useState(null);
  const [revealAll, setRevealAll] = useState(false);
  const [larger, setLarger] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  // A new key starts Settings over (Cancel).
  const [settingsKey, setSettingsKey] = useState(0);
  const [, setPicturesSeen] = useState(0);
  const currentPrefsRef = useRef({});
  // A new baseline (after a save) draws the bar again.
  const [, setBaseline] = useState(0);
  const refs = {
    settings: useRef(null),
    connections: useRef(null),
    listeners: useRef(null),
    notifications: useRef(null),
    schedule: useRef(null),
    advanced: useRef(null),
    problems: useRef(null),
  };

  // Something else changed this page — start from what the dashboard has.
  useEffect(() => {
    const layout = workspace ? workspace.layout : null;
    if (layout === committedLayoutRef.current) return;
    committedLayoutRef.current = layout;
    setLocal({ item, workspace });
    setDraftPrefs(null);
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

  // Saved: what's on screen now is what Cancel goes back to, and an old
  // picture problem goes (the saved settings draw it again if it's still
  // wrong).
  useEffect(() => {
    if (!savedAt) return;
    openedRef.current = local.item
      ? { ...local.item, userPrefs: currentPrefsRef.current }
      : local.item;
    setDraftPrefs(null);
    setRevealAll(false);
    setBaseline((n) => n + 1);
    const id = local.item && (local.item.uuid || local.item.uuidString);
    if (id) clearPictureProblems(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt]);

  // A picture this copy couldn't show (or that loaded after all).
  useEffect(() => subscribePictures(() => setPicturesSeen((n) => n + 1)), []);

  const onUpdate = (itemChanged, workspaceChanged) => {
    setLocal({
      item: itemChanged || local.item,
      workspace: workspaceChanged || local.workspace,
    });
    if (itemChanged) setDraftPrefs(null);
    if (workspaceChanged) {
      committedLayoutRef.current = workspaceChanged.layout;
      if (onCommit) onCommit(workspaceChanged);
    }
  };

  const config = local.item
    ? ComponentManager.config(local.item.component, local.item)
    : null;
  const userConfig = (config && config.userConfig) || {};
  const has = panelSections(local.item, config);
  // What went wrong in this copy (issues PRD) — a section only while open.
  const issues = useWidgetIssues(
    local.item ? local.item.component : null,
    widgetItemId(local.item),
    (local.workspace && local.workspace.id) ?? null,
  );
  // Its muted errors ("Mute errors like this"): listed, with Unmute.
  const mutedIssues = useWidgetMutedIssues(
    local.item ? local.item.component : null,
    widgetItemId(local.item),
    (local.workspace && local.workspace.id) ?? null,
  );
  // Asked for Problems before they had loaded: go there once they have.
  const hasIssues = issues.length > 0;
  useEffect(() => {
    if (!hasIssues || !focus || focus.section !== "problems") return;
    const el = refs.problems.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasIssues]);
  const props = { item: local.item, workspace: local.workspace, onUpdate };
  const empty = (text) => <span className={`text-sm ${muted}`}>{text}</span>;

  // What's set now (typed or applied), what fails, what changed.
  const currentPrefs = draftPrefs || (local.item && local.item.userPrefs) || {};
  currentPrefsRef.current = currentPrefs;
  const current = local.item
    ? { ...local.item, userPrefs: currentPrefs }
    : null;
  const failing = validateSettings(
    userConfig,
    currentPrefs,
    shownKeys(userConfig, currentPrefs),
  );
  const failingKeys = Object.keys(failing);
  const changes = changeCount(openedRef.current, current);
  // Save waits only for a setting changed since it was selected that fails
  // — one that was already wrong says so, but never blocks other edits.
  const openedPrefs = (openedRef.current && openedRef.current.userPrefs) || {};
  const blockingKeys = failingKeys.filter(
    (k) => !deepEqual(openedPrefs[k], currentPrefs[k]),
  );

  // Take the user to the first setting that fails (in the larger view when
  // it's open — its fields are the ones on screen).
  const goToSetting = (key) => {
    setTimeout(() => {
      const doc = typeof document !== "undefined" ? document : null;
      // The field, or its row (a select that doesn't carry the id).
      const row = doc ? doc.querySelector(`[data-setting="${key}"]`) : null;
      const el =
        (doc && doc.getElementById(settingFieldId(key))) ||
        (row && row.querySelector("input, select, textarea, button")) ||
        row;
      if (el) {
        if (typeof el.scrollIntoView === "function")
          el.scrollIntoView({ block: "center" });
        if (typeof el.focus === "function") el.focus();
      }
    }, 0);
  };
  const check = () => {
    if (!blockingKeys.length) return 0;
    setRevealAll(true);
    goToSetting(blockingKeys[0]);
    return blockingKeys.length;
  };
  useEffect(() => {
    if (!checkRef) return undefined;
    checkRef.current = check;
    return () => {
      if (checkRef.current === check) checkRef.current = null;
    };
  });

  const save = () => {
    if (check() > 0) return;
    if (typeof flushRef.current === "function") flushRef.current();
    if (onSave) onSave();
  };
  // Cancel: this widget's settings, connections and listeners as they were
  // when it was selected — nothing else about it (where it sits stays).
  // Anything typed is applied first, so nothing lands on top of the undo.
  const cancel = () => {
    const flushed =
      typeof flushRef.current === "function" ? flushRef.current() : null;
    const ws = (flushed && flushed.workspace) || local.workspace;
    const opened = openedRef.current;
    const now = (flushed && flushed.item) || local.item;
    if (ws && opened && now) {
      const back = {
        ...now,
        userPrefs: opened.userPrefs,
        selectedProviders: opened.selectedProviders,
        listeners: opened.listeners,
      };
      const next = WorkspaceModel(ws);
      next.layout = replaceItemInLayout(next.layout, now.id, back);
      onUpdate(back, next);
    }
    setDraftPrefs(null);
    setRevealAll(false);
    setSettingsKey((k) => k + 1);
  };

  // The pictures this copy couldn't show.
  const uuid = local.item && (local.item.uuid || local.item.uuidString);
  const pictures = local.item
    ? pictureProblemsFor(uuid, uuid ? null : widgetKey(local.item.component))
    : [];
  const urlKey =
    Object.keys(userConfig).find(
      (k) => userConfig[k] && settingType(userConfig[k], k) === "url",
    ) ||
    Object.keys(userConfig).find((k) => /url|address|host/i.test(k)) ||
    null;

  const settingsSection = (
    <section
      ref={refs.settings}
      aria-label="Settings"
      className="flex flex-col gap-2"
    >
      <SectionLabel>Settings</SectionLabel>
      {has.settings ? (
        <div onBlur={() => flushRef.current && flushRef.current()}>
          <PanelEditItem
            key={settingsKey}
            {...props}
            flushRef={flushRef}
            onDraft={setDraftPrefs}
            showAllErrors={revealAll}
          />
        </div>
      ) : (
        empty(`${name} has no settings.`)
      )}
    </section>
  );

  const problemsLabel = issues.length
    ? `Problems · ${issues.length}`
    : "Problems";
  const problemsSection =
    issues.length || mutedIssues.length ? (
      <section
        ref={refs.problems}
        aria-label="Problems"
        className="flex flex-col gap-2"
      >
        <SectionLabel>{problemsLabel}</SectionLabel>
        {issues.length ? (
          <WidgetProblems issues={issues} />
        ) : (
          empty("No problems.")
        )}
        <MutedList issues={mutedIssues} />
      </section>
    ) : null;

  const modalNav =
    issues.length || mutedIssues.length
      ? [...MODAL_NAV, ["problems", problemsLabel]]
      : MODAL_NAV;

  const restSections = (
    <>
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
    </>
  );

  const saveBar =
    changes > 0 || blockingKeys.length > 0 ? (
      <div
        role="group"
        aria-label="Unsaved changes"
        data-testid="widget-save-bar"
        className={`flex-shrink-0 flex flex-row items-center gap-2 px-4 py-3 border-t ${hairline}`}
      >
        <span
          role="status"
          className={`flex-1 text-xs ${
            blockingKeys.length ? status.error.icon : muted
          }`}
        >
          {blockingKeys.length
            ? fixFirstText(blockingKeys.length)
            : unsavedText(changes)}
        </span>
        <Button2 title="Cancel" size="sm" onClick={cancel} />
        <Button
          title="Save"
          size="sm"
          onClick={save}
          disabled={blockingKeys.length > 0}
        />
      </div>
    ) : null;

  const problemsLine = pictures.length ? (
    <div
      role="status"
      data-testid="widget-picture-problems"
      className={`flex flex-col gap-1.5 p-3 rounded-lg border ${status.warning.border} ${status.warning.bg}`}
    >
      <span className={`text-sm font-semibold ${status.warning.strongText}`}>
        {pictures.length === 1
          ? "1 picture didn't load"
          : `${pictures.length} pictures didn't load`}
      </span>
      <span className={`text-xs ${status.warning.text}`}>
        {pictureReasonText(pictures[0].reason, pictures[0].address)}
      </span>
      <code
        className={`font-mono text-xs break-all px-2 py-1 rounded ${
          currentTheme?.["bg-neutral-very-dark"] || ""
        } dr-role-surface`}
      >
        {pictures[0].address}
      </code>
      <div className="flex flex-row flex-wrap gap-2">
        <Button3
          title="Copy link"
          size="sm"
          onClick={() => {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(pictures[0].address);
              }
            } catch (_e) {
              // nothing to copy to
            }
          }}
        />
        {urlKey && has.settings ? (
          <Button3
            title="Go to the setting"
            size="sm"
            onClick={() => {
              setRevealAll(true);
              goToSetting(urlKey);
            }}
          />
        ) : null}
      </div>
    </div>
  ) : null;

  const meta = versionLine(sources || {});
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="widget-panel">
      <div className="flex flex-col gap-3 px-4 pt-2 pb-3">
        <div className="flex flex-row flex-wrap gap-2">
          <Button3
            title="View code"
            size="sm"
            onClick={() => setCodeOpen(true)}
          />
          <Button3
            title="Open larger ⤢"
            size="sm"
            ariaLabel="Open larger"
            onClick={() => setLarger(true)}
          />
        </div>
        {problemsLine}
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-6 px-4 pb-4">
        {larger ? (
          <span className={`text-sm ${muted}`}>Open in the larger view.</span>
        ) : (
          <>
            {problemsSection}
            {settingsSection}
            {restSections}
          </>
        )}
      </div>
      {larger ? null : saveBar}

      <Modal
        isOpen={larger}
        setIsOpen={(v) => {
          if (!v) setLarger(false);
        }}
        width="w-11/12 max-w-4xl"
        height="h-5/6"
      >
        <div
          role="dialog"
          aria-label={`${name} settings`}
          className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
            panelStyles.backgroundColor || ""
          } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
        >
          <div
            className={`flex-shrink-0 flex flex-row items-center gap-3 px-5 py-4 border-b ${hairline}`}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-base font-semibold truncate">{name}</span>
              {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
            </div>
            <Button2 title="View code" onClick={() => setCodeOpen(true)} />
            <Button2 title="Close" onClick={() => setLarger(false)} />
          </div>
          <div className="flex flex-row flex-1 min-h-0">
            <nav
              aria-label="Sections"
              className={`flex-shrink-0 w-44 flex flex-col gap-1 p-3 border-r ${hairline}`}
            >
              {modalNav.map(([key, label]) => (
                <Button3
                  key={key}
                  title={label}
                  size="sm"
                  onClick={() => {
                    if (key === "advanced") setRawOpen(true);
                    const el = refs[key].current;
                    if (el && typeof el.scrollIntoView === "function") {
                      el.scrollIntoView({ block: "start" });
                    }
                  }}
                />
              ))}
            </nav>
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-6 px-6 py-5">
              {problemsLine}
              {problemsSection}
              {settingsSection}
              {restSections}
            </div>
          </div>
          {saveBar}
        </div>
      </Modal>

      <WidgetCodeModal
        isOpen={codeOpen}
        onClose={() => setCodeOpen(false)}
        name={name}
        sources={sources}
      />
    </div>
  );
};

export default WidgetPanel;
