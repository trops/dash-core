import React, { useEffect, useState } from "react";
import {
  Button2,
  ButtonIcon,
  EmptyState,
  FontAwesomeIcon,
  PanelHeader,
  ResizeHandle,
  useResizableWidth,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CreatePlanStep } from "./CreatePlanStep";
import { PlanMenu } from "./PlanMenu";

/**
 * CreateDockPanel — Create in the right-hand dock (create-entry PRD CRE-007
 * AC1, phase 4e-2). A plan conversation folded out of the Create modal
 * (`dash:create-fold` { recentId, title }) carries on here in a compact
 * layout — chat, plan, Before building and the build's live steps — and
 * Expand reopens it full size (`dash:open-create` { type, recentId }). With
 * nothing folded it says how a plan gets here. It has no Recent list (QA
 * 2026-10-22): what you made recently is at the top of the dashboard's Add
 * list, unfinished widgets on the Widgets page. Questions are asked in the
 * Dash team's conversations, from the Bots panel — this panel has no Ask box.
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
  const { hairline } = useConfigTokens();
  // { recentId, title } — the plan folded here, or null.
  const [folded, setFolded] = useState(null);
  // The open plan, as CreatePlanStep reports it (for the "…" menu).
  const [planInfo, setPlanInfo] = useState(null);
  const { width, handleProps } = useResizableWidth({
    // Same default as the AI Assistant and Bot Activity docks.
    defaultWidth: 384,
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

  if (collapsed) return null;

  const expand = () => {
    if (!folded) return;
    const { recentId } = folded;
    setFolded(null);
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", recentId });
  };
  // A secondary button, not a link: it leaves the dock for Create full size.
  const makeNew = (
    <Button2
      size="sm"
      onClick={() => openCreate({ type: "dashboard" })}
      ariaLabel="Make something new — opens Create full size"
    >
      <span className="inline-flex items-center gap-2">
        <FontAwesomeIcon
          icon="up-right-and-down-left-from-center"
          className="h-3 w-3"
        />
        Make something new…
      </span>
    </Button2>
  );

  return (
    <aside
      className={`relative flex flex-col h-full border-l ${hairline}`}
      style={{ width }}
      data-testid="create-dock"
      aria-label="Create"
    >
      <ResizeHandle {...handleProps} ariaLabel="Resize Create" />
      <PanelHeader
        testId="create-dock-header"
        title={folded ? folded.title || "Plan a dashboard" : "Create"}
        actions={
          <>
            {folded ? (
              <ButtonIcon
                icon="up-right-and-down-left-from-center"
                ariaLabel="Expand"
                onClick={expand}
              />
            ) : null}
            {folded && folded.recentId ? (
              <PlanMenu
                recentId={folded.recentId}
                title={(planInfo && planInfo.title) || folded.title}
                built={!!(planInfo && planInfo.built)}
                onRemoved={() => setFolded(null)}
              />
            ) : null}
            {onCollapse ? (
              <ButtonIcon
                icon="xmark"
                ariaLabel="Close Create panel"
                onClick={onCollapse}
              />
            ) : null}
          </>
        }
      />
      {folded ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <CreatePlanStep
            key={folded.recentId}
            prompt=""
            recentId={folded.recentId}
            compact
            onState={setPlanInfo}
            // A bot plan folded here: its page, once saved (2c-1).
            onOpenBot={(botId) =>
              window.dispatchEvent(
                new CustomEvent("dash:open-bot", { detail: { botId } }),
              )
            }
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
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4">
          <EmptyState
            testId="create-dock-empty"
            className="my-auto"
            title="No plan folded here"
            description="Fold a plan from Create to keep working on it beside your dashboard. To ask a question, open Dash team in the Bots panel."
          >
            {makeNew}
          </EmptyState>
        </div>
      )}
    </aside>
  );
};

export default CreateDockPanel;
