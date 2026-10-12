import React, { useEffect, useState } from "react";
import {
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  ResizeHandle,
  SectionLabel,
  useResizableWidth,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CreatePlanStep } from "./CreatePlanStep";
import { recentRows } from "./recentRows";
import { draftAge } from "./createRouting";

/**
 * CreateDockPanel — Create in the right-hand dock (create-entry PRD CRE-007
 * AC1, phase 4e-2). A plan conversation folded out of the Create modal
 * (`dash:create-fold` { recentId, title }) carries on here in a compact
 * layout — chat, plan, Before building and the build's live steps — and
 * Expand reopens it full size (`dash:open-create` { type, recentId }). With
 * nothing folded it shows Recent.
 *
 * The host's dock decides when it's open (`collapsed`); it stays mounted
 * either way so a fold is never missed.
 */

/** Ask the dashboard stage to open Create (optionally on a plan). */
export function openCreate(detail) {
  window.dispatchEvent(new CustomEvent("dash:open-create", { detail }));
}

/** Fold a plan conversation into the dock. */
export function foldCreate(detail) {
  window.dispatchEvent(new CustomEvent("dash:create-fold", { detail }));
}

export const CreateDockPanel = ({ collapsed = false, onCollapse = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  // { recentId, title } — the conversation folded here, or null (Recent).
  const [folded, setFolded] = useState(null);
  const [plans, setPlans] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const { width, handleProps } = useResizableWidth({
    defaultWidth: 420,
    min: 340,
    max: 720,
    edge: "left",
    storageKey: "dash:create-dock:width",
  });

  useEffect(() => {
    const onFold = (e) => {
      const d = (e && e.detail) || {};
      if (d.recentId) setFolded({ recentId: d.recentId, title: d.title || "" });
    };
    window.addEventListener("dash:create-fold", onFold);
    return () => window.removeEventListener("dash:create-fold", onFold);
  }, []);

  // Recent, while it's showing.
  useEffect(() => {
    if (collapsed || folded) return undefined;
    let alive = true;
    const api = window.mainApi || {};
    const bots = api.bots;
    const load = () => {
      if (bots && bots.listCreateRecent) {
        Promise.resolve(bots.listCreateRecent())
          .then((l) => alive && Array.isArray(l) && setPlans(l))
          .catch(() => {});
      }
    };
    load();
    if (api.drafts && api.drafts.list) {
      Promise.resolve(api.drafts.list())
        .then((l) => alive && Array.isArray(l) && setDrafts(l))
        .catch(() => {});
    }
    const id = bots && bots.onCreateRecent ? bots.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [collapsed, folded]);

  if (collapsed) return null;

  const expand = () => {
    if (!folded) return;
    const { recentId } = folded;
    setFolded(null);
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", recentId });
  };
  const openRow = (row) => {
    if (row.kind === "plan") {
      setFolded({ recentId: row.id, title: row.title });
      return;
    }
    // A widget draft opens in the Widget Builder (full size).
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", {
        detail: { resumeDraftId: row.id },
      }),
    );
  };
  const rows = recentRows(plans, drafts, 12);

  return (
    <aside
      className={`relative flex flex-col h-full border-l ${hairline}`}
      style={{ width }}
      data-testid="create-dock"
      aria-label="Create"
    >
      <ResizeHandle {...handleProps} ariaLabel="Resize Create" />
      <div
        className={`flex-shrink-0 flex flex-row items-center gap-2 px-3 py-2 border-b ${hairline}`}
      >
        {folded ? (
          <ButtonIcon
            icon="arrow-left"
            ariaLabel="Back to Recent"
            onClick={() => setFolded(null)}
          />
        ) : (
          <FontAwesomeIcon icon="plus" className="h-3.5 w-3.5 opacity-70" />
        )}
        <span
          className={`flex-1 min-w-0 truncate text-sm font-semibold ${strong}`}
        >
          {folded ? folded.title || "Plan a dashboard" : "Create"}
        </span>
        {folded ? (
          <ButtonIcon
            icon="up-right-and-down-left-from-center"
            ariaLabel="Expand"
            onClick={expand}
          />
        ) : null}
        {onCollapse ? (
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close Create panel"
            onClick={onCollapse}
          />
        ) : null}
      </div>
      {folded ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <CreatePlanStep
            key={folded.recentId}
            prompt=""
            recentId={folded.recentId}
            compact
            onOpenDashboard={(id) =>
              window.dispatchEvent(
                new CustomEvent("dash:open-built-dashboard", {
                  detail: { id },
                }),
              )
            }
          />
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-3"
          data-testid="create-dock-recent"
        >
          <SectionLabel text="Recent" />
          {rows.length ? (
            rows.map((row) => (
              <Button3 key={row.key} size="sm" onClick={() => openRow(row)}>
                <span className="flex flex-col items-start text-left gap-0.5">
                  <span className={strong}>{row.title}</span>
                  <span className={`text-xs ${muted}`}>
                    {row.status} · {draftAge(row.updatedAt)}
                  </span>
                </span>
              </Button3>
            ))
          ) : (
            <span className={`text-sm ${muted}`}>
              Nothing yet. Plans you start in Create show up here.
            </span>
          )}
          <div className="pt-2">
            <Button3
              size="sm"
              title="Open Create"
              onClick={() => openCreate({ type: "dashboard" })}
            />
          </div>
        </div>
      )}
    </aside>
  );
};

export default CreateDockPanel;
