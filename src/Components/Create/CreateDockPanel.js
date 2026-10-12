import React, { useEffect, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  ResizeHandle,
  TextArea,
  useResizableWidth,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CreatePlanStep } from "./CreatePlanStep";
import { AskStep } from "./AskStep";
import { recentSections } from "./recentRows";
import { RecentList } from "./RecentList";

/**
 * CreateDockPanel — Create in the right-hand dock (create-entry PRD CRE-007
 * AC1, phase 4e-2). A plan conversation folded out of the Create modal
 * (`dash:create-fold` { recentId, title }) carries on here in a compact
 * layout — chat, plan, Before building and the build's live steps — and
 * Expand reopens it full size (`dash:open-create` { type, recentId }). With
 * nothing folded it shows an Ask box (5e — questions go to the Planner, which
 * reads the bots' results) and Recent, where questions and plans share one
 * list (CRE-007 AC4). A question opens here, never full size.
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
  // { recentId, title, kind?: "question", question? } — the conversation
  // folded here (a new question has no recentId yet), or null (Recent).
  const [folded, setFolded] = useState(null);
  const [asking, setAsking] = useState("");
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
      if (d.recentId) {
        setFolded({
          recentId: d.recentId,
          title: d.title || "",
          kind: d.kind === "question" ? "question" : "plan",
        });
      }
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
    if (!folded || folded.kind === "question") return;
    const { recentId } = folded;
    setFolded(null);
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", recentId });
  };
  const openRow = (row) => {
    if (row.kind === "plan" || row.kind === "question") {
      setFolded({ recentId: row.id, title: row.title, kind: row.kind });
      return;
    }
    // A widget draft opens in the Widget Builder (full size).
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", {
        detail: { resumeDraftId: row.id },
      }),
    );
  };
  const sections = recentSections(plans, drafts, { conversations: 12 });
  const askNow = () => {
    const q = asking.trim();
    if (!q) return;
    setAsking("");
    setFolded({ recentId: null, title: q, kind: "question", question: q });
  };
  // Open as a plan: Create (full size) starts from the answer's plan.
  const openPlan = (seed) => {
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", seed });
  };

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
          {folded
            ? folded.title ||
              (folded.kind === "question" ? "Question" : "Plan a dashboard")
            : "Create"}
        </span>
        {folded && folded.kind !== "question" ? (
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
      {folded && folded.kind === "question" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <AskStep
            key={folded.recentId || `new:${folded.question}`}
            question={folded.question || ""}
            recentId={folded.recentId}
            onOpenPlan={openPlan}
          />
        </div>
      ) : folded ? (
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
          <div className="flex flex-col gap-2 pb-2" data-testid="ask-box">
            <TextArea
              aria-label="Ask about your dashboards and bots"
              value={asking}
              onChange={(v) => setAsking(v)}
              placeholder="Ask about your dashboards and bots — e.g. what did my bots find today?"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askNow();
                }
              }}
            />
            <div className="flex flex-row justify-end">
              <Button
                size="sm"
                title="Ask"
                onClick={askNow}
                disabled={!asking.trim()}
              />
            </div>
          </div>
          <RecentList
            sections={sections}
            onOpen={openRow}
            empty={
              <span className={`text-sm ${muted}`}>
                Nothing yet. Questions, plans and unfinished widgets show up
                here.
              </span>
            }
          />
          <div className="pt-2">
            <Button3
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
            </Button3>
          </div>
        </div>
      )}
    </aside>
  );
};

export default CreateDockPanel;
